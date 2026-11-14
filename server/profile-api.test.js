import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { pool, setupDb, resetDb } from './test-db.js'
import profileRouter from './profile-api.js'

let server, baseUrl

before(async () => {
  await setupDb()
  const app = express()
  app.use(express.json())
  app.use(clerkMiddleware())
  app.use('/api/profiles', profileRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

beforeEach(async () => {
  await resetDb()
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
    'SELECT email, name, role, payload, status FROM user_profiles WHERE email = $1',
    [email],
  )
  return result.rows[0] || null
}

async function getMentorApp(email) {
  const result = await pool.query(
    'SELECT email, status, payload, embedding IS NOT NULL AS has_embedding FROM mentor_applications WHERE email = $1',
    [email],
  )
  return result.rows[0] || null
}

async function getMenteeApp(email) {
  const result = await pool.query(
    'SELECT email, status, payload, embedding IS NOT NULL AS has_embedding FROM mentee_applications WHERE email = $1',
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
  it('creates a mentee application', async () => {
    const { status, data } = await post(VALID_MENTEE)
    assert.equal(status, 201)
    assert.equal(data.ok, true)

    const profile = await getProfile('new@test.com')
    assert.equal(profile.name, 'Jane Doe')
    assert.equal(profile.role, 'mentee')

    const app = await getMenteeApp('new@test.com')
    assert.equal(app.status, 'PENDING')
    assert.equal(app.payload.statement_of_intent, 'I want to learn about climate policy.')
    assert.equal(app.has_embedding, true)
  })

  it('creates a mentor application', async () => {
    const { status, data } = await post(VALID_MENTOR)
    assert.equal(status, 201)
    assert.equal(data.ok, true)

    const profile = await getProfile('new@test.com')
    assert.equal(profile.name, 'Alex Chen')
    assert.equal(profile.role, 'mentor')

    const app = await getMentorApp('new@test.com')
    assert.equal(app.status, 'PENDING')
    assert.equal(app.payload.motivation, 'I want to share my climate finance experience.')
    assert.equal(app.has_embedding, true)
  })

  it('returns 401 without auth', async () => {
    const { status } = await req('POST', '/api/profiles', VALID_MENTEE)
    assert.equal(status, 401)
  })

  it('returns 409 if application already exists', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await post({ ...VALID_MENTEE, name: 'Duplicate' })
    assert.equal(status, 409)
    assert.match(data.error, /already/i)
  })

  it('allows second application for other role', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await post(VALID_MENTOR)
    assert.equal(status, 201)
    assert.equal(data.ok, true)

    const profile = await getProfile('new@test.com')
    assert.equal(profile.role, 'both')

    const mentorApp = await getMentorApp('new@test.com')
    assert.ok(mentorApp)
    const menteeApp = await getMenteeApp('new@test.com')
    assert.ok(menteeApp)
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

  it('stores shared fields in user_profiles and role fields in application', async () => {
    await post({
      ...VALID_MENTEE,
      preferred_name: 'JD',
      pronouns: 'she/her',
      city: 'New York', country: 'US',
      organization: 'ClimateOrg',
      fun_fact: 'I climb mountains.',
    })
    const profile = await getProfile('new@test.com')
    assert.equal(profile.payload.preferred_name, 'JD')
    assert.equal(profile.payload.pronouns, 'she/her')
    assert.equal(profile.payload.city, 'New York')
    assert.equal(profile.payload.country, 'US')
    assert.equal(profile.payload.organization, 'ClimateOrg')
    assert.equal(profile.payload.fun_fact, 'I climb mountains.')

    const app = await getMenteeApp('new@test.com')
    assert.equal(app.payload.statement_of_intent, 'I want to learn about climate policy.')
  })

  it('stores multi-select arrays in shared payload', async () => {
    await post({
      ...VALID_MENTEE,
      climate_areas: ['ai_climate', 'adaptation'],
      sectors: ['nonprofit'],
    })
    const profile = await getProfile('new@test.com')
    assert.ok(profile.payload.climate_areas.length >= 1)
    assert.ok(profile.payload.sectors.length >= 1)
  })

  it('accepts the freelance sector', async () => {
    const { status } = await post({ ...VALID_MENTEE, sectors: ['freelance', 'startup'] })
    assert.equal(status, 201)
    const profile = await getProfile('new@test.com')
    assert.ok(profile.payload.sectors.includes('freelance'))
  })

  it('accepts the freelance sector by label', async () => {
    const { status } = await post({ ...VALID_MENTOR, sectors: ['Freelance / self-employed'] })
    assert.equal(status, 201)
    const profile = await getProfile('new@test.com')
    assert.deepEqual(profile.payload.sectors, ['freelance'])
  })

  it('stores optional name_pronunciation in shared payload', async () => {
    await post({ ...VALID_MENTEE, name_pronunciation: '  KEV-in ZHENG ' })
    const profile = await getProfile('new@test.com')
    assert.equal(profile.payload.name_pronunciation, 'KEV-in ZHENG')
  })

  it('creates a profile without name_pronunciation', async () => {
    const { status } = await post(VALID_MENTEE)
    assert.equal(status, 201)
    const profile = await getProfile('new@test.com')
    assert.equal(profile.payload.name_pronunciation, undefined)
  })

  it('rejects an overlong name_pronunciation', async () => {
    const { status, data } = await post({ ...VALID_MENTEE, name_pronunciation: 'x'.repeat(201) })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'name_pronunciation'))
  })

  it('stores links in shared payload', async () => {
    await post({
      ...VALID_MENTEE,
      links: { linkedin: 'https://linkedin.com/in/test' },
    })
    const profile = await getProfile('new@test.com')
    assert.equal(profile.payload.links.linkedin, 'https://linkedin.com/in/test')
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

  it('rejects text exceeding max length', async () => {
    const { status, data } = await post({
      ...VALID_MENTEE,
      statement_of_intent: 'x'.repeat(2001),
    })
    assert.equal(status, 400)
    assert.ok(data.errors.some(e => e.field === 'statement_of_intent'))
  })

  it('accepts text at max length', async () => {
    const { status } = await post({
      ...VALID_MENTEE,
      statement_of_intent: 'x'.repeat(2000),
    })
    assert.equal(status, 201)
  })

  it('deduplicates array values', async () => {
    await post({
      ...VALID_MENTEE,
      career_areas: ['consulting', 'consulting', 'engineering'],
    })
    const profile = await getProfile('new@test.com')
    assert.deepEqual(profile.payload.career_areas, ['consulting', 'engineering'])
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

  it('computes embedding for mentee application', async () => {
    await post(VALID_MENTEE)
    const app = await getMenteeApp('new@test.com')
    assert.equal(app.has_embedding, true)
  })

  it('computes embedding for mentor application', async () => {
    await post(VALID_MENTOR)
    const app = await getMentorApp('new@test.com')
    assert.equal(app.has_embedding, true)
  })
})

// ── PATCH /api/profiles (update) ───────────────────────────────────

describe('PATCH /api/profiles', () => {
  it('updates an existing mentee application', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await patch({
      ...VALID_MENTEE,
      name: 'Jane Updated',
      statement_of_intent: 'Updated goals for climate work.',
    })
    assert.equal(status, 200)
    assert.equal(data.ok, true)

    const profile = await getProfile('new@test.com')
    assert.equal(profile.name, 'Jane Updated')
    const app = await getMenteeApp('new@test.com')
    assert.equal(app.payload.statement_of_intent, 'Updated goals for climate work.')
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
      'SELECT embedding::text FROM mentee_applications WHERE email = $1',
      ['new@test.com'],
    )
    await patch({
      ...VALID_MENTEE,
      statement_of_intent: 'Completely different text about renewable energy and carbon markets.',
    })
    const after = await pool.query(
      'SELECT embedding::text FROM mentee_applications WHERE email = $1',
      ['new@test.com'],
    )
    assert.notEqual(before.rows[0].embedding, after.rows[0].embedding)
  })

  it('returns 404 if no application for that role', async () => {
    await post(VALID_MENTEE)
    const { status, data } = await patch(VALID_MENTOR)
    assert.equal(status, 404)
    assert.match(data.error, /no mentor application/i)
  })

  it('updates shared payload fields', async () => {
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
    const profile = await getProfile('new@test.com')
    assert.equal(profile.payload.preferred_name, 'Jane')
    assert.equal(profile.payload.fun_fact, 'I climb mountains.')
  })

  it('does not change application status on update', async () => {
    await post(VALID_MENTEE)
    const before = await getMenteeApp('new@test.com')
    assert.equal(before.status, 'PENDING')

    await patch({ ...VALID_MENTEE, name: 'Jane Updated' })
    const after = await getMenteeApp('new@test.com')
    assert.equal(after.status, 'PENDING')
  })

  it('updates updated_at timestamp', async () => {
    await post(VALID_MENTEE)
    const before = await pool.query(
      'SELECT updated_at FROM mentee_applications WHERE email = $1',
      ['new@test.com'],
    )
    await new Promise(r => setTimeout(r, 50))
    await patch({ ...VALID_MENTEE, name: 'Time Check' })
    const after = await pool.query(
      'SELECT updated_at FROM mentee_applications WHERE email = $1',
      ['new@test.com'],
    )
    assert.ok(after.rows[0].updated_at > before.rows[0].updated_at)
  })
})
