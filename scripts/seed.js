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

async function seedMatchLifecycle(client, profiles) {
  const existing = (await client.query(
    "SELECT run_id FROM match_runs WHERE code_commit = 'seed' LIMIT 1",
  )).rows
  if (existing.length > 0) {
    console.log('  Match lifecycle already seeded — skipping (delete seed rows to re-seed)')
    return
  }

  const profileMap = new Map(profiles.map(p => [p.email, p]))

  // ── 1. Finished match: Marcus Rivera ↔ Priya Sharma ──────────────
  const mentee1 = profileMap.get('mentee2@example.com')
  const mentor1 = profileMap.get('mentor2@example.com')

  if (!mentee1 || !mentor1) {
    console.log('  Skipping finished match — profiles not found')
    return
  }

  const allProfiles = profiles.map(p => ({
    email: p.email, name: p.name, role: p.role,
    payload: p.payload, embedding: p.embedding,
  }))
  const mentors = allProfiles.filter(p => isMentor(p.role))

  const { results: results1 } = rankMentors(
    allProfiles.find(p => p.email === mentee1.email),
    mentors, [], [],
    { algorithm_version: 'seed', reliability_multiplier: 1.0 },
  )

  if (results1.length === 0) {
    console.log('  Skipping match lifecycle — no ranked results for Marcus')
    return
  }

  const priyaResult = results1.find(r => r.mentor_snapshot.email === mentor1.email) || results1[0]
  const runId1 = (await client.query(
    `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit, reviewed_by, reviewed_at)
     VALUES ($1, 'ACTIVE', $2, $3, 'seed', 'admin@example.com', now() - interval '14 days')
     RETURNING run_id`,
    [mentee1.email, Math.min(5, results1.length), results1.length],
  )).rows[0].run_id

  const matchId1 = (await client.query(
    `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
     VALUES ($1, $2, $3, 'FINISHED', $4, $5, $6, 'seed')
     RETURNING match_id`,
    [runId1, mentor1.email, mentee1.email, priyaResult.scores.final, priyaResult.rank, JSON.stringify(priyaResult)],
  )).rows[0].match_id

  await client.query(
    `INSERT INTO match_actions (match_id, actor_email, action_type) VALUES ($1, $2, 'SELECT')`,
    [matchId1, mentee1.email],
  )
  await client.query(
    `INSERT INTO feedbacks (match_id, submitter_email, rating, text)
     VALUES ($1, $2, 5, 'Priya was incredibly helpful with navigating international climate finance. Her COP negotiation experience gave me a perspective I could not have gotten anywhere else.')`,
    [matchId1, mentee1.email],
  )
  await client.query(
    `INSERT INTO feedbacks (match_id, submitter_email, rating, text)
     VALUES ($1, $2, 4, 'Marcus is driven and prepared. He came to every session with thoughtful questions. Will go far in this space.')`,
    [matchId1, mentor1.email],
  )
  console.log(`  Finished match: Marcus ↔ Priya (${matchId1})`)

  // ── 2. Active match: Fatima Al-Hassan ↔ Amara Okafor ─────────────
  const mentee2 = profileMap.get('mentee6@example.com')
  const mentor2 = profileMap.get('mentor4@example.com')

  if (mentee2 && mentor2) {
    const { results: results2 } = rankMentors(
      allProfiles.find(p => p.email === mentee2.email),
      mentors, [], [],
      { algorithm_version: 'seed', reliability_multiplier: 1.0 },
    )

    const amaraResult = results2.find(r => r.mentor_snapshot.email === mentor2.email) || results2[0]
    if (amaraResult) {
      const runId2 = (await client.query(
        `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit, reviewed_by, reviewed_at)
         VALUES ($1, 'ACTIVE', $2, $3, 'seed', 'admin@example.com', now() - interval '3 days')
         RETURNING run_id`,
        [mentee2.email, Math.min(5, results2.length), results2.length],
      )).rows[0].run_id

      const matchId2 = (await client.query(
        `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, 'seed')
         RETURNING match_id`,
        [runId2, mentor2.email, mentee2.email, amaraResult.scores.final, amaraResult.rank, JSON.stringify(amaraResult)],
      )).rows[0].match_id

      await client.query(
        `INSERT INTO match_actions (match_id, actor_email, action_type) VALUES ($1, $2, 'SELECT')`,
        [matchId2, mentee2.email],
      )
      console.log(`  Active match: Fatima ↔ Amara (${matchId2})`)
    }
  }

  // ── 3. Active match: Wei Zhang at capacity ───────────────────────
  const mentee3 = profileMap.get('mentee8@example.com')
  const mentor3 = profileMap.get('mentor5@example.com')

  if (mentee3 && mentor3) {
    const { results: results3 } = rankMentors(
      allProfiles.find(p => p.email === mentee3.email),
      mentors, [], [],
      { algorithm_version: 'seed', reliability_multiplier: 1.0 },
    )

    const weiResult = results3.find(r => r.mentor_snapshot.email === mentor3.email) || results3[0]
    if (weiResult) {
      const runId3 = (await client.query(
        `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit, reviewed_by, reviewed_at)
         VALUES ($1, 'ACTIVE', $2, $3, 'seed', 'admin@example.com', now() - interval '7 days')
         RETURNING run_id`,
        [mentee3.email, Math.min(5, results3.length), results3.length],
      )).rows[0].run_id

      const matchId3 = (await client.query(
        `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
         VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, 'seed')
         RETURNING match_id`,
        [runId3, mentor3.email, mentee3.email, weiResult.scores.final, weiResult.rank, JSON.stringify(weiResult)],
      )).rows[0].match_id

      await client.query(
        `INSERT INTO match_actions (match_id, actor_email, action_type) VALUES ($1, $2, 'SELECT')`,
        [matchId3, mentee3.email],
      )
      console.log(`  Active match: Aisha ↔ Wei (${matchId3}) — Wei now at capacity`)
    }
  }

  // ── 4. Block entry ───────────────────────────────────────────────
  await client.query(
    `INSERT INTO rejections (mentor_email, mentee_email, reason, created_by)
     VALUES ('mentor3@example.com', 'mentee7@example.com', 'Mentee requested a different mentor focus area', 'admin@example.com')
     ON CONFLICT DO NOTHING`,
  )
  console.log('  Block: Jordan Lee ↛ Tomás Reyes')
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

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { ca: process.env.CA_CERT, rejectUnauthorized: Boolean(process.env.CA_CERT) }
    : false,
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
