import { Router } from 'express'
import { pool } from './db.js'

const router = Router()

// ── POST /api/feedback ─────────────────────────────────────────────
// Submit feedback for a match.

router.post('/', async (req, res, next) => {
  try {
    const { match_id, email, text, rating, payload } = req.body

    if (!match_id) return res.status(400).json({ error: 'match_id is required' })
    if (!email) return res.status(400).json({ error: 'email is required' })
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' })

    const match = await pool.query(
      'SELECT mentor_email, mentee_email, status FROM matches WHERE match_id = $1',
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
      `INSERT INTO feedbacks (match_id, submitter_email, text, rating, payload)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING feedback_id, created_at`,
      [match_id, normalEmail, text.trim(), rating ?? null, payload ? JSON.stringify(payload) : null],
    )

    await pool.query(
      `INSERT INTO match_actions (match_id, actor_email, action_type, payload)
       VALUES ($1, $2, 'FEEDBACK', $3)`,
      [match_id, normalEmail, JSON.stringify({ feedback_id: result.rows[0].feedback_id })],
    )

    res.status(201).json({
      feedback_id: result.rows[0].feedback_id,
      created_at: result.rows[0].created_at,
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/feedback?match_id= ────────────────────────────────────
// List feedback for a match.

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
      `SELECT feedback_id, submitter_email, text, rating, payload, created_at
       FROM feedbacks WHERE match_id = $1 AND submitter_email = $2 ORDER BY created_at DESC`,
      [match_id, normalEmail],
    )

    res.json({ feedbacks: result.rows })
  } catch (err) {
    next(err)
  }
})

export default router
