// ── Seed Script ────────────────────────────────────────────────────
// Single command to populate a database with realistic test data:
//   node --env-file=.env scripts/seed.js
//   DATABASE_URL=<prod-url> node scripts/seed.js
//
// 1. Generates ~80 diverse profiles via seed-data.js
// 2. Runs the matching algorithm to create a completed match lifecycle
// 3. Inserts match runs, matches, feedback, and block entries

import { readFileSync } from 'node:fs'
import pg from 'pg'
import { isMentor, isMentee } from '../server/roles.js'
import { rankMentors } from '../server/matching.js'
import {
  generateProfiles, getLifecyclePlan, getPendingEmails,
  getBlockList, getFeedback,
} from './seed-data.js'

const EMBEDDING_DIMENSIONS = 1536
const TOP_CANDIDATES = 5

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

const MENTOR_PAYLOAD_FIELDS = new Set([
  'motivation', 'eq_response', 'scheduling_link', 'commitment_name',
  'management_experience', 'business_experience', 'international_experience',
  'nonprofit_board_experience', 'freelance_experience',
  'top_strengths', 'general_topics', 'max_capacity',
])

const MENTEE_PAYLOAD_FIELDS = new Set([
  'statement_of_intent', 'relevant_projects', 'commitment_name',
  'employment_situation', 'top_topics',
])

function splitPayload(payload, role) {
  const shared = {}
  const mentorPayload = {}
  const menteePayload = {}
  for (const [key, val] of Object.entries(payload)) {
    if (MENTOR_PAYLOAD_FIELDS.has(key) && isMentor(role)) {
      mentorPayload[key] = val
    } else if (MENTEE_PAYLOAD_FIELDS.has(key) && isMentee(role)) {
      menteePayload[key] = val
    } else {
      shared[key] = val
    }
  }
  return { shared, mentorPayload, menteePayload }
}

async function upsertProfiles(client, profiles, pendingEmails) {
  const stats = { created: 0, updated: 0, pending: 0 }
  const existing = new Set(
    (await client.query('SELECT email FROM user_profiles')).rows.map(r => r.email),
  )

  for (const p of profiles) {
    const status = pendingEmails.has(p.email) ? 'PENDING' : 'APPROVED'
    if (existing.has(p.email)) stats.updated++
    else stats.created++
    if (status === 'PENDING') stats.pending++

    const { shared, mentorPayload, menteePayload } = splitPayload(p.payload, p.role)

    await client.query(
      `INSERT INTO user_profiles (email, name, role, payload, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         payload = EXCLUDED.payload,
         status = EXCLUDED.status,
         updated_at = now()`,
      [p.email, p.name, p.role, JSON.stringify(shared), status],
    )

    if (isMentor(p.role)) {
      const mentorEmbed = p.mentorEmbedding ? `[${p.mentorEmbedding.join(',')}]` : null
      await client.query(
        `INSERT INTO mentor_applications (email, status, payload, embedding, updated_at)
         VALUES ($1, $2, $3, $4::vector, now())
         ON CONFLICT (email) DO UPDATE SET
           status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [p.email, status, JSON.stringify(mentorPayload), mentorEmbed],
      )
    }

    if (isMentee(p.role)) {
      const menteeEmbed = p.menteeEmbedding ? `[${p.menteeEmbedding.join(',')}]` : null
      await client.query(
        `INSERT INTO mentee_applications (email, status, payload, embedding, updated_at)
         VALUES ($1, $2, $3, $4::vector, now())
         ON CONFLICT (email) DO UPDATE SET
           status = EXCLUDED.status,
           payload = EXCLUDED.payload,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [p.email, status, JSON.stringify(menteePayload), menteeEmbed],
      )
    }
  }
  return stats
}

