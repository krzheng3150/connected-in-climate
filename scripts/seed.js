// ── Seed Script ────────────────────────────────────────────────────
// Single command to populate a database with realistic test data:
//   node --env-file=.env scripts/seed.js
//   DATABASE_URL=<prod-url> node scripts/seed.js
//
// 1. Imports expanded profiles from seed-profiles.csv
// 2. Runs the matching algorithm to create a completed match lifecycle
// 3. Inserts match runs, matches, feedback, and a block entry

import { readFileSync } from 'node:fs'
import { parse } from 'node:path'
import pg from 'pg'
import { FIELDS, normalize, normalizeArray } from '../server/field-registry.js'
import { isMentor, isMentee } from '../server/roles.js'
import { rankMentors } from '../server/matching.js'

// ── Config ─────────────────────────────────────────────────────────

const CSV_PATH = new URL('./seed-profiles.csv', import.meta.url)
const EMBEDDING_DIMENSIONS = 1536

const STABLE_COLUMNS = new Set(['email', 'name', 'role'])
const ARRAY_FIELDS = new Set([
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
  'certifications', 'interests_hobbies', 'locations_open_to',
])
const ENUM_ARRAY_FIELDS = new Set([
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
])
const ENUM_FIELD_MAP = {
  top_strengths: 'topics',
  general_topics: 'topics',
  top_topics: 'topics',
}
const ENUM_SINGLE_FIELDS = new Set([
  'education_level', 'career_level', 'years_experience', 'years_climate_experience',
  'employment_situation', 'management_experience', 'business_experience',
  'international_experience', 'nonprofit_board_experience', 'freelance_experience',
])
const INT_FIELDS = new Set([
  'max_capacity', 'w_horiz', 'w_vert', 'w_sector', 'geo_match_distance_km',
])
const BOOL_FIELDS = new Set(['geo_match_preference'])
const LINKS_PREFIX = 'links_'

// ── CSV parser ─────────────────────────────────────────────────────

function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field.trim()); field = ''
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      if (ch === '\r') i++
      row.push(field.trim()); field = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)

  const headers = rows[0].map(h => h.toLowerCase().trim())
  return rows.slice(1).map((r, idx) => {
    const obj = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? ''
    obj._row = idx + 2
    return obj
  })
}

function parseBool(val) {
  const s = String(val).toLowerCase().trim()
  if (['true', 'yes', '1'].includes(s)) return true
  if (['false', 'no', '0', ''].includes(s)) return false
  return null
}

function parseRow(raw) {
  const errors = []
  const email = (raw.email || '').toLowerCase().trim()
  if (!email) errors.push('missing email')
  const name = (raw.name || '').trim()
  if (!name) errors.push('missing name')
  const role = (raw.role || '').toLowerCase().trim()
  if (!['mentor', 'mentee', 'both'].includes(role)) {
    errors.push(`invalid role "${raw.role}"`)
  }

  const payload = {}
  const links = {}

  for (const [key, val] of Object.entries(raw)) {
    if (key === '_row' || STABLE_COLUMNS.has(key) || !val) continue
    if (key.startsWith(LINKS_PREFIX)) {
      const linkName = key.slice(LINKS_PREFIX.length)
      if (linkName && String(val).trim()) links[linkName] = String(val).trim()
      continue
    }
    if (ARRAY_FIELDS.has(key)) {
      const items = String(val).split(/[|\n;]/).map(s => s.trim()).filter(Boolean)
      if (!items.length) continue
      const registryField = ENUM_FIELD_MAP[key] || key
      if (ENUM_ARRAY_FIELDS.has(key) && FIELDS[registryField]) {
        const { values, warnings } = normalizeArray(registryField, items)
        for (const w of warnings) errors.push(`${key}: unknown "${w.value}"`)
        if (values.length) payload[key] = values
      } else {
        payload[key] = items
      }
    } else if (ENUM_SINGLE_FIELDS.has(key)) {
      const result = normalize(key, val)
      if (result && typeof result === 'object' && result.unknown) {
        errors.push(`${key}: unknown "${result.value}"`)
      } else if (result) {
        payload[key] = result
      }
    } else if (INT_FIELDS.has(key)) {
      const n = Number(val)
      if (Number.isNaN(n)) { errors.push(`${key}: not a number`); continue }
      payload[key] = n
    } else if (BOOL_FIELDS.has(key)) {
      const b = parseBool(val)
      if (b === null) { errors.push(`${key}: not boolean`); continue }
      payload[key] = b
    } else {
      payload[key] = String(val)
    }
  }

  if (Object.keys(links).length) payload.links = links
  if (isMentee(role) && !payload.statement_of_intent) errors.push('mentee missing statement_of_intent')
  if (isMentor(role) && !payload.motivation) errors.push('mentor missing motivation')

  const embeddingText = isMentee(role) ? payload.statement_of_intent : payload.motivation
  return { email, name, role, payload, embeddingText, errors }
}

