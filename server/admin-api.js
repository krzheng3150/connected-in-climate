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

// ── Helpers ───────────────────────────────────────────────────────

async function checkAutoActivate(client, menteeEmail, adminEmail) {
  const pending = await client.query(
    `SELECT COUNT(*) FROM matches WHERE mentee_email = $1 AND status = 'PENDING_REVIEW'`,
    [menteeEmail],
  )
  if (parseInt(pending.rows[0].count) > 0) return null

  const approved = await client.query(
    `SELECT match_id FROM matches WHERE mentee_email = $1 AND status = 'ADMIN_APPROVED'`,
    [menteeEmail],
  )

  if (approved.rows.length === 1) {
    const autoId = approved.rows[0].match_id
    await client.query(
      `UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`,
      [autoId],
    )
    await client.query(
      `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
       VALUES ($1, $2, 'APPROVE', $3)`,
      [autoId, adminEmail, JSON.stringify({ auto_activated: true })],
    )
    return autoId
  }

  return null
}

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
// All mentees with PENDING_REVIEW or ADMIN_APPROVED matches, grouped.

router.get('/pending', async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT m.match_id, m.mentor_email, m.mentee_email, m.status,
              m.final_score, m.rank, m.computation_payload, m.created_at,
              mentor.name AS mentor_name, mentee.name AS mentee_name
       FROM matches m
       JOIN user_profiles mentor ON mentor.email = m.mentor_email
       JOIN user_profiles mentee ON mentee.email = m.mentee_email
       WHERE m.status IN ('PENDING_REVIEW', 'ADMIN_APPROVED')
       ORDER BY m.mentee_email, m.rank ASC`,
    )

    const groups = new Map()
    for (const row of result.rows) {
      if (!groups.has(row.mentee_email)) {
        groups.set(row.mentee_email, {
          mentee_email: row.mentee_email,
          mentee_name: row.mentee_name,
          matches: [],
        })
      }
      groups.get(row.mentee_email).matches.push({
        match_id: row.match_id,
        mentor_email: row.mentor_email,
        mentor_name: row.mentor_name,
        status: row.status,
        final_score: parseFloat(row.final_score),
        rank: row.rank,
        computation_payload: row.computation_payload,
        created_at: row.created_at,
      })
    }

    res.json({ pending_groups: [...groups.values()] })
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

// ── POST /api/admin/matches/:match_id/approve ─────────────────────
// Approve a PENDING_REVIEW match. If it's the only one left, auto-activate.

router.post('/matches/:match_id/approve', async (req, res, next) => {
  try {
    const { match_id } = req.params

    const match = await pool.query(
      'SELECT match_id, mentor_email, mentee_email, status FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const row = match.rows[0]
    if (row.status !== 'PENDING_REVIEW') {
      return res.status(400).json({ error: `match is ${row.status}, not PENDING_REVIEW` })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `UPDATE matches SET status = 'ADMIN_APPROVED' WHERE match_id = $1`,
        [match_id],
      )

      await client.query(
        `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
         VALUES ($1, $2, 'APPROVE', '{}')`,
        [match_id, req.adminEmail],
      )

      const autoActivated = await checkAutoActivate(client, row.mentee_email, req.adminEmail)

      await client.query('COMMIT')
      res.json({
        status: autoActivated ? 'ACTIVE' : 'ADMIN_APPROVED',
        auto_activated: autoActivated === match_id,
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

// ── POST /api/admin/matches/:match_id/reject ───────────────────────
// Reject a match (ACTIVE, PENDING_REVIEW, or ADMIN_APPROVED). Optionally block the pair.

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
    const rejectableStatuses = new Set(['ACTIVE', 'PENDING_REVIEW', 'ADMIN_APPROVED'])
    if (!rejectableStatuses.has(row.status)) {
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

      let autoActivated = null
      if (row.status === 'PENDING_REVIEW' || row.status === 'ADMIN_APPROVED') {
        autoActivated = await checkAutoActivate(client, row.mentee_email, req.adminEmail)
      }

      await client.query('COMMIT')
      res.json({
        status: 'REJECTED',
        block_created: !!block,
        block_id: blockId,
        auto_activated_match: autoActivated,
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
