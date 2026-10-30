import { Router } from 'express'
import { pool } from './db.js'

const router = Router()

function getAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
  )
}

function requireAdmin(req, res, next) {
  const email = (req.headers['x-user-email'] || '').toLowerCase().trim()
  if (!email || !getAdminEmails().has(email)) {
    return res.status(403).json({ error: 'admin access required' })
  }
  req.adminEmail = email
  next()
}

router.use(requireAdmin)

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

// ── GET /api/admin/matches?email= ──────────────────────────────────
// All matches (all ranks, all statuses) with full computation payload.

router.get('/matches', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()
    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status,
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
// Reject a match. Optionally block the pair.

router.post('/matches/:match_id/reject', async (req, res, next) => {
  try {
    const { reason, block } = req.body
    const { match_id } = req.params

    const match = await pool.query(
      'SELECT match_id, mentor_email, mentee_email, status FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = match.rows[0]
    if (row.status !== 'ACTIVE') {
      return res.status(400).json({ error: `match is already ${row.status}` })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE matches SET status = 'REJECTED' WHERE match_id = $1`,
        [match_id],
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
// All feedback for matches involving this user.

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
// Add a block without a prior match.

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
    res.json({ deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router
