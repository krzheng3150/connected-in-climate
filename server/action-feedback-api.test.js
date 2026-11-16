process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'
import adminRouter from './admin-api.js'
import actionRouter from './action-api.js'
import feedbackRouter from './feedback-api.js'

let server, baseUrl

// Test data lives at module level so every test can rebuild it from scratch.
const PROFILES = [
  {
    email: 'mentor@test.com', name: 'Mentor', role: 'mentor',
    shared: {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      city: 'San Francisco', country: 'US',
    },
    mentorPayload: {
      top_strengths: ['Topic A'], general_topics: [],
      motivation: 'Helping.', max_capacity: 2,
    },
  },
  {
    email: 'mentee@test.com', name: 'Mentee', role: 'mentee',
    shared: {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      w_horiz: 1, w_vert: 1, w_sector: 1, city: 'San Francisco', country: 'US',
    },
    menteePayload: {
      top_topics: ['Topic A'], statement_of_intent: 'Transition.',
    },
  },
]

before(async () => {
  await setupDb()
  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/actions', actionRouter)
  app.use('/api/feedback', feedbackRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

// Every test starts from the same known state: seeded profiles and one ACTIVE match.
// Tests that need actions or feedback create them first, so they pass in any order.
beforeEach(async () => {
  await resetDb()
  for (const p of PROFILES) {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, payload=EXCLUDED.payload`,
      [p.email, p.name, p.role, JSON.stringify(p.shared)],
    )
    if (p.mentorPayload) {
      await pool.query(
        `INSERT INTO mentor_applications (email, status, payload) VALUES ($1, 'APPROVED', $2)
         ON CONFLICT (email) DO UPDATE SET payload=EXCLUDED.payload`,
        [p.email, JSON.stringify(p.mentorPayload)],
      )
    }
    if (p.menteePayload) {
      await pool.query(
        `INSERT INTO mentee_applications (email, status, payload) VALUES ($1, 'APPROVED', $2)
         ON CONFLICT (email) DO UPDATE SET payload=EXCLUDED.payload`,
        [p.email, JSON.stringify(p.menteePayload)],
      )
    }
  }

  // Create run → admin review (1 approved → auto-activate) so we have an ACTIVE match
  const { data: runData } = await post('/api/matches/run', { email: 'mentee@test.com' })
  const runId = runData.run.run_id

  const candidates = await pool.query(
    `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE' ORDER BY rank LIMIT 1`,
    [runId],
  )
  await post(
    `/api/admin/runs/${runId}/review`,
    { approved: [candidates.rows[0].match_id] },
    { 'x-user-email': 'admin@test.com' },
  )
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, data: await res.json() }
}

async function getMatchId() {
  const { data } = await get('/api/matches?email=mentee@test.com&role=mentee')
  return data.matches[0].match_id
}

// ── POST /api/actions ──────────────────────────────────────────────

describe('POST /api/actions', () => {
  it('returns 400 when match_id is missing', async () => {
    const { status, data } = await post('/api/actions', { email: 'mentee@test.com', action_type: 'VIEW' })
    assert.equal(status, 400)
    assert.equal(data.error, 'match_id is required')
  })

  it('returns 400 for invalid action_type', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post('/api/actions', {
      match_id: matchId, email: 'mentee@test.com', action_type: 'INVALID',
    })
    assert.equal(status, 400)
    assert.ok(data.error.includes('action_type'))
  })

  it('returns 403 for unauthorized user', async () => {
    const matchId = await getMatchId()
    const { status } = await post('/api/actions', {
      match_id: matchId, email: 'nobody@test.com', action_type: 'VIEW',
    })
    assert.equal(status, 403)
  })

  it('logs a VIEW action', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post('/api/actions', {
      match_id: matchId, email: 'mentee@test.com', action_type: 'VIEW',
    })
    assert.equal(status, 201)
    assert.ok(data.action_id)
    assert.ok(data.created_at)
  })

  it('logs a CONTACT_CLICK action with payload', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post('/api/actions', {
      match_id: matchId, email: 'mentee@test.com', action_type: 'CONTACT_CLICK',
      payload: { link_type: 'linkedin' },
    })
    assert.equal(status, 201)
    assert.ok(data.action_id)
  })

  it('allows mentor to log actions too', async () => {
    const matchId = await getMatchId()
    const { status } = await post('/api/actions', {
      match_id: matchId, email: 'mentor@test.com', action_type: 'VIEW',
    })
    assert.equal(status, 201)
  })
})

// ── GET /api/actions ───────────────────────────────────────────────

describe('GET /api/actions', () => {
  it('returns 400 when match_id is missing', async () => {
    const { status } = await get('/api/actions?email=mentee@test.com')
    assert.equal(status, 400)
  })

  it('returns 403 for unauthorized user', async () => {
    const matchId = await getMatchId()
    const { status } = await get(`/api/actions?match_id=${matchId}&email=nobody@test.com`)
    assert.equal(status, 403)
  })

  it('lists actions for a match', async () => {
    const matchId = await getMatchId()
    await post('/api/actions', { match_id: matchId, email: 'mentee@test.com', action_type: 'VIEW' })
    await post('/api/actions', { match_id: matchId, email: 'mentee@test.com', action_type: 'CONTACT_CLICK', payload: { link_type: 'linkedin' } })

    const { status, data } = await get(`/api/actions?match_id=${matchId}&email=mentee@test.com`)
    assert.equal(status, 200)
    // APPROVE is the admin review that activated the match in the baseline setup
    assert.deepEqual(data.actions.map(a => a.action_type).sort(), ['APPROVE', 'CONTACT_CLICK', 'VIEW'])
  })
})

