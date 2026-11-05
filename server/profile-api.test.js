import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
import profileRouter from './profile-api.js'

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
  `)

  const app = express()
  app.use(express.json())
  app.use(clerkMiddleware())
  app.use('/api/profiles', profileRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await pool.query('DELETE FROM user_profiles')
  server?.close()
  await pool.end()
})

beforeEach(async () => {
  await pool.query('DELETE FROM user_profiles')
})

async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${baseUrl}${path}`, opts)
  return { status: res.status, data: await res.json() }
}

function post(body, email = 'new@test.com') {
  return req('POST', '/api/profiles', body, { 'x-user-email': email })
}

function patch(body, email = 'new@test.com') {
  return req('PATCH', '/api/profiles', body, { 'x-user-email': email })
}

async function getProfile(email) {
  const result = await pool.query(
    'SELECT email, name, role, payload, embedding IS NOT NULL AS has_embedding FROM user_profiles WHERE email = $1',
    [email],
  )
  return result.rows[0] || null
}

const VALID_MENTEE = {
  name: 'Jane Doe',
  role: 'mentee',
  statement_of_intent: 'I want to learn about climate policy.',
  career_level: 'entry',
  climate_areas: ['ai_climate'],
  career_areas: ['consulting'],
}

const VALID_MENTOR = {
  name: 'Alex Chen',
  role: 'mentor',
  motivation: 'I want to share my climate finance experience.',
  career_level: 'lead',
  climate_areas: ['ai_climate'],
  career_areas: ['consulting'],
}

// ── POST /api/profiles (create) ────────────────────────────────────

describe('POST /api/profiles', () => {
  it('creates a mentee profile', async () => {
    const { status, data } = await post(VALID_MENTEE)
    assert.equal(status, 201)
    assert.equal(data.ok, true)

    const row = await getProfile('new@test.com')
    assert.equal(row.name, 'Jane Doe')
    assert.equal(row.role, 'mentee')
    assert.equal(row.payload.statement_of_intent, 'I want to learn about climate policy.')
    assert.equal(row.payload.career_level, 'entry')
    assert.equal(row.has_embedding, true)
  })

  it('creates a mentor profile', async () => {
    const { status, data } = await post(VALID_MENTOR)
    assert.equal(status, 201)
    assert.equal(data.ok, true)

    const row = await getProfile('new@test.com')
    assert.equal(row.name, 'Alex Chen')
    assert.equal(row.role, 'mentor')
    assert.equal(row.payload.motivation, 'I want to share my climate finance experience.')
    assert.equal(row.has_embedding, true)
  })

  it('returns 401 without auth', async () => {
    const { status } = await req('POST', '/api/profiles', VALID_MENTEE)
    assert.equal(status, 401)
  })

  it('returns 409 if profile already exists', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await post({ ...VALID_MENTEE, name: 'Duplicate' })
    assert.equal(status, 409)
    assert.match(data.error, /already exists/i)
  })

  it('rejects missing name', async () => {
    const { status, data } = await post({ ...VALID_MENTEE, name: '' })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'name'))
  })

  it('rejects invalid role', async () => {
    const { status, data } = await post({ ...VALID_MENTEE, role: 'wizard' })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'role'))
  })

  it('rejects mentee without statement_of_intent', async () => {
    const { status, data } = await post({ name: 'No Statement', role: 'mentee', career_level: 'entry', climate_areas: ['ai_climate'], career_areas: ['consulting'] })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'statement_of_intent'))
  })

  it('rejects mentor without motivation', async () => {
    const { status, data } = await post({ name: 'No Motivation', role: 'mentor', career_level: 'lead', climate_areas: ['ai_climate'], career_areas: ['consulting'] })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'motivation'))
  })

  it('stores free text fields in payload', async () => {
    await post({
      ...VALID_MENTEE,
      preferred_name: 'JD',
      pronouns: 'she/her',
      location: 'NYC',
      organization: 'ClimateOrg',
      fun_fact: 'I climb mountains.',
    })
    const row = await getProfile('new@test.com')
    assert.equal(row.payload.preferred_name, 'JD')
    assert.equal(row.payload.pronouns, 'she/her')
    assert.equal(row.payload.location, 'NYC')
    assert.equal(row.payload.organization, 'ClimateOrg')
    assert.equal(row.payload.fun_fact, 'I climb mountains.')
  })

  it('stores multi-select arrays in payload', async () => {
    await post({
      ...VALID_MENTEE,
      climate_areas: ['ai_climate', 'adaptation'],
      sectors: ['nonprofit'],
    })
    const row = await getProfile('new@test.com')
    assert.ok(row.payload.climate_areas.length >= 1)
    assert.ok(row.payload.sectors.length >= 1)
  })

  it('stores links in payload', async () => {
    await post({
      ...VALID_MENTEE,
      links: { linkedin: 'https://linkedin.com/in/test' },
    })
    const row = await getProfile('new@test.com')
    assert.equal(row.payload.links.linkedin, 'https://linkedin.com/in/test')
  })

  it('rejects javascript: URL in links', async () => {
    const { status, data } = await post({
      ...VALID_MENTEE,
      links: { linkedin: 'javascript:alert(1)' },
    })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'links'))
  })

  it('rejects data: URL in links', async () => {
    const { status, data } = await post({
      ...VALID_MENTEE,
      links: { linkedin: 'data:text/html,<script>alert(1)</script>' },
    })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'links'))
  })

  it('accepts http:// URL in links', async () => {
    const { status } = await post({
      ...VALID_MENTEE,
      links: { linkedin: 'http://linkedin.com/in/test' },
    })
    assert.equal(status, 201)
  })

  it('rejects missing career_level', async () => {
    const { status, data } = await post({ name: 'No Level', role: 'mentee', statement_of_intent: 'Goals.', climate_areas: ['ai_climate'], career_areas: ['consulting'] })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'career_level'))
  })

  it('rejects missing climate_areas', async () => {
    const { status, data } = await post({ ...VALID_MENTEE, climate_areas: [] })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'climate_areas'))
  })

  it('rejects missing career_areas', async () => {
    const { status, data } = await post({ ...VALID_MENTEE, career_areas: [] })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'career_areas'))
  })

  it('returns structured errors with field and message', async () => {
    const { status, data } = await post({ name: '', role: 'mentee' })
    assert.equal(status, 400)
    assert.ok(data.errors.length >= 1)
    for (const err of data.errors) {
      assert.ok(err.field, 'each error should have a field')
      assert.ok(err.message, 'each error should have a message')
    }
  })

  it('rejects invalid enum value', async () => {
    const { status, data } = await post({
      ...VALID_MENTEE,
      career_level: 'supreme_overlord',
    })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'career_level'))
  })

  it('computes embedding from statement_of_intent for mentees', async () => {
    await post(VALID_MENTEE)
    const result = await pool.query(
      'SELECT embedding IS NOT NULL AS has_embedding FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    assert.equal(result.rows[0].has_embedding, true)
  })

  it('computes embedding from motivation for mentors', async () => {
    await post(VALID_MENTOR)
    const result = await pool.query(
      'SELECT embedding IS NOT NULL AS has_embedding FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    assert.equal(result.rows[0].has_embedding, true)
  })
})