// ── TF-IDF embeddings ──────────────────────────────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
}

function hashBucket(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h % EMBEDDING_DIMENSIONS
}

function computeEmbeddings(texts) {
  const docFreq = new Map()
  const tokenized = texts.map(text => {
    const tokens = tokenize(text || '')
    const unique = new Set(tokens)
    for (const t of unique) docFreq.set(t, (docFreq.get(t) || 0) + 1)
    return tokens
  })

  const N = texts.length
  return tokenized.map(tokens => {
    if (tokens.length === 0) return null
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    const vec = new Float64Array(EMBEDDING_DIMENSIONS)
    for (const [term, count] of tf) {
      const tfidf = (count / tokens.length) * Math.log(N / (docFreq.get(term) || 1))
      vec[hashBucket(term)] += tfidf
    }
    let mag = 0
    for (let i = 0; i < vec.length; i++) mag += vec[i] ** 2
    mag = Math.sqrt(mag)
    if (mag > 0) for (let i = 0; i < vec.length; i++) vec[i] /= mag
    return Array.from(vec)
  })
}

// ── DB operations ──────────────────────────────────────────────────

async function upsertProfiles(client, profiles) {
  const stats = { created: 0, updated: 0 }
  const existing = new Set(
    (await client.query('SELECT email FROM user_profiles')).rows.map(r => r.email),
  )

  for (const p of profiles) {
    const embeddingLiteral = p.embedding ? `[${p.embedding.join(',')}]` : null
    if (existing.has(p.email)) {
      stats.updated++
    } else {
      stats.created++
    }

    await client.query(
      `INSERT INTO user_profiles (email, name, role, payload, embedding, status, updated_at)
       VALUES ($1, $2, $3, $4, $5::vector, 'APPROVED', now())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         payload = EXCLUDED.payload,
         embedding = EXCLUDED.embedding,
         status = 'APPROVED',
         updated_at = now()`,
      [p.email, p.name, p.role, JSON.stringify(p.payload), embeddingLiteral],
    )
  }
  return stats
}

const TOP_CANDIDATES = 5

// Desired lifecycle state per mentee, processed in this order.
// The algorithm runs with accumulating state — earlier active matches
// affect capacity/eligibility for later runs, just like production.
const MENTEE_LIFECYCLE = [
  { email: 'mentee2@example.com', state: 'FINISHED', daysAgo: 30 },
  { email: 'mentee6@example.com', state: 'ACTIVE', daysAgo: 14 },
  { email: 'mentee8@example.com', state: 'ACTIVE', daysAgo: 7 },
  { email: 'mentee3@example.com', state: 'ACTIVE', daysAgo: 5 },
  { email: 'mentee4@example.com', state: 'AWAITING_MENTEE', daysAgo: 2 },
  { email: 'mentee1@example.com', state: 'PENDING_REVIEW', daysAgo: 0 },
  { email: 'mentee5@example.com', state: 'PENDING_REVIEW', daysAgo: 0 },
  { email: 'mentee7@example.com', state: 'PENDING_REVIEW', daysAgo: 0 },
  { email: 'both2@example.com',   state: 'PENDING_REVIEW', daysAgo: 0 },
]

