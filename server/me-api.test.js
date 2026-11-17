// GET /api/profiles/me, the health check and the API 404, served by the real app
// (server/app.js), including the auth middleware. This endpoint drives the whole
// dashboard: which role view to show, whether to show the application form, and the
// profile data the edit form pre-fills.
process.env.ADMIN_EMAILS = 'admin@test.com'
// The health check pings Google Drive in the background; never do that from tests.
process.env.GOOGLE_OAUTH_CLIENT_ID = ''
process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = ''

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { pool, setupDb, resetDb } from './test-db.js'
import app from './app.js'

let server, baseUrl

before(async () => {
  await setupDb()
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})
after(async () => { await resetDb(); server?.close(); await pool.end() })
beforeEach(async () => { await resetDb() })

async function me(email, { headers = {} } = {}) {
  const res = await fetch(`${baseUrl}/api/profiles/me`, {
    headers: { ...(email ? { 'x-user-email': email } : {}), ...headers },
  })
  return { status: res.status, data: await res.json() }
}

async function seed(email, { shared = {}, mentor, mentee, name = 'Test User' } = {}) {
  await pool.query(`INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, 'mentee', $3)`,
    [email, name, JSON.stringify(shared)])
  if (mentor) {
    await pool.query(`INSERT INTO mentor_applications (email, status, payload) VALUES ($1, $2, $3)`,
      [email, mentor.status ?? 'APPROVED', JSON.stringify(mentor.payload ?? {})])
  }
  if (mentee) {
    await pool.query(`INSERT INTO mentee_applications (email, status, payload) VALUES ($1, $2, $3)`,
      [email, mentee.status ?? 'APPROVED', JSON.stringify(mentee.payload ?? {})])
  }
}

describe('GET /api/profiles/me: authentication', () => {
  it('returns 401 with no credentials', async () => {
    const { status, data } = await me(null)
    assert.equal(status, 401)
    assert.equal(data.error, 'not authenticated')
  })

  it('matches the email case-insensitively', async () => {
    await seed('mixed@test.com', { mentee: { payload: { statement_of_intent: 'hi' } } })
    const { status, data } = await me('Mixed@TEST.com')
    assert.equal(status, 200)
    assert.equal(data.email, 'mixed@test.com')
    assert.equal(data.has_profile, true)
  })

  it('in production, an admin email in the dev header is refused (admins must use Clerk)', async () => {
    const original = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      assert.equal((await me('admin@test.com')).status, 401)
      // ordinary users still work through the header while AUTH_ENABLED is false
      await seed('user@test.com', { mentee: {} })
      assert.equal((await me('user@test.com')).status, 200)
    } finally {
      process.env.NODE_ENV = original
    }
  })
})