// ── PATCH /api/profiles (update) ───────────────────────────────────

describe('PATCH /api/profiles', () => {
  it('updates an existing profile', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await patch({
      ...VALID_MENTEE,
      name: 'Jane Updated',
      statement_of_intent: 'Updated goals for climate work.',
    })
    assert.equal(status, 200)
    assert.equal(data.ok, true)

    const row = await getProfile('new@test.com')
    assert.equal(row.name, 'Jane Updated')
    assert.equal(row.payload.statement_of_intent, 'Updated goals for climate work.')
  })

  it('returns 404 if no profile exists', async () => {
    const { status, data } = await patch(VALID_MENTEE, 'ghost@test.com')
    assert.equal(status, 404)
    assert.match(data.error, /not found/i)
  })

  it('returns 401 without auth', async () => {
    const { status } = await req('PATCH', '/api/profiles', VALID_MENTEE)
    assert.equal(status, 401)
  })

  it('validates the updated body', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await patch({ ...VALID_MENTEE, name: '' })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'name'))
  })

  it('recomputes embedding on update', async () => {
    await post(VALID_MENTEE)
    const before = await pool.query(
      'SELECT embedding::text FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    await patch({
      ...VALID_MENTEE,
      statement_of_intent: 'Completely different text about renewable energy and carbon markets.',
    })
    const after = await pool.query(
      'SELECT embedding::text FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    assert.notEqual(before.rows[0].embedding, after.rows[0].embedding)
  })

  it('updates role from mentee to mentor', async () => {
    await post(VALID_MENTEE)
    const { status } = await patch(VALID_MENTOR)
    assert.equal(status, 200)

    const row = await getProfile('new@test.com')
    assert.equal(row.role, 'mentor')
    assert.equal(row.name, 'Alex Chen')
    assert.equal(row.payload.motivation, 'I want to share my climate finance experience.')
  })

  it('updates payload fields without losing unrelated data', async () => {
    await post({
      ...VALID_MENTEE,
      preferred_name: 'JD',
      fun_fact: 'I climb mountains.',
    })
    await patch({
      ...VALID_MENTEE,
      preferred_name: 'Jane',
      fun_fact: 'I climb mountains.',
    })
    const row = await getProfile('new@test.com')
    assert.equal(row.payload.preferred_name, 'Jane')
    assert.equal(row.payload.fun_fact, 'I climb mountains.')
  })

  it('updates updated_at timestamp', async () => {
    await post(VALID_MENTEE)
    const before = await pool.query(
      'SELECT updated_at FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    await new Promise(r => setTimeout(r, 50))
    await patch({ ...VALID_MENTEE, name: 'Time Check' })
    const after = await pool.query(
      'SELECT updated_at FROM user_profiles WHERE email = $1',
      ['new@test.com'],
    )
    assert.ok(after.rows[0].updated_at > before.rows[0].updated_at)
  })
})
