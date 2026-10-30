import { Router } from 'express'
import { pool } from './db.js'

const router = Router()

const VALID_ACTIONS = new Set(['VIEW', 'CONTACT_CLICK', 'FEEDBACK', 'REJECT'])

// ── POST /api/actions ──────────────────────────────────────────────
// Log an action (VIEW, CONTACT_CLICK, etc.) against a match.

router.post('/', async (req, res, next) => {
  try {
    const { match_id, email, action_type, payload } = req.body

    if (!match_id) return res.status(400).json({ error: 'match_id is required' })
    if (!email) return res.status(400).json({ error: 'email is required' })
    if (!action_type || !VALID_ACTIONS.has(action_type)) {
      return res.status(400).json({ error: `action_type must be one of: ${[...VALID_ACTIONS].join(', ')}` })
    }

    const match = await pool.query(
      'SELECT mentor_email, mentee_email FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }

    const normalEmail = email.toLowerCase().trim()
    const row = match.rows[0]
    if (row.mentor_email !== normalEmail && row.mentee_email !== normalEmail) {
      return res.status(403).json({ error: 'not authorized for this match' })
    }

    const result = await pool.query(
      `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
       VALUES ($1, $2, $3, $4)
       RETURNING action_id, created_at`,
      [match_id, normalEmail, action_type, payload ? JSON.stringify(payload) : null],
    )

    res.status(201).json({
      action_id: result.rows[0].action_id,
      created_at: result.rows[0].created_at,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/actions?match_id= ─────────────────────────────────────
// List actions for a match.

router.get('/', async (req, res, next) => {
  try {
    const { match_id, email } = req.query
    if (!match_id) return res.status(400).json({ error: 'match_id query param is required' })
    if (!email) return res.status(400).json({ error: 'email query param is required' })

    const normalEmail = email.toLowerCase().trim()
    const match = await pool.query(
      'SELECT mentor_email, mentee_email FROM matches WHERE match_id = $1',
      [match_id],
    )
    if (match.rows.length === 0) {
      return res.status(404).json({ error: 'match not found' })
    }
    const row = match.rows[0]
    if (row.mentor_email !== normalEmail && row.mentee_email !== normalEmail) {
      return res.status(403).json({ error: 'not authorized for this match' })
    }

    const result = await pool.query(
      `SELECT action_id, actor_email, action_type, payload, created_at
       FROM match_actions WHERE match_id = $1 ORDER BY created_at DESC`,
      [match_id],
    )

    res.json({ actions: result.rows })
  } catch (err) {
    next(err)
  }
})

export default router
