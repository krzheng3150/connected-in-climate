import { execSync } from 'node:child_process'
import { Router } from 'express'
import { pool } from './db.js'
import { rankMentors, computeMatch } from './matching.js'
import { isMentee } from './roles.js'

const router = Router()

// ── Code commit tracking ───────────────────────────────────────────

let codeCommit
try {
  codeCommit = process.env.COMMIT_HASH || execSync('git rev-parse HEAD').toString().trim()
} catch {
  codeCommit = 'local-dev'
}

// ── Helpers ────────────────────────────────────────────────────────

function profileFromRow(row) {
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    payload: row.payload,
    embedding: row.embedding ? parseEmbedding(row.embedding) : null,
  }
}

function parseEmbedding(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') return JSON.parse(raw)
  return null
}

// ── POST /api/matches/run ──────────────────────────────────────────
// Run matching for a mentee. Returns rank=1 result or no-match message.

router.post('/run', async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const menteeRow = await pool.query(
      'SELECT email, name, role, payload, embedding::text FROM user_profiles WHERE email = $1',
      [email.toLowerCase().trim()],
    )
    if (menteeRow.rows.length === 0) {
      return res.status(404).json({ error: 'profile not found' })
    }
    const menteeProfile = menteeRow.rows[0]
    if (!isMentee(menteeProfile.role)) {
      return res.status(400).json({ error: 'user is not a mentee' })
    }
    const mentee = profileFromRow(menteeProfile)

    const mentorRows = await pool.query(
      `SELECT email, name, role, payload, embedding::text
       FROM user_profiles
       WHERE role IN ('mentor', 'both') AND email != $1`,
      [mentee.email],
    )
    const mentors = mentorRows.rows.map(profileFromRow)

    const activeMatches = (await pool.query(
      `SELECT mentor_email, mentee_email, status FROM matches WHERE status = 'ACTIVE'`,
    )).rows

    const blockList = (await pool.query(
      'SELECT mentor_email, mentee_email FROM rejections',
    )).rows

    const priorMatchRows = (await pool.query(
      `SELECT match_id, mentor_email, status, created_at
       FROM matches WHERE mentee_email = $1`,
      [mentee.email],
    )).rows
    const priorByMentor = new Map()
    for (const row of priorMatchRows) {
      const arr = priorByMentor.get(row.mentor_email) ?? []
      arr.push({ match_id: row.match_id, status: row.status, created_at: row.created_at })
      priorByMentor.set(row.mentor_email, arr)
    }

    const opts = {
      algorithm_version: codeCommit,
      reliability_multiplier: 1.0,
    }

    const { results, filtered } = rankMentors(mentee, mentors, activeMatches, blockList, {
      ...opts,
      menteeEmbedding: mentee.embedding,
    })

    if (results.length === 0) {
      return res.json({ match: null, message: 'No mentors available right now', filtered })
    }

    const finalResults = results.map(result => ({
      ...result,
      prior_matches: priorByMentor.get(result.mentor_snapshot.email) ?? [],
    }))

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (const result of finalResults) {
        const status = result.rank === 1 ? 'ACTIVE' : 'STORED'
        await client.query(
          `INSERT INTO matches (mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            result.mentor_snapshot.email,
            mentee.email,
            status,
            result.scores.final,
            result.rank,
            JSON.stringify(result),
            codeCommit,
          ],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    const topMatch = finalResults[0]
    res.json({
      match: {
        mentor_email: topMatch.mentor_snapshot.email,
        mentor_name: topMatch.mentor_snapshot.name,
        final_score: topMatch.scores.final,
        rank: topMatch.rank,
      },
      total_scored: finalResults.length,
      filtered_count: filtered.length,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/matches?email= ────────────────────────────────────────
// List matches for a user (rank=1 only for regular users).

router.get('/', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()

    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
              m.rank, m.created_at,
              mentor.name AS mentor_name, mentor.payload AS mentor_payload,
              mentee.name AS mentee_name, mentee.payload AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       WHERE (m.mentee_email = $1 OR m.mentor_email = $1)
         AND m.rank = 1
         AND m.status = 'ACTIVE'
       ORDER BY m.created_at DESC`,
      [normalEmail],
    )

    const matches = result.rows.map(row => ({
      match_id: row.match_id,
      mentor_email: row.mentor_email,
      mentor_name: row.mentor_name,
      mentee_email: row.mentee_email,
      mentee_name: row.mentee_name,
      status: row.status,
      final_score: parseFloat(row.final_score),
      created_at: row.created_at,
    }))

    res.json({ matches })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/matches/:match_id ─────────────────────────────────────
// Single match detail with partner profile info.

router.get('/:match_id', async (req, res, next) => {
  try {
    const { match_id } = req.params
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()

    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
              m.rank, m.created_at,
              mentor.name AS mentor_name, mentor.payload AS mentor_payload,
              mentee.name AS mentee_name, mentee.payload AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       WHERE m.match_id = $1`,
      [match_id],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = result.rows[0]
    if (row.mentor_email !== normalEmail && row.mentee_email !== normalEmail) {
      return res.status(403).json({ error: 'not authorized to view this match' })
    }

    const isMentee = row.mentee_email === normalEmail
    const partnerPayload = isMentee ? row.mentor_payload : row.mentee_payload

    res.json({
      match_id: row.match_id,
      status: row.status,
      final_score: parseFloat(row.final_score),
      created_at: row.created_at,
      your_role: isMentee ? 'mentee' : 'mentor',
      partner: {
        email: isMentee ? row.mentor_email : row.mentee_email,
        name: isMentee ? row.mentor_name : row.mentee_name,
        preferred_name: partnerPayload?.preferred_name,
        pronouns: partnerPayload?.pronouns,
        photo_url: partnerPayload?.photo_url,
        location: partnerPayload?.location,
        career_level: partnerPayload?.career_level,
        education_level: partnerPayload?.education_level,
        years_experience: partnerPayload?.years_experience,
        years_climate_experience: partnerPayload?.years_climate_experience,
        management_experience: partnerPayload?.management_experience,
        business_experience: partnerPayload?.business_experience,
        international_experience: partnerPayload?.international_experience,
        nonprofit_board_experience: partnerPayload?.nonprofit_board_experience,
        top_strengths: partnerPayload?.top_strengths,
        general_topics: partnerPayload?.general_topics,
        top_topics: partnerPayload?.top_topics,
        certifications: partnerPayload?.certifications,
        interests_hobbies: partnerPayload?.interests_hobbies,
        fun_fact: partnerPayload?.fun_fact,
        links: partnerPayload?.links,
        career_areas: partnerPayload?.career_areas,
        climate_areas: partnerPayload?.climate_areas,
        sectors: partnerPayload?.sectors,
        motivation: partnerPayload?.motivation,
        statement_of_intent: partnerPayload?.statement_of_intent,
      },
    })
  } catch (err) {
    next(err)
  }
})

export default router