const FEEDBACK = {
  'mentee2@example.com': [
    { from: 'mentee', rating: 5, text: 'Priya was incredibly helpful with navigating international climate finance. Her COP negotiation experience gave me a perspective I could not have gotten anywhere else.' },
    { from: 'mentor', rating: 4, text: 'Marcus is driven and prepared. He came to every session with thoughtful questions. Will go far in this space.' },
  ],
}

const BLOCK_LIST = [
  { mentor: 'mentor3@example.com', mentee: 'mentee7@example.com', reason: 'Mentee requested a different mentor focus area' },
]

async function seedMatchLifecycle(client, profiles) {
  const existing = (await client.query(
    "SELECT run_id FROM match_runs WHERE code_commit = 'seed' LIMIT 1",
  )).rows
  if (existing.length > 0) {
    console.log('  Match lifecycle already seeded — skipping (delete seed rows to re-seed)')
    return
  }

  const allProfiles = profiles.map(p => ({
    email: p.email, name: p.name, role: p.role,
    payload: p.payload, embedding: p.embedding,
  }))
  const mentors = allProfiles.filter(p => isMentor(p.role))

  // Accumulating state — grows as matches are "completed"
  const activeMatches = []
  const blockList = BLOCK_LIST.map(b => ({ mentor_email: b.mentor, mentee_email: b.mentee }))

  for (const { email, state, daysAgo } of MENTEE_LIFECYCLE) {
    const mentee = allProfiles.find(p => p.email === email)
    if (!mentee || !isMentee(mentee.role)) continue

    const { results } = rankMentors(
      mentee, mentors, activeMatches, blockList,
      { algorithm_version: 'seed', reliability_multiplier: 1.0 },
    )

    if (results.length === 0) {
      console.log(`  ${mentee.name}: no eligible mentors — skipped`)
      continue
    }

    const candidateCount = Math.min(TOP_CANDIDATES, results.length)
    const isReviewed = state !== 'PENDING_REVIEW'
    const runStatus = state === 'PENDING_REVIEW' ? 'PENDING_REVIEW'
      : state === 'AWAITING_MENTEE' ? 'AWAITING_MENTEE'
      : 'ACTIVE'

    const runId = (await client.query(
      `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit,
        reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, 'seed',
        ${isReviewed ? "'admin@example.com'" : 'NULL'},
        ${isReviewed ? `now() - interval '${daysAgo} days'` : 'NULL'})
       RETURNING run_id`,
      [email, runStatus, candidateCount, results.length],
    )).rows[0].run_id

    // Pick the #1 result as the "winner" for resolved runs
    const winner = results[0]

    for (const result of results) {
      let matchStatus
      if (state === 'PENDING_REVIEW') {
        matchStatus = result.rank <= candidateCount ? 'CANDIDATE' : 'STORED'
      } else if (state === 'AWAITING_MENTEE') {
        // Admin approved top 2, rest rejected
        if (result.rank <= 2) matchStatus = 'APPROVED'
        else if (result.rank <= candidateCount) matchStatus = 'REJECTED'
        else matchStatus = 'STORED'
      } else {
        // ACTIVE or FINISHED — winner is active/finished, runner-up rejected
        if (result.mentor_snapshot.email === winner.mentor_snapshot.email) {
          matchStatus = state === 'FINISHED' ? 'FINISHED' : 'ACTIVE'
        } else if (result.rank <= candidateCount) {
          matchStatus = 'REJECTED'
        } else {
          matchStatus = 'STORED'
        }
      }

      const matchId = (await client.query(
        `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed') RETURNING match_id`,
        [runId, result.mentor_snapshot.email, email, matchStatus,
         result.scores.final, result.rank, JSON.stringify(result)],
      )).rows[0].match_id

      // SELECT action for the winner
      if (matchStatus === 'ACTIVE' || matchStatus === 'FINISHED') {
        await client.query(
          `INSERT INTO match_actions (match_id, actor_email, action_type) VALUES ($1, $2, 'SELECT')`,
          [matchId, email],
        )

        // Track as active so subsequent runs see it
        activeMatches.push({
          mentor_email: result.mentor_snapshot.email,
          mentee_email: email,
          status: matchStatus === 'FINISHED' ? 'FINISHED' : 'ACTIVE',
        })

        // Feedback for finished matches
        const fb = FEEDBACK[email]
        if (fb && matchStatus === 'FINISHED') {
          for (const f of fb) {
            const submitter = f.from === 'mentee' ? email : result.mentor_snapshot.email
            await client.query(
              `INSERT INTO feedbacks (match_id, submitter_email, rating, text) VALUES ($1, $2, $3, $4)`,
              [matchId, submitter, f.rating, f.text],
            )
          }
        }
      }
    }

    const mentorName = winner.mentor_snapshot.name ?? winner.mentor_snapshot.email
    const label = state === 'PENDING_REVIEW' ? `Pending review — ${candidateCount} candidates, ${results.length} scored`
      : state === 'AWAITING_MENTEE' ? `Awaiting mentee — 2 approved of ${candidateCount} candidates`
      : `${state} — ${mentee.name} ↔ ${mentorName} (#1 of ${results.length})`
    console.log(`  ${mentee.name}: ${label}`)
  }

  // Block entries
  for (const b of BLOCK_LIST) {
    await client.query(
      `INSERT INTO rejections (mentor_email, mentee_email, reason, created_by)
       VALUES ($1, $2, $3, 'admin@example.com') ON CONFLICT DO NOTHING`,
      [b.mentor, b.mentee, b.reason],
    )
    console.log(`  Block: ${b.mentor} ↛ ${b.mentee}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────

console.log('── Seed: loading profiles ──')
const raw = readFileSync(CSV_PATH, 'utf8')
const rows = parseCSV(raw)
console.log(`Parsed ${rows.length} rows`)

const profiles = rows.map(r => ({ ...parseRow(r), _row: r._row }))
const valid = profiles.filter(p => p.errors.length === 0)
const invalid = profiles.filter(p => p.errors.length > 0)

if (invalid.length) {
  console.error(`\n${invalid.length} rows with errors:`)
  for (const p of invalid) {
    console.error(`  Row ${p._row ?? '?'} (${p.email || '?'}): ${p.errors.join(', ')}`)
  }
}

console.log(`${valid.length} valid (${valid.filter(p => isMentor(p.role)).length} mentors, ${valid.filter(p => isMentee(p.role)).length} mentees)`)

console.log('\nComputing TF-IDF embeddings...')
const texts = valid.map(p => p.embeddingText)
const embeddings = computeEmbeddings(texts)
for (let i = 0; i < valid.length; i++) valid[i].embedding = embeddings[i]
console.log(`Computed ${embeddings.filter(Boolean).length} embeddings`)

const isProd = process.env.NODE_ENV === 'production'
function connectionString() {
  const url = new URL(process.env.DATABASE_URL)
  if (isProd) url.searchParams.delete('sslmode')
  return url.toString()
}
const pool = new pg.Pool({
  connectionString: connectionString(),
  ssl: isProd ? { ca: process.env.CA_CERT, rejectUnauthorized: Boolean(process.env.CA_CERT) } : false,
})

try {
  const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  await pool.query(schemaSql)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('\n── Upserting profiles ──')
    const stats = await upsertProfiles(client, valid)
    console.log(`  Created: ${stats.created}  |  Updated: ${stats.updated}`)

    console.log('\n── Seeding match lifecycle ──')
    await seedMatchLifecycle(client, valid)

    await client.query('COMMIT')
    console.log('\n── Seed complete ──')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
} finally {
  await pool.end()
}
