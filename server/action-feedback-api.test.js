import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool } from './db.js'
import matchRouter from './match-api.js'
import actionRouter from './action-api.js'
import feedbackRouter from './feedback-api.js'

let server, baseUrl

before(async () => {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS user_profiles (
      email TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('mentor','mentee','both')),
      payload JSONB NOT NULL DEFAULT '{}', embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS matches (
      match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentor_email TEXT NOT NULL REFERENCES user_profiles(email),
      mentee_email TEXT NOT NULL REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REJECTED','FINISHED','STORED')),
      final_score NUMERIC(5,4) NOT NULL, rank INTEGER NOT NULL,
      computation_payload JSONB NOT NULL, code_commit TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS match_actions (
      action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id UUID NOT NULL REFERENCES matches(match_id),
      actor_email TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('VIEW','FEEDBACK','CONTACT_CLICK','REJECT')),
      payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS feedbacks (
      feedback_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id UUID NOT NULL REFERENCES matches(match_id),
      submitter_email TEXT NOT NULL, rating SMALLINT,
      text TEXT NOT NULL, payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rejections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentor_email TEXT NOT NULL, mentee_email TEXT NOT NULL,
      match_id UUID REFERENCES matches(match_id), reason TEXT,
      created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')

  const profiles = [
    ['mentor@test.com', 'Mentor', 'mentor', {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      top_strengths: ['Topic A'], general_topics: [],
      motivation: 'Helping.', max_capacity: 2, location: 'SF, CA',
    }],
    ['mentee@test.com', 'Mentee', 'mentee', {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      top_topics: ['Topic A'], statement_of_intent: 'Transition.',
      w_horiz: 1, w_vert: 1, w_sector: 1, location: 'SF, CA', geo_match_preference: false,
    }],
  ]
  for (const [email, name, role, payload] of profiles) {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, payload=EXCLUDED.payload`,
      [email, name, role, JSON.stringify(payload)],
    )
  }

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use('/api/actions', actionRouter)
  app.use('/api/feedback', feedbackRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`

  await post('/api/matches/run', { email: 'mentee@test.com' })
})

after(async () => {
  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')
  server?.close()
  await pool.end()
})

async function post(path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, data: await res.json() }
}

async function getMatchId() {
  const { data } = await get('/api/matches?email=mentee@test.com')
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
    const { status, data } = await get(`/api/actions?match_id=${matchId}&email=mentee@test.com`)
    assert.equal(status, 200)
    assert.ok(data.actions.length >= 2)
    assert.ok(data.actions.some(a => a.action_type === 'VIEW'))
    assert.ok(data.actions.some(a => a.action_type === 'CONTACT_CLICK'))
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

  it('also logs a FEEDBACK action', async () => {
    const matchId = await getMatchId()
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
  it('lists feedback for a match', async () => {
    const matchId = await getMatchId()
    const { status, data } = await get(`/api/feedback?match_id=${matchId}&email=mentee@test.com`)
    assert.equal(status, 200)
    assert.ok(data.feedbacks.length >= 3)
    assert.ok(data.feedbacks[0].text)
    assert.ok(data.feedbacks[0].submitter_email)
  })

  it('returns 403 for unauthorized user', async () => {
    const matchId = await getMatchId()
    const { status } = await get(`/api/feedback?match_id=${matchId}&email=nobody@test.com`)
    assert.equal(status, 403)
  })
})
