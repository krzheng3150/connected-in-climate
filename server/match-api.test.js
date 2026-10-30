import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import pg from 'pg'
import matchRouter from './match-api.js'
import { pool } from './db.js'

// ── Test server setup ──────────────────────────────────────────────

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
    CREATE TABLE IF NOT EXISTS rejections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentor_email TEXT NOT NULL, mentee_email TEXT NOT NULL,
      match_id UUID REFERENCES matches(match_id), reason TEXT,
      created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')

  const profiles = [
    ['mentor1@test.com', 'Mentor One', 'mentor', {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      top_strengths: ['Topic A', 'Topic B'], general_topics: ['Topic C'],
      motivation: 'Helping people.', max_capacity: 2,
      location: 'SF, CA', locations_open_to: ['SF, CA', 'Remote'],
      preferred_name: 'M1', pronouns: 'they/them',
      links: { linkedin: 'https://linkedin.com/test' },
    }],
    ['mentor2@test.com', 'Mentor Two', 'mentor', {
      career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
      top_strengths: ['Topic X'], general_topics: [],
      motivation: 'Policy work.', max_capacity: 1,
      location: 'DC',
    }],
    ['mentee1@test.com', 'Mentee One', 'mentee', {
      career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
      top_topics: ['Topic A', 'Topic C'], statement_of_intent: 'Transition to climate.',
      w_horiz: 3, w_vert: 3, w_sector: 3,
      location: 'SF, CA', geo_match_preference: true,
    }],
    ['mentee2@test.com', 'Mentee Two', 'mentee', {
      career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
      top_topics: ['Topic X'], statement_of_intent: 'Policy career.',
      w_horiz: 1, w_vert: 5, w_sector: 3,
      location: 'DC', geo_match_preference: false,
    }],
  ]

  for (const [email, name, role, payload] of profiles) {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, payload=EXCLUDED.payload`,
      [email, name, role, JSON.stringify(payload)],
    )
  }

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')
  server?.close()
  await pool.end()
})

// ── Helpers ────────────────────────────────────────────────────────

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

// ── POST /api/matches/run ──────────────────────────────────────────

describe('POST /api/matches/run', () => {
  it('returns 400 when email is missing', async () => {
    const { status, data } = await post('/api/matches/run', {})
    assert.equal(status, 400)
    assert.equal(data.error, 'email is required')
  })

  it('returns 404 for unknown email', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'nobody@test.com' })
    assert.equal(status, 404)
    assert.equal(data.error, 'profile not found')
  })

  it('returns 400 for non-mentee role', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentor1@test.com' })
    assert.equal(status, 400)
    assert.equal(data.error, 'user is not a mentee')
  })

  it('runs matching and returns rank=1 result', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentee1@test.com' })
    assert.equal(status, 200)
    assert.ok(data.match)
    assert.equal(data.match.rank, 1)
    assert.equal(data.match.mentor_email, 'mentor1@test.com')
    assert.ok(data.match.final_score > 0)
    assert.equal(data.total_scored, 2)
  })

  it('stores all ranked results in DB', async () => {
    const result = await pool.query(
      `SELECT rank, status, mentor_email FROM matches
       WHERE mentee_email = 'mentee1@test.com' ORDER BY rank`,
    )
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0].rank, 1)
    assert.equal(result.rows[0].status, 'ACTIVE')
    assert.equal(result.rows[1].rank, 2)
    assert.equal(result.rows[1].status, 'STORED')
  })

  it('stores computation payload with score breakdown', async () => {
    const result = await pool.query(
      `SELECT computation_payload FROM matches
       WHERE mentee_email = 'mentee1@test.com' AND rank = 1`,
    )
    const payload = result.rows[0].computation_payload
    assert.ok(payload.scores)
    assert.ok(payload.scores.categorical)
    assert.ok(payload.scores.topic)
    assert.ok(payload.scores.semantic)
    assert.ok(payload.scores.geo)
    assert.ok(payload.scores.weights_used)
    assert.ok(payload.mentee_snapshot)
    assert.ok(payload.mentor_snapshot)
  })

  it('returns no-match when all mentors filtered', async () => {
    await pool.query(
      `UPDATE user_profiles SET payload = jsonb_set(payload, '{max_capacity}', '0')
       WHERE role = 'mentor'`,
    )
    const { status, data } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    assert.equal(status, 200)
    assert.equal(data.match, null)
    assert.ok(data.message.includes('No mentors'))

    await pool.query(
      `UPDATE user_profiles SET payload = jsonb_set(payload, '{max_capacity}', '2')
       WHERE email = 'mentor1@test.com'`,
    )
    await pool.query(
      `UPDATE user_profiles SET payload = jsonb_set(payload, '{max_capacity}', '1')
       WHERE email = 'mentor2@test.com'`,
    )
  })
})

// ── GET /api/matches ───────────────────────────────────────────────

describe('GET /api/matches', () => {
  it('returns 400 when email is missing', async () => {
    const { status, data } = await get('/api/matches')
    assert.equal(status, 400)
    assert.equal(data.error, 'email query param is required')
  })

  it('returns empty array for user with no matches', async () => {
    const { status, data } = await get('/api/matches?email=nobody@test.com')
    assert.equal(status, 200)
    assert.deepEqual(data.matches, [])
  })

  it('returns only rank=1 active matches', async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com')
    assert.ok(data.matches.length >= 1)
    for (const m of data.matches) {
      assert.equal(m.status, 'ACTIVE')
    }
  })

  it('includes partner names in response', async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com')
    const match = data.matches[0]
    assert.ok(match.mentor_name)
    assert.ok(match.mentee_name)
    assert.ok(match.match_id)
    assert.ok(match.created_at)
  })

  it('shows match from mentor perspective too', async () => {
    const { data } = await get('/api/matches?email=mentor1@test.com')
    assert.ok(data.matches.length >= 1)
    assert.equal(data.matches[0].mentor_email, 'mentor1@test.com')
  })
})

// ── GET /api/matches/:match_id ─────────────────────────────────────

describe('GET /api/matches/:match_id', () => {
  let matchId

  before(async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com')
    matchId = data.matches[0].match_id
  })

  it('returns 400 when email is missing', async () => {
    const { status, data } = await get(`/api/matches/${matchId}`)
    assert.equal(status, 400)
    assert.equal(data.error, 'email query param is required')
  })

  it('returns 404 for unknown match_id', async () => {
    const { status } = await get('/api/matches/00000000-0000-0000-0000-000000000000?email=mentee1@test.com')
    assert.equal(status, 404)
  })

  it('returns 403 for unauthorized user', async () => {
    const { status, data } = await get(`/api/matches/${matchId}?email=nobody@test.com`)
    assert.equal(status, 403)
    assert.equal(data.error, 'not authorized to view this match')
  })

  it('returns match detail with partner profile for mentee', async () => {
    const { status, data } = await get(`/api/matches/${matchId}?email=mentee1@test.com`)
    assert.equal(status, 200)
    assert.equal(data.your_role, 'mentee')
    assert.equal(data.partner.email, 'mentor1@test.com')
    assert.equal(data.partner.name, 'Mentor One')
    assert.equal(data.partner.preferred_name, 'M1')
    assert.equal(data.partner.pronouns, 'they/them')
    assert.deepEqual(data.partner.links, { linkedin: 'https://linkedin.com/test' })
    assert.ok(data.partner.career_areas)
    assert.ok(data.partner.motivation)
  })

  it('returns match detail with partner profile for mentor', async () => {
    const { status, data } = await get(`/api/matches/${matchId}?email=mentor1@test.com`)
    assert.equal(status, 200)
    assert.equal(data.your_role, 'mentor')
    assert.equal(data.partner.email, 'mentee1@test.com')
    assert.ok(data.partner.statement_of_intent)
  })
})