// ── POST /api/feedback ─────────────────────────────────────────────

describe('POST /api/feedback', () => {
  it('returns 400 when text is missing', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post('/api/feedback', {
      match_id: matchId, email: 'mentee@test.com',
    })
    assert.equal(status, 400)
    assert.equal(data.error, 'text is required')
  })

  it('returns 403 for unauthorized user', async () => {
    const matchId = await getMatchId()
    const { status } = await post('/api/feedback', {
      match_id: matchId, email: 'nobody@test.com', text: 'Great match!',
    })
    assert.equal(status, 403)
  })

  it('submits feedback', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post('/api/feedback', {
      match_id: matchId, email: 'mentee@test.com', text: 'Great match!', rating: 5,
    })
    assert.equal(status, 201)
    assert.ok(data.feedback_id)
    assert.ok(data.created_at)
  })

  for (const bad of [0, 6, -1, 3.5, 'abc', 100000]) {
    it(`rejects rating ${JSON.stringify(bad)}`, async () => {
      const matchId = await getMatchId()
      const { status, data } = await post('/api/feedback', {
        match_id: matchId, email: 'mentee@test.com', text: 'x', rating: bad,
      })
      assert.equal(status, 400)
      assert.match(data.error, /rating/)
    })
  }

  it('accepts a numeric-string rating and an omitted rating', async () => {
    const matchId = await getMatchId()
    const a = await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'x', rating: '4' })
    const b = await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'x' })
    assert.equal(a.status, 201)
    assert.equal(b.status, 201)
    const stored = await pool.query(`SELECT rating FROM feedbacks WHERE feedback_id = $1`, [a.data.feedback_id])
    assert.equal(stored.rows[0].rating, 4)
  })

  it('rejects feedback on a non-active match, but allows FINISHED', async () => {
    const matchId = await getMatchId()
    try {
      for (const st of ['CANDIDATE', 'STORED', 'REJECTED', 'APPROVED']) {
        await pool.query(`UPDATE matches SET status = $2 WHERE match_id = $1`, [matchId, st])
        const { status, data } = await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'x' })
        assert.equal(status, 400, st)
        assert.match(data.error, /not accepted/)
      }
      await pool.query(`UPDATE matches SET status = 'FINISHED' WHERE match_id = $1`, [matchId])
      const ok = await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'after the end' })
      assert.equal(ok.status, 201)
    } finally {
      await pool.query(`UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`, [matchId])
    }
  })

  it('also logs a FEEDBACK action', async () => {
    const matchId = await getMatchId()
    await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'Great match!', rating: 5 })
    const { data } = await get(`/api/actions?match_id=${matchId}&email=mentee@test.com`)
    assert.ok(data.actions.some(a => a.action_type === 'FEEDBACK'))
  })

  it('allows multiple feedbacks per match', async () => {
    const matchId = await getMatchId()
    const { status } = await post('/api/feedback', {
      match_id: matchId, email: 'mentee@test.com', text: 'Second feedback.',
    })
    assert.equal(status, 201)
  })

  it('allows mentor to submit feedback', async () => {
    const matchId = await getMatchId()
    const { status } = await post('/api/feedback', {
      match_id: matchId, email: 'mentor@test.com', text: 'Good mentee.',
    })
    assert.equal(status, 201)
  })
})

// ── GET /api/feedback ──────────────────────────────────────────────

describe('GET /api/feedback', () => {
  it('returns only the requesting user\'s own feedback', async () => {
    const matchId = await getMatchId()
    await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'First', rating: 5 })
    await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'Second' })
    await post('/api/feedback', { match_id: matchId, email: 'mentor@test.com', text: 'Good mentee.' })

    const { status, data } = await get(`/api/feedback?match_id=${matchId}&email=mentee@test.com`)
    assert.equal(status, 200)
    assert.equal(data.feedbacks.length, 2)
    for (const fb of data.feedbacks) {
      assert.equal(fb.submitter_email, 'mentee@test.com')
    }
  })

  it('does not show partner feedback to the other user', async () => {
    const matchId = await getMatchId()
    await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'Mentee view' })
    await post('/api/feedback', { match_id: matchId, email: 'mentor@test.com', text: 'Good mentee.' })

    const { status, data } = await get(`/api/feedback?match_id=${matchId}&email=mentor@test.com`)
    assert.equal(status, 200)
    assert.equal(data.feedbacks.length, 1)
    assert.equal(data.feedbacks[0].submitter_email, 'mentor@test.com')
    assert.equal(data.feedbacks[0].text, 'Good mentee.')
  })

  it('returns 403 for unauthorized user', async () => {
    const matchId = await getMatchId()
    const { status } = await get(`/api/feedback?match_id=${matchId}&email=nobody@test.com`)
    assert.equal(status, 403)
  })
})
