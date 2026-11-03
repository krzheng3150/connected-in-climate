import { execSync } from 'node:child_process'
import { Router } from 'express'
import { pool } from './db.js'
import { rankMentors } from './matching.js'
import { isMentee } from './roles.js'

const router = Router()

const TOP_CANDIDATES = 5

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
// Run matching for a mentee. Creates a match_run + candidate matches.

router.post('/run', async (req, res, next) => {
  try {
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const normalEmail = email.toLowerCase().trim()

    const existingRun = await pool.query(
      `SELECT run_id FROM match_runs
       WHERE mentee_email = $1 AND status IN ('PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE')`,
      [normalEmail],
    )
    if (existingRun.rows.length > 0) {
      return res.status(400).json({ error: 'You already have matches in progress.' })
    }

    const menteeRow = await pool.query(
      'SELECT email, name, role, payload, embedding::text FROM user_profiles WHERE email = $1',
      [normalEmail],
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

    const inProgressMatches = (await pool.query(
      `SELECT mentor_email, mentee_email, status FROM matches
       WHERE status IN ('ACTIVE', 'CANDIDATE', 'APPROVED')`,
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

    const { results, filtered } = rankMentors(mentee, mentors, inProgressMatches, blockList, {
      algorithm_version: codeCommit,
      reliability_multiplier: 1.0,
      menteeEmbedding: mentee.embedding,
    })

    if (results.length === 0) {
      return res.json({ run: null, message: 'No mentors available right now', filtered })
    }

    const finalResults = results.map(result => ({
      ...result,
      prior_matches: priorByMentor.get(result.mentor_snapshot.email) ?? [],
    }))

    const candidateCount = Math.min(TOP_CANDIDATES, finalResults.length)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const runResult = await client.query(
        `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit)
         VALUES ($1, 'PENDING_REVIEW', $2, $3, $4) RETURNING run_id`,
        [mentee.email, candidateCount, finalResults.length, codeCommit],
      )
      const runId = runResult.rows[0].run_id

      for (const result of finalResults) {
        const status = result.rank <= TOP_CANDIDATES ? 'CANDIDATE' : 'STORED'
        await client.query(
          `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [runId, result.mentor_snapshot.email, mentee.email, status,
           result.scores.final, result.rank, JSON.stringify(result), codeCommit],
        )
      }

      await client.query('COMMIT')

      res.json({
        run: { run_id: runId, status: 'PENDING_REVIEW' },
        message: `${candidateCount} mentor candidates are now pending admin review.`,
        total_scored: finalResults.length,
        candidate_count: candidateCount,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
})

// ── GET /api/matches/run/current?email= ────────────────────────────
// Current active run for a mentee, with matches appropriate to the state.

router.get('/run/current', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()

    const runResult = await pool.query(
      `SELECT run_id, status, created_at, reviewed_at
       FROM match_runs
       WHERE mentee_email = $1 AND status IN ('PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE')
       ORDER BY created_at DESC LIMIT 1`,
      [normalEmail],
    )

    if (runResult.rows.length === 0) {
      return res.json({ run: null })
    }

    const run = runResult.rows[0]
    let matches = []

    if (run.status === 'AWAITING_MENTEE' || run.status === 'ACTIVE') {
      const matchStatus = run.status === 'AWAITING_MENTEE' ? 'APPROVED' : 'ACTIVE'
      const matchResult = await pool.query(
        `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
                m.rank, m.created_at,
                mentor.name AS mentor_name, mentor.payload AS mentor_payload,
                mentee.name AS mentee_name
         FROM matches m
         JOIN user_profiles mentor ON mentor.email = m.mentor_email
         JOIN user_profiles mentee ON mentee.email = m.mentee_email
         WHERE m.run_id = $1 AND m.status = $2
         ORDER BY m.final_score DESC`,
        [run.run_id, matchStatus],
      )
      matches = matchResult.rows.map(row => ({
        match_id: row.match_id,
        mentor_email: row.mentor_email,
        mentor_name: row.mentor_name,
        mentor_payload: row.mentor_payload,
        mentee_email: row.mentee_email,
        mentee_name: row.mentee_name,
        status: row.status,
        final_score: parseFloat(row.final_score),
        rank: row.rank,
        created_at: row.created_at,
      }))
    }

    res.json({
      run: {
        run_id: run.run_id,
        status: run.status,
        created_at: run.created_at,
        reviewed_at: run.reviewed_at,
        matches,
      },
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/matches?email= ────────────────────────────────────────
// ACTIVE matches for a user (mentor sees mentees, mentee sees mentors).

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
         AND m.status = 'ACTIVE'
       ORDER BY m.created_at DESC`,
      [normalEmail],
    )

    const matches = result.rows.map(row => ({
      match_id: row.match_id,
      mentor_email: row.mentor_email,
      mentor_name: row.mentor_name,
      mentor_payload: row.mentor_payload,
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

    const isMenteeViewer = row.mentee_email === normalEmail
    if (isMenteeViewer && row.status === 'CANDIDATE') {
      return res.status(403).json({ error: 'match is still under review' })
    }

    const partnerPayload = isMenteeViewer ? row.mentor_payload : row.mentee_payload

    res.json({
      match_id: row.match_id,
      status: row.status,
      final_score: parseFloat(row.final_score),
      created_at: row.created_at,
      your_role: isMenteeViewer ? 'mentee' : 'mentor',
      partner: {
        email: isMenteeViewer ? row.mentor_email : row.mentee_email,
        name: isMenteeViewer ? row.mentor_name : row.mentee_name,
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

// ── POST /api/matches/:match_id/select ─────────────────────────────
// Mentee picks one APPROVED match. Others become REJECTED. Run → ACTIVE.

router.post('/:match_id/select', async (req, res, next) => {
  try {
    const { match_id } = req.params
    const { email } = req.body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const normalEmail = email.toLowerCase().trim()

    const match = await pool.query(
      'SELECT match_id, run_id, mentor_email, mentee_email, status FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = match.rows[0]
    if (row.mentee_email !== normalEmail) {
      return res.status(403).json({ error: 'not authorized' })
    }
    if (row.status !== 'APPROVED') {
      return res.status(400).json({ error: `match is ${row.status}, not APPROVED` })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`,
        [match_id],
      )

      await client.query(
        `UPDATE matches SET status = 'REJECTED'
         WHERE run_id = $1 AND status = 'APPROVED' AND match_id != $2`,
        [row.run_id, match_id],
      )

      await client.query(
        `UPDATE match_runs SET status = 'ACTIVE' WHERE run_id = $1`,
        [row.run_id],
      )

      await client.query(
        `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
         VALUES ($1, $2, 'SELECT', '{}')`,
        [match_id, normalEmail],
      )

      await client.query('COMMIT')
      res.json({ status: 'ACTIVE', match_id })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
})

export default router
