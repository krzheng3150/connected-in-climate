// Must be set before any imports that read it
process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool } from './db.js'
import matchRouter from './match-api.js'
import feedbackRouter from './feedback-api.js'
import adminRouter from './admin-api.js'

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
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM user_profiles')

  const profiles = [
    ['mentor@test.com', 'Mentor', 'mentor', {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      top_strengths: ['Topic A'], general_topics: [],
      motivation: 'Helping.', max_capacity: 2, location: 'SF, CA',
      preferred_name: 'M', pronouns: 'they/them',
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
  app.use('/api/feedback', feedbackRouter)
  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`

  // Create a match
  await post('/api/matches/run', { email: 'mentee@test.com' })

  // Submit feedback
  const matchId = await getMatchId()
  await post('/api/feedback', { match_id: matchId, email: 'mentee@test.com', text: 'Great match!' })
})

after(async () => {
  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM user_profiles')
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

async function get(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers })
  return { status: res.status, data: await res.json() }
}

async function del(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers })
  return { status: res.status, data: await res.json() }
}

const admin = { 'x-user-email': 'admin@test.com' }

async function getMatchId() {
  const result = await pool.query(
    `SELECT match_id FROM matches WHERE mentee_email = 'mentee@test.com' AND rank = 1 LIMIT 1`,
  )
  return result.rows[0].match_id
}

// ── Auth middleware ─────────────────────────────────────────────────

describe('Admin auth', () => {
  it('returns 403 without x-user-email header', async () => {
    const { status } = await get('/api/admin/matches?email=mentee@test.com')
    assert.equal(status, 403)
  })

  it('returns 403 for non-admin email', async () => {
    const { status } = await get('/api/admin/matches?email=mentee@test.com', {
      'x-user-email': 'nobody@test.com',
    })
    assert.equal(status, 403)
  })

  it('allows admin email', async () => {
    const { status } = await get('/api/admin/matches?email=mentee@test.com', admin)
    assert.equal(status, 200)
  })
})

// ── GET /api/admin/profiles ────────────────────────────────────────

describe('GET /api/admin/profiles', () => {
  it('returns profile by email', async () => {
    const { status, data } = await get('/api/admin/profiles?email=mentor@test.com', admin)
    assert.equal(status, 200)
    assert.equal(data.profile.name, 'Mentor')
    assert.equal(data.profile.role, 'mentor')
    assert.ok(data.profile.payload.career_areas)
  })

  it('returns 404 for unknown email', async () => {
    const { status } = await get('/api/admin/profiles?email=nobody@test.com', admin)
    assert.equal(status, 404)
  })
})

// ── GET /api/admin/matches ─────────────────────────────────────────

describe('GET /api/admin/matches', () => {
  it('returns all matches including stored ranks', async () => {
    const { data } = await get('/api/admin/matches?email=mentee@test.com', admin)
    assert.ok(data.matches.length >= 1)
    const hasRank1 = data.matches.some(m => m.rank === 1)
    assert.ok(hasRank1)
  })

  it('includes computation_payload', async () => {
    const { data } = await get('/api/admin/matches?email=mentee@test.com', admin)
    const match = data.matches[0]
    assert.ok(match.computation_payload)
    assert.ok(match.computation_payload.scores)
    assert.ok(match.code_commit)
  })
})

// ── GET /api/admin/matches/:match_id ───────────────────────────────

describe('GET /api/admin/matches/:match_id', () => {
  it('returns full match detail with both profiles', async () => {
    const matchId = await getMatchId()
    const { status, data } = await get(`/api/admin/matches/${matchId}`, admin)
    assert.equal(status, 200)
    assert.ok(data.computation_payload)
    assert.ok(data.mentor_payload)
    assert.ok(data.mentee_payload)
    assert.ok(data.mentor_name)
  })

  it('returns 404 for unknown match', async () => {
    const { status } = await get('/api/admin/matches/00000000-0000-0000-0000-000000000000', admin)
    assert.equal(status, 404)
  })
})

// ── POST /api/admin/matches/:match_id/reject ───────────────────────

describe('POST /api/admin/matches/:match_id/reject', () => {
  it('rejects an active match', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post(
      `/api/admin/matches/${matchId}/reject`,
      { reason: 'Domain mismatch' },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.status, 'REJECTED')
    assert.equal(data.block_created, false)
  })

  it('match status is now REJECTED in DB', async () => {
    const matchId = await getMatchId()
    const result = await pool.query('SELECT status FROM matches WHERE match_id = $1', [matchId])
    assert.equal(result.rows[0].status, 'REJECTED')
  })

  it('returns 400 when rejecting an already rejected match', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post(
      `/api/admin/matches/${matchId}/reject`,
      { reason: 'Again' },
      admin,
    )
    assert.equal(status, 400)
    assert.ok(data.error.includes('already'))
  })
})

// ── POST /api/admin/matches/:match_id/reject with block ────────────

describe('Reject with block', () => {
  before(async () => {
    // Re-run matching to get a fresh ACTIVE match
    await pool.query(`UPDATE matches SET status = 'ACTIVE' WHERE mentee_email = 'mentee@test.com' AND rank = 1`)
  })

  it('rejects and creates a block entry', async () => {
    const matchId = await getMatchId()
    const { status, data } = await post(
      `/api/admin/matches/${matchId}/reject`,
      { reason: 'Conflict of interest', block: true },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.block_created, true)
    assert.ok(data.block_id)
  })
})

// ── GET /api/admin/feedback ────────────────────────────────────────

describe('GET /api/admin/feedback', () => {
  it('returns all feedback for matches involving user', async () => {
    const { status, data } = await get('/api/admin/feedback?email=mentee@test.com', admin)
    assert.equal(status, 200)
    assert.ok(data.feedbacks.length >= 1)
    assert.ok(data.feedbacks[0].text)
    assert.ok(data.feedbacks[0].submitter_email)
  })

  it('returns 400 without email', async () => {
    const { status } = await get('/api/admin/feedback', admin)
    assert.equal(status, 400)
  })
})

// ── Block list CRUD ────────────────────────────────────────────────

describe('Block list', () => {
  let blockId

  it('lists blocks', async () => {
    const { status, data } = await get('/api/admin/blocks', admin)
    assert.equal(status, 200)
    assert.ok(Array.isArray(data.blocks))
    assert.ok(data.blocks.length >= 1)
  })

  it('adds a block without a prior match', async () => {
    const { status, data } = await post('/api/admin/blocks', {
      mentor_email: 'mentor@test.com',
      mentee_email: 'someone@test.com',
      reason: 'Conflict of interest',
    }, admin)
    assert.equal(status, 201)
    assert.ok(data.block_id)
    blockId = data.block_id
  })

  it('returns 400 without required fields', async () => {
    const { status } = await post('/api/admin/blocks', { mentor_email: 'mentor@test.com' }, admin)
    assert.equal(status, 400)
  })

  it('deletes a block', async () => {
    const { status, data } = await del(`/api/admin/blocks/${blockId}`, admin)
    assert.equal(status, 200)
    assert.equal(data.deleted, true)
  })

  it('returns 404 deleting nonexistent block', async () => {
    const { status } = await del('/api/admin/blocks/00000000-0000-0000-0000-000000000000', admin)
    assert.equal(status, 404)
  })
})