describe('GET /api/profiles/me: shape by situation', () => {
  it('a signed-in user with no profile gets the application-form signal', async () => {
    const { status, data } = await me('newbie@test.com')
    assert.equal(status, 200)
    assert.equal(data.has_profile, false)
    assert.equal(data.role, null)
    assert.equal(data.is_mentor, false)
    assert.equal(data.is_mentee, false)
    assert.equal(data.is_admin, false)
    assert.equal(data.name, 'newbie')
    assert.equal(data.payload, undefined)
  })

  it('flags admins', async () => {
    assert.equal((await me('admin@test.com')).data.is_admin, true)
    await seed('someone@test.com', { mentee: {} })
    assert.equal((await me('someone@test.com')).data.is_admin, false)
  })

  it('an approved mentor', async () => {
    await seed('m@test.com', {
      name: 'Mia Mentor',
      shared: { preferred_name: 'Mia', city: 'Boston' },
      mentor: { payload: { motivation: 'Help.', max_capacity: 3 } },
    })
    const { data } = await me('m@test.com')
    assert.equal(data.has_profile, true)
    assert.equal(data.role, 'mentor')
    assert.equal(data.is_mentor, true)
    assert.equal(data.is_mentee, false)
    assert.equal(data.mentor_status, 'APPROVED')
    assert.equal(data.mentee_status, null)
    assert.equal(data.status, 'APPROVED')
    assert.equal(data.name, 'Mia Mentor')
    assert.equal(data.preferred_name, 'Mia')
    assert.deepEqual(data.payload, { preferred_name: 'Mia', city: 'Boston', motivation: 'Help.', max_capacity: 3 })
  })

  it('a mentor still waiting for approval is not yet a mentor', async () => {
    await seed('p@test.com', { mentor: { status: 'PENDING', payload: { motivation: 'Help.' } } })
    const { data } = await me('p@test.com')
    assert.equal(data.role, 'mentor')
    assert.equal(data.is_mentor, false)
    assert.equal(data.mentor_status, 'PENDING')
    assert.equal(data.status, 'PENDING')
  })

  it('an approved mentee', async () => {
    await seed('e@test.com', { mentee: { payload: { statement_of_intent: 'Learn.' } } })
    const { data } = await me('e@test.com')
    assert.equal(data.role, 'mentee')
    assert.equal(data.is_mentee, true)
    assert.equal(data.is_mentor, false)
    assert.equal(data.payload.statement_of_intent, 'Learn.')
  })

  it('a user with both applications', async () => {
    await seed('b@test.com', {
      shared: { city: 'Boston' },
      mentor: { payload: { motivation: 'Help.' } },
      mentee: { payload: { statement_of_intent: 'Learn.' } },
    })
    const { data } = await me('b@test.com')
    assert.equal(data.role, 'both')
    assert.equal(data.is_mentor, true)
    assert.equal(data.is_mentee, true)
    assert.equal(data.payload.city, 'Boston')
    assert.equal(data.payload.motivation, 'Help.')
    assert.equal(data.payload.statement_of_intent, 'Learn.')
  })

  it('status is APPROVED once either application is approved', async () => {
    await seed('half@test.com', {
      mentor: { status: 'PENDING' },
      mentee: { status: 'APPROVED' },
    })
    const { data } = await me('half@test.com')
    assert.equal(data.is_mentee, true)
    assert.equal(data.is_mentor, false)
    assert.equal(data.status, 'APPROVED')
  })
})

describe('GET /api/profiles/me: payload merge precedence', () => {
  // Documents current behavior: application payloads override the shared payload, and the
  // mentee application overrides the mentor application. commitment_name exists in both
  // applications, so a dual-role user sees the mentee's copy in the merged payload.
  it('application payloads override shared; mentee overrides mentor', async () => {
    await seed('merge@test.com', {
      shared: { fun_fact: 'shared', commitment_name: 'from shared' },
      mentor: { payload: { fun_fact: 'mentor', commitment_name: 'from mentor' } },
      mentee: { payload: { commitment_name: 'from mentee' } },
    })
    const { data } = await me('merge@test.com')
    assert.equal(data.payload.fun_fact, 'mentor')
    assert.equal(data.payload.commitment_name, 'from mentee')
  })
})

describe('GET /api/profiles/me: per-role payloads', () => {
  it('returns each application\'s own payload so the edit form can prefill the role being edited', async () => {
    await seed('both@test.com', {
      shared: { city: 'Boston' },
      mentor: { payload: { motivation: 'Help.', commitment_name: 'from mentor' } },
      mentee: { payload: { statement_of_intent: 'Learn.', commitment_name: 'from mentee' } },
    })
    const { data } = await me('both@test.com')
    assert.deepEqual(data.mentor_payload, { motivation: 'Help.', commitment_name: 'from mentor' })
    assert.deepEqual(data.mentee_payload, { statement_of_intent: 'Learn.', commitment_name: 'from mentee' })
    // the merged payload is unchanged
    assert.equal(data.payload.commitment_name, 'from mentee')
  })

  it('is null for a role the user has not applied for', async () => {
    await seed('solo@test.com', { mentee: { payload: { statement_of_intent: 'Learn.' } } })
    const { data } = await me('solo@test.com')
    assert.equal(data.mentor_payload, null)
    assert.deepEqual(data.mentee_payload, { statement_of_intent: 'Learn.' })
  })
})

describe('health check and unknown API routes', () => {
  it('GET /api/health is open and reports ok', async () => {
    const res = await fetch(`${baseUrl}/api/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })

  it('an unknown API route returns a JSON 404, not the app shell', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  })

  it('admin routes reject non-admins through the real app', async () => {
    const res = await fetch(`${baseUrl}/api/admin/applications`, { headers: { 'x-user-email': 'nobody@test.com' } })
    assert.equal(res.status, 403)
  })
})
