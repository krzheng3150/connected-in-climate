import { Router } from 'express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
import { notifyMatchActive, notifyMenteeMatchesReady, notifyApplicantApproved } from './email.js'
import { createMatchResources } from './resources.js'

const router = Router()

function getAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
  )
}

async function requireAdmin(req, res, next) {
  const email = await getAuthEmail(req)
  if (!email || !getAdminEmails().has(email)) {
    return res.status(403).json({ error: 'admin access required' })
  }
  req.adminEmail = email
  next()
}

router.use(requireAdmin)

// ── GET /api/admin/applications ────────────────────────────────────
// All profiles, raw, for the admin table view.

router.get('/applications', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT email, name, role, payload, status, embedding IS NOT NULL AS has_embedding,
              created_at, updated_at
       FROM user_profiles ORDER BY created_at DESC`,
    )
    res.json({ profiles: result.rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/admin/applications/:email/approve ───────────────────────

router.post('/applications/:email/approve', async (req, res, next) => {
  try {
    const email = req.params.email.toLowerCase().trim()
    const result = await pool.query(
      'SELECT email, name, status FROM user_profiles WHERE email = $1',
      [email],
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'profile not found' })
    }
    if (result.rows[0].status === 'APPROVED') {
      return res.json({ ok: true, message: 'already approved' })
    }

    await pool.query(
      `UPDATE user_profiles SET status = 'APPROVED', updated_at = now() WHERE email = $1`,
      [email],
    )

    const { name } = result.rows[0]
    notifyApplicantApproved(email, name)

    console.log(`[admin] approved application: email=${email} by=${req.adminEmail}`)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/profiles?email= ─────────────────────────────────

router.get('/profiles', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const result = await pool.query(
      'SELECT email, name, role, payload, created_at, updated_at FROM user_profiles WHERE email = $1',
      [email.toLowerCase().trim()],
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'profile not found' })
    }
    res.json({ profile: result.rows[0] })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/pending ─────────────────────────────────────────
// Runs pending admin review, with their candidates.

router.get('/pending', async (_req, res, next) => {
  try {
    const runs = await pool.query(
      `SELECT r.run_id, r.mentee_email, r.status, r.top_candidates, r.total_scored,
              r.created_at, p.name AS mentee_name, p.payload AS mentee_payload
       FROM match_runs r
       JOIN user_profiles p ON p.email = r.mentee_email
       WHERE r.status = 'PENDING_REVIEW'
       ORDER BY r.created_at ASC`,
    )

    const pending = []
    for (const run of runs.rows) {
      const matches = await pool.query(
        `SELECT m.match_id, m.mentor_email, m.status, m.final_score, m.rank,
                m.computation_payload, m.created_at,
                mentor.name AS mentor_name, mentor.payload AS mentor_payload
         FROM matches m
         JOIN user_profiles mentor ON mentor.email = m.mentor_email
         WHERE m.run_id = $1 AND m.status = 'CANDIDATE'
         ORDER BY m.rank ASC`,
        [run.run_id],
      )

      pending.push({
        run_id: run.run_id,
        mentee_email: run.mentee_email,
        mentee_name: run.mentee_name,
        mentee_payload: run.mentee_payload,
        status: run.status,
        top_candidates: run.top_candidates,
        total_scored: run.total_scored,
        created_at: run.created_at,
        candidates: matches.rows.map(m => ({
          match_id: m.match_id,
          mentor_email: m.mentor_email,
          mentor_name: m.mentor_name,
          mentor_payload: m.mentor_payload,
          status: m.status,
          final_score: parseFloat(m.final_score),
          rank: m.rank,
          computation_payload: m.computation_payload,
          created_at: m.created_at,
        })),
      })
    }

    res.json({ pending_runs: pending })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/admin/runs/:run_id/review ────────────────────────────
// Batch review: approve selected candidates, reject the rest.
// Body: { approved: ["match_id_1", ...] }

router.post('/runs/:run_id/review', async (req, res, next) => {
  try {
    const { run_id } = req.params
    const { approved } = req.body

    if (!Array.isArray(approved)) {
      return res.status(400).json({ error: 'approved must be an array of match_ids' })
    }

    const run = await pool.query(
      'SELECT run_id, mentee_email, status FROM match_runs WHERE run_id = $1',
      [run_id],
    )
    if (run.rows.length === 0) {
      return res.status(404).json({ error: 'run not found' })
    }
    if (run.rows[0].status !== 'PENDING_REVIEW') {
      return res.status(400).json({ error: `run is ${run.rows[0].status}, not PENDING_REVIEW` })
    }

    const candidates = await pool.query(
      `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE'`,
      [run_id],
    )
    const candidateIds = new Set(candidates.rows.map(r => r.match_id))

    const approvedSet = new Set(approved)
    for (const id of approvedSet) {
      if (!candidateIds.has(id)) {
        return res.status(400).json({ error: `match ${id} is not a candidate in this run` })
      }
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      for (const id of candidateIds) {
        const newStatus = approvedSet.has(id) ? 'APPROVED' : 'REJECTED'
        await client.query(
          `UPDATE matches SET status = $1 WHERE match_id = $2`,
          [newStatus, id],
        )
        await client.query(
          `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
           VALUES ($1, $2, $3, '{}')`,
          [id, req.adminEmail, approvedSet.has(id) ? 'APPROVE' : 'REJECT'],
        )
      }

      let runStatus
      if (approvedSet.size === 0) {
        runStatus = 'CANCELLED'
      } else if (approvedSet.size === 1) {
        const activeId = [...approvedSet][0]
        await client.query(
          `UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`,
          [activeId],
        )
        runStatus = 'ACTIVE'
      } else {
        runStatus = 'AWAITING_MENTEE'
      }

      await client.query(
        `UPDATE match_runs SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE run_id = $3`,
        [runStatus, req.adminEmail, run_id],
      )

      await client.query('COMMIT')

      const menteeEmail = run.rows[0].mentee_email
      if (runStatus === 'ACTIVE') {
        const activeId = [...approvedSet][0]
        const matchRow = await pool.query(
          `SELECT m.mentor_email, mentor.name AS mentor_name, mentee.name AS mentee_name
           FROM matches m
           JOIN user_profiles mentor ON mentor.email = m.mentor_email
           JOIN user_profiles mentee ON mentee.email = m.mentee_email
           WHERE m.match_id = $1`,
          [activeId],
        )
        if (matchRow.rows.length > 0) {
          const { mentor_email, mentor_name, mentee_name } = matchRow.rows[0]
          notifyMatchActive(mentor_email, mentor_name, menteeEmail, mentee_name)

          createMatchResources({
            mentorEmail: mentor_email,
            mentorName: mentor_name,
            menteeEmail,
            menteeName: mentee_name,
            matchDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          }).then(async (folderUrl) => {
            if (folderUrl) {
              await pool.query('UPDATE matches SET resources_folder_url = $1 WHERE match_id = $2', [folderUrl, activeId])
            }
          }).catch(err => console.error('[resources] creation failed:', err.message))
        }
      } else if (runStatus === 'AWAITING_MENTEE') {
        const menteeRow = await pool.query(
          'SELECT name FROM user_profiles WHERE email = $1',
          [menteeEmail],
        )
        const menteeName = menteeRow.rows[0]?.name || menteeEmail
        notifyMenteeMatchesReady(menteeEmail, menteeName, approvedSet.size)
      }

      console.log(`[admin] review: run_id=${run_id} admin=${req.adminEmail} approved=${approvedSet.size} rejected=${candidateIds.size - approvedSet.size} status=${runStatus}`)
      res.json({
        run_status: runStatus,
        approved_count: approvedSet.size,
        rejected_count: candidateIds.size - approvedSet.size,
      })
    } catch (err) {
      await client.query('ROLLBACK')
      console.error(`[admin] review failed: run_id=${run_id} admin=${req.adminEmail}`, err.message)
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/matches?email= ──────────────────────────────────

router.get('/matches', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()
    const result = await pool.query(
      `SELECT m.match_id, m.run_id, m.mentor_email, m.mentee_email, m.status,
              m.final_score, m.rank, m.computation_payload, m.code_commit, m.created_at,
              mentor.name AS mentor_name, mentee.name AS mentee_name
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       WHERE m.mentee_email = $1 OR m.mentor_email = $1
       ORDER BY m.created_at DESC, m.rank ASC`,
      [normalEmail],
    )

    const matches = result.rows.map(row => ({
      match_id: row.match_id,
      run_id: row.run_id,
      mentor_email: row.mentor_email,
      mentor_name: row.mentor_name,
      mentee_email: row.mentee_email,
      mentee_name: row.mentee_name,
      status: row.status,
      final_score: parseFloat(row.final_score),
      rank: row.rank,
      computation_payload: row.computation_payload,
      code_commit: row.code_commit,
      created_at: row.created_at,
    }))

    res.json({ matches })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/matches/:match_id ───────────────────────────────

router.get('/matches/:match_id', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.*, mentor.name AS mentor_name, mentor.payload AS mentor_payload,
              mentee.name AS mentee_name, mentee.payload AS mentee_payload
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       WHERE m.match_id = $1`,
      [req.params.match_id],
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = result.rows[0]
    res.json({
      match_id: row.match_id,
      run_id: row.run_id,
      mentor_email: row.mentor_email,
      mentor_name: row.mentor_name,
      mentor_payload: row.mentor_payload,
      mentee_email: row.mentee_email,
      mentee_name: row.mentee_name,
      mentee_payload: row.mentee_payload,
      status: row.status,
      final_score: parseFloat(row.final_score),
      rank: row.rank,
      computation_payload: row.computation_payload,
      code_commit: row.code_commit,
      created_at: row.created_at,
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/admin/matches/:match_id/reject ───────────────────────
// Reject an ACTIVE match. Optionally block the pair.

router.post('/matches/:match_id/reject', async (req, res, next) => {
  try {
    const { reason, block } = req.body
    const { match_id } = req.params

    const match = await pool.query(
      'SELECT match_id, run_id, mentor_email, mentee_email, status FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = match.rows[0]
    if (row.status !== 'ACTIVE') {
      return res.status(400).json({ error: `match is ${row.status}, not ACTIVE` })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE matches SET status = 'REJECTED' WHERE match_id = $1`,
        [match_id],
      )

      await client.query(
        `UPDATE match_runs SET status = 'CANCELLED' WHERE run_id = $1`,
        [row.run_id],
      )

      await client.query(
        `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
         VALUES ($1, $2, 'REJECT', $3)`,
        [match_id, req.adminEmail, JSON.stringify({ reason: reason || null })],
      )

      let blockId = null
      if (block) {
        const blockResult = await client.query(
          `INSERT INTO rejections (mentor_email, mentee_email, match_id, reason, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [row.mentor_email, row.mentee_email, match_id, reason || null, req.adminEmail],
        )
        blockId = blockResult.rows[0].id
      }

      await client.query('COMMIT')
      console.log(`[admin] reject: match_id=${match_id} admin=${req.adminEmail} block=${!!block}`)
      res.json({ status: 'REJECTED', block_created: !!block, block_id: blockId })
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

// ── GET /api/admin/feedback?email= ─────────────────────────────────

router.get('/feedback', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()
    const result = await pool.query(
      `SELECT f.feedback_id, f.match_id, f.submitter_email, f.text, f.rating,
              f.payload, f.created_at,
              m.mentor_email, m.mentee_email
       FROM feedbacks f
       JOIN matches m ON m.match_id = f.match_id
       WHERE m.mentee_email = $1 OR m.mentor_email = $1
       ORDER BY f.created_at DESC`,
      [normalEmail],
    )

    res.json({ feedbacks: result.rows })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/admin/blocks ──────────────────────────────────────────

router.get('/blocks', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, mentor_email, mentee_email, match_id, reason, created_by, created_at
       FROM rejections ORDER BY created_at DESC`,
    )
    res.json({ blocks: result.rows })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/admin/blocks ─────────────────────────────────────────

router.post('/blocks', async (req, res, next) => {
  try {
    const { mentor_email, mentee_email, reason } = req.body
    if (!mentor_email || !mentee_email) {
      return res.status(400).json({ error: 'mentor_email and mentee_email are required' })
    }

    const result = await pool.query(
      `INSERT INTO rejections (mentor_email, mentee_email, reason, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, created_at`,
      [mentor_email.toLowerCase().trim(), mentee_email.toLowerCase().trim(), reason || null, req.adminEmail],
    )

    console.log(`[admin] block created: mentor=${mentor_email} mentee=${mentee_email} by=${req.adminEmail}`)
    res.status(201).json({
      block_id: result.rows[0].id,
      created_at: result.rows[0].created_at,
    })
  } catch (err) {
    next(err)
  }
})

// ── DELETE /api/admin/blocks/:id ───────────────────────────────────

router.delete('/blocks/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM rejections WHERE id = $1 RETURNING id',
      [req.params.id],
    )
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'block not found' })
    }
    console.log(`[admin] block deleted: id=${req.params.id} by=${req.adminEmail}`)
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router
