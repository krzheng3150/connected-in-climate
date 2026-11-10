import { execSync } from 'node:child_process'
import { Router } from 'express'
import { pool } from './db.js'
import { rankMentors } from './matching.js'
import { isMentor, isMentee } from './roles.js'
import { notifyAdminsNewRun, notifyMatchActive, notifyMenteeMatchesReady } from './email.js'
import { createMatchResources } from './resources.js'
import { AUTO_APPROVE_MATCHES, AUTO_APPROVE_MATCH_COUNT, MENTORSHIP_DURATION_DAYS, requiresReview } from './flags.js'

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
      `SELECT p.email, p.name, p.payload AS shared_payload,
              ma.payload AS mentee_payload, ma.embedding::text, ma.status
       FROM user_profiles p
       JOIN mentee_applications ma ON ma.email = p.email
       WHERE p.email = $1`,
      [normalEmail],
    )
    if (menteeRow.rows.length === 0) {
      return res.status(404).json({ error: 'mentee application not found' })
    }
    const menteeProfile = menteeRow.rows[0]
    if (menteeProfile.status !== 'APPROVED') {
      return res.status(400).json({ error: 'Your application is still under review.' })
    }
    const mentee = {
      email: menteeProfile.email,
      name: menteeProfile.name,
      role: 'mentee',
      payload: { ...menteeProfile.shared_payload, ...menteeProfile.mentee_payload },
      embedding: menteeProfile.embedding ? parseEmbedding(menteeProfile.embedding) : null,
    }

    const mentorRows = await pool.query(
      `SELECT p.email, p.name, p.payload AS shared_payload,
              mta.payload AS mentor_payload, mta.embedding::text
       FROM user_profiles p
       JOIN mentor_applications mta ON mta.email = p.email
       WHERE mta.status = 'APPROVED' AND p.email != $1`,
      [mentee.email],
    )
    const mentors = mentorRows.rows.map(r => ({
      email: r.email,
      name: r.name,
      role: 'mentor',
      payload: { ...r.shared_payload, ...r.mentor_payload },
      embedding: r.embedding ? parseEmbedding(r.embedding) : null,
    }))

    const inProgressMatches = (await pool.query(
      `SELECT mentor_email, mentee_email, status FROM matches
       WHERE status IN ('ACTIVE', 'CANDIDATE', 'APPROVED')
          OR (status = 'FINISHED' AND mentee_email = $1)`,
      [mentee.email],
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

    const matchStart = Date.now()
    const { results, filtered } = rankMentors(mentee, mentors, inProgressMatches, blockList, {
      algorithm_version: codeCommit,
      reliability_multiplier: 1.0,
      menteeEmbedding: mentee.embedding,
    })
    console.log(`[match] scored ${results.length} mentors (${filtered.total_eligible} eligible) in ${Date.now() - matchStart}ms`)

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

      const shouldAutoApprove = AUTO_APPROVE_MATCHES && !requiresReview(mentee.email)
      let runStatus = 'PENDING_REVIEW'

      if (shouldAutoApprove) {
        const approveCount = Math.min(AUTO_APPROVE_MATCH_COUNT, candidateCount)
        await client.query(
          `UPDATE matches SET status = 'APPROVED'
           WHERE run_id = $1 AND status = 'CANDIDATE' AND rank <= $2`,
          [runId, approveCount],
        )
        await client.query(
          `UPDATE matches SET status = 'REJECTED'
           WHERE run_id = $1 AND status = 'CANDIDATE' AND rank > $2`,
          [runId, approveCount],
        )
        runStatus = approveCount === 1 ? 'ACTIVE' : 'AWAITING_MENTEE'
        await client.query(
          `UPDATE match_runs SET status = $1, reviewed_by = 'auto', reviewed_at = now() WHERE run_id = $2`,
          [runStatus, runId],
        )

        if (runStatus === 'ACTIVE') {
          const activeMatch = finalResults[0]
          await client.query(
            `UPDATE matches SET status = 'ACTIVE', activated_at = now(),
                    end_date = now() + make_interval(days => $2)
             WHERE run_id = $1 AND rank = 1`,
            [runId, MENTORSHIP_DURATION_DAYS],
          )
          notifyMatchActive(activeMatch.mentor_snapshot.email, activeMatch.mentor_snapshot.name, mentee.email, menteeProfile.name)
        }
      }

      await client.query('COMMIT')

      if (shouldAutoApprove && runStatus === 'AWAITING_MENTEE') {
        const approveCount = Math.min(AUTO_APPROVE_MATCH_COUNT, candidateCount)
        notifyMenteeMatchesReady(mentee.email, menteeProfile.name, approveCount)
      }

      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
      if (!shouldAutoApprove && adminEmails.length > 0) {
        notifyAdminsNewRun(adminEmails, menteeProfile.name, mentee.email)
      }

      console.log(`[match] run created: mentee=${mentee.email} run_id=${runId} status=${runStatus} candidates=${candidateCount} total_scored=${finalResults.length}${shouldAutoApprove ? ' (auto-approved)' : ''}`)
      res.json({
        run: { run_id: runId, status: runStatus },
        message: shouldAutoApprove
          ? `Your mentor matches are ready! Review them and choose your mentor.`
          : `${candidateCount} mentor candidates are now pending admin review.`,
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

    if (run.status === 'ACTIVE') {
      const expired = await pool.query(
        `SELECT match_id FROM matches
         WHERE run_id = $1 AND status = 'ACTIVE' AND end_date IS NOT NULL AND end_date < now()`,
        [run.run_id],
      )
      if (expired.rows.length > 0) {
        await pool.query(`UPDATE matches SET status = 'FINISHED' WHERE run_id = $1 AND status = 'ACTIVE'`, [run.run_id])
        await pool.query(`UPDATE match_runs SET status = 'FINISHED' WHERE run_id = $1`, [run.run_id])
        return res.json({ run: null })
      }
    }

    let matches = []

    if (run.status === 'AWAITING_MENTEE' || run.status === 'ACTIVE') {
      const matchStatus = run.status === 'AWAITING_MENTEE' ? 'APPROVED' : 'ACTIVE'
      const matchResult = await pool.query(
        `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
                m.rank, m.created_at, m.activated_at, m.end_date,
                mentor.name AS mentor_name,
                mentor.payload || COALESCE(mta.payload, '{}') AS mentor_payload,
                mentee.name AS mentee_name
         FROM matches m
         JOIN user_profiles mentor ON mentor.email = m.mentor_email
         LEFT JOIN mentor_applications mta ON mta.email = m.mentor_email
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
        activated_at: row.activated_at,
        end_date: row.end_date,
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

    // Lazy-expire any active matches past their end date
    await pool.query(
      `UPDATE matches SET status = 'FINISHED'
       WHERE (mentee_email = $1 OR mentor_email = $1)
         AND status = 'ACTIVE' AND end_date IS NOT NULL AND end_date < now()`,
      [normalEmail],
    )
    await pool.query(
      `UPDATE match_runs SET status = 'FINISHED'
       WHERE run_id IN (
         SELECT DISTINCT run_id FROM matches
         WHERE (mentee_email = $1 OR mentor_email = $1) AND status = 'FINISHED'
       ) AND status = 'ACTIVE'`,
      [normalEmail],
    )

    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
              m.rank, m.created_at, m.activated_at, m.end_date,
              mentor.name AS mentor_name,
              mentor.payload || COALESCE(mta.payload, '{}') AS mentor_payload,
              mentee.name AS mentee_name,
              mentee.payload || COALESCE(ma.payload, '{}') AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       LEFT JOIN mentor_applications mta ON mta.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       LEFT JOIN mentee_applications ma ON ma.email = m.mentee_email
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
      activated_at: row.activated_at,
      end_date: row.end_date,
    }))

    res.json({ matches })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/matches/past?email= ───────────────────────────────────
// FINISHED matches for a user (both mentors and mentees).

router.get('/past', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()

    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status, m.final_score,
              m.rank, m.created_at, m.activated_at, m.end_date,
              mentor.name AS mentor_name,
              mentor.payload || COALESCE(mta.payload, '{}') AS mentor_payload,
              mentee.name AS mentee_name,
              mentee.payload || COALESCE(ma.payload, '{}') AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       LEFT JOIN mentor_applications mta ON mta.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       LEFT JOIN mentee_applications ma ON ma.email = m.mentee_email
       WHERE (m.mentee_email = $1 OR m.mentor_email = $1)
         AND m.status = 'FINISHED'
       ORDER BY m.end_date DESC NULLS LAST`,
      [normalEmail],
    )

    const matches = result.rows.map(row => ({
      match_id: row.match_id,
      mentor_email: row.mentor_email,
      mentor_name: row.mentor_name,
      mentor_payload: row.mentor_payload,
      mentee_email: row.mentee_email,
      mentee_name: row.mentee_name,
      mentee_payload: row.mentee_payload,
      status: row.status,
      final_score: parseFloat(row.final_score),
      created_at: row.created_at,
      activated_at: row.activated_at,
      end_date: row.end_date,
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
              m.rank, m.created_at, m.activated_at, m.end_date, m.resources_folder_url,
              mentor.name AS mentor_name,
              mentor.payload || COALESCE(mta.payload, '{}') AS mentor_payload,
              mentee.name AS mentee_name,
              mentee.payload || COALESCE(ma.payload, '{}') AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       LEFT JOIN mentor_applications mta ON mta.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       LEFT JOIN mentee_applications ma ON ma.email = m.mentee_email
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
      activated_at: row.activated_at,
      end_date: row.end_date,
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
        scheduling_link: partnerPayload?.scheduling_link,
      },
      resources_folder_url: row.resources_folder_url,
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
        `UPDATE matches SET status = 'ACTIVE', activated_at = now(),
                end_date = now() + make_interval(days => $2)
         WHERE match_id = $1`,
        [match_id, MENTORSHIP_DURATION_DAYS],
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

      const names = await pool.query(
        `SELECT email, name FROM user_profiles WHERE email IN ($1, $2)`,
        [row.mentor_email, normalEmail],
      )
      const nameMap = Object.fromEntries(names.rows.map(r => [r.email, r.name]))
      notifyMatchActive(row.mentor_email, nameMap[row.mentor_email] || row.mentor_email, normalEmail, nameMap[normalEmail] || normalEmail)

      console.log(`[match] mentee selected: match_id=${match_id} mentee=${normalEmail} mentor=${row.mentor_email}`)

      createMatchResources({
        mentorEmail: row.mentor_email,
        mentorName: nameMap[row.mentor_email] || row.mentor_email,
        menteeEmail: normalEmail,
        menteeName: nameMap[normalEmail] || normalEmail,
        matchDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      }).then(async (folderUrl) => {
        if (folderUrl) {
          await pool.query('UPDATE matches SET resources_folder_url = $1 WHERE match_id = $2', [folderUrl, match_id])
        }
      }).catch(err => console.error('[resources] creation failed:', err.message))

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