async function seedMatchLifecycle(client, profiles, lifecycle, feedback, blockList) {
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

  const activeMatches = []
  const blockListForAlgo = blockList.map(b => ({ mentor_email: b.mentor, mentee_email: b.mentee }))

  for (const { email, state, daysAgo } of lifecycle) {
    const mentee = allProfiles.find(p => p.email === email)
    if (!mentee || !isMentee(mentee.role)) continue

    const { results } = rankMentors(
      mentee, mentors, activeMatches, blockListForAlgo,
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
      : state === 'FINISHED' ? 'FINISHED'
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

    const winner = results[0]

    for (const result of results) {
      let matchStatus
      if (state === 'PENDING_REVIEW') {
        matchStatus = result.rank <= candidateCount ? 'CANDIDATE' : 'STORED'
      } else if (state === 'AWAITING_MENTEE') {
        if (result.rank <= 2) matchStatus = 'APPROVED'
        else if (result.rank <= candidateCount) matchStatus = 'REJECTED'
        else matchStatus = 'STORED'
      } else {
        if (result.mentor_snapshot.email === winner.mentor_snapshot.email) {
          matchStatus = state === 'FINISHED' ? 'FINISHED' : 'ACTIVE'
        } else if (result.rank <= candidateCount) {
          matchStatus = 'REJECTED'
        } else {
          matchStatus = 'STORED'
        }
      }

      const activatedAt = (matchStatus === 'ACTIVE' || matchStatus === 'FINISHED')
        ? `now() - interval '${daysAgo} days'` : null
      const endDateExpr = matchStatus === 'FINISHED'
        ? `now() - interval '${Math.max(daysAgo - 30, 1)} days'`
        : matchStatus === 'ACTIVE'
          ? `now() + interval '${30 - daysAgo} days'`
          : null

      const matchId = (await client.query(
        `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit,
          activated_at, end_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'seed',
          ${activatedAt ?? 'NULL'}, ${endDateExpr ?? 'NULL'})
         RETURNING match_id`,
        [runId, result.mentor_snapshot.email, email, matchStatus,
         result.scores.final, result.rank, JSON.stringify(result)],
      )).rows[0].match_id

      if (matchStatus === 'ACTIVE' || matchStatus === 'FINISHED') {
        await client.query(
          `INSERT INTO match_actions (match_id, actor_email, action_type) VALUES ($1, $2, 'SELECT')`,
          [matchId, email],
        )

        activeMatches.push({
          mentor_email: result.mentor_snapshot.email,
          mentee_email: email,
          status: matchStatus === 'FINISHED' ? 'FINISHED' : 'ACTIVE',
        })

        const fb = feedback[email]
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

  for (const b of blockList) {
    await client.query(
      `INSERT INTO rejections (mentor_email, mentee_email, reason, created_by)
       VALUES ($1, $2, $3, 'admin@example.com') ON CONFLICT DO NOTHING`,
      [b.mentor, b.mentee, b.reason],
    )
    console.log(`  Block: ${b.mentor} ↛ ${b.mentee}`)
  }
}

// ── Main ───────────────────────────────────────────────────────────

console.log('── Seed: generating profiles ──')
const profiles = generateProfiles()
const pendingEmails = getPendingEmails(profiles)
const lifecycle = getLifecyclePlan(profiles)
const feedback = getFeedback()
const blockList = getBlockList()

const mentorCount = profiles.filter(p => isMentor(p.role)).length
const menteeCount = profiles.filter(p => isMentee(p.role)).length
console.log(`${profiles.length} profiles (${mentorCount} mentors, ${menteeCount} mentees)`)
console.log(`${lifecycle.length} lifecycle entries, ${pendingEmails.size} pending applications`)

console.log('\nComputing TF-IDF embeddings...')
const mentorTexts = profiles.map(p => isMentor(p.role) ? p.payload.motivation : null)
const menteeTexts = profiles.map(p => isMentee(p.role) ? p.payload.statement_of_intent : null)
const allTexts = [...mentorTexts, ...menteeTexts].filter(Boolean)
const allEmbeddings = computeEmbeddings(allTexts)
let ei = 0
const mentorEmbeddings = mentorTexts.map(t => t ? allEmbeddings[ei++] : null)
const menteeEmbeddings = menteeTexts.map(t => t ? allEmbeddings[ei++] : null)
for (let i = 0; i < profiles.length; i++) {
  profiles[i].mentorEmbedding = mentorEmbeddings[i]
  profiles[i].menteeEmbedding = menteeEmbeddings[i]
  profiles[i].embedding = mentorEmbeddings[i] || menteeEmbeddings[i]
}
console.log(`Computed ${allEmbeddings.filter(Boolean).length} embeddings`)

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
    const stats = await upsertProfiles(client, profiles, pendingEmails)
    console.log(`  Created: ${stats.created}  |  Updated: ${stats.updated}  |  Pending: ${stats.pending}`)

    console.log('\n── Seeding match lifecycle ──')
    await seedMatchLifecycle(client, profiles, lifecycle, feedback, blockList)

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
