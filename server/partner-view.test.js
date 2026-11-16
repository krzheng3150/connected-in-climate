// Organizer-facing fields must never reach the other person in a match.
process.env.GOOGLE_OAUTH_CLIENT_ID = ''
process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = ''

import { describe, it, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'
import { partnerView, PRIVATE_PARTNER_FIELDS } from './partner-view.js'

let server, baseUrl, matchId

const PRIVATE = {
  commitment_name: 'Signed Name',
  additional_info: 'Note for organizers',
  eq_response: 'Screening answer',
}
const SHARED = {
  career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
  city: 'SF', country: 'US', organization: 'Acme', name_pronunciation: 'AK-mee',
  years_climate_experience: '5_10', fun_fact: 'Climbs',
  additional_info: PRIVATE.additional_info,
}
const MENTOR_APP = {
  top_strengths: ['a'], general_topics: [], motivation: 'Help.', max_capacity: 2,
  freelance_experience: '0_3', commitment_name: PRIVATE.commitment_name, eq_response: PRIVATE.eq_response,
  scheduling_link: 'https://cal.example.org/m',
}
const MENTEE_APP = {
  top_topics: ['a'], statement_of_intent: 'Learn.', relevant_projects: 'Solar co-op',
  employment_situation: 'growing', commitment_name: PRIVATE.commitment_name,
}

async function insertProfile(email, role, shared, app) {
  await pool.query(`INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)`,
    [email, email.split('@')[0], role, JSON.stringify(shared)])
  const table = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'
  await pool.query(`INSERT INTO ${table} (email, status, payload) VALUES ($1, 'APPROVED', $2)`,
    [email, JSON.stringify(app)])
}

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`)
  return { status: res.status, data: await res.json() }
}

function assertNoPrivate(obj, where) {
  for (const key of PRIVATE_PARTNER_FIELDS) {
    assert.ok(!(key in obj), `${where} must not contain ${key}`)
  }
}

before(async () => {
  await setupDb()
  await insertProfile('mentor@example.org', 'mentor', { ...SHARED, w_horiz: 3 }, MENTOR_APP)
  await insertProfile('mentee@example.org', 'mentee', { ...SHARED, w_horiz: 3, w_vert: 2, w_sector: 1 }, MENTEE_APP)

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`

  // example.org auto-approves; a single eligible mentor activates immediately
  const res = await fetch(`${baseUrl}/api/matches/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'mentee@example.org' }),
  })
  assert.equal((await res.json()).run.status, 'ACTIVE')
  matchId = (await pool.query(`SELECT match_id FROM matches WHERE status = 'ACTIVE'`)).rows[0].match_id
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

describe('partnerView', () => {
  it('removes private fields and keeps the rest', () => {
    const out = partnerView({ ...PRIVATE, max_capacity: 2, w_horiz: 1, organization: 'Acme', career_areas: ['x'] })
    assertNoPrivate(out, 'result')
    assert.equal(out.organization, 'Acme')
    assert.deepEqual(out.career_areas, ['x'])
  })
  it('handles null and does not mutate its input', () => {
    assert.deepEqual(partnerView(null), {})
    const input = { commitment_name: 'x', a: 1 }
    partnerView(input)
    assert.equal(input.commitment_name, 'x')
  })
})

describe('GET /api/matches/:match_id', () => {
  it('shows a mentee everything useful about the mentor, but nothing organizer-facing', async () => {
    const { status, data } = await get(`/api/matches/${matchId}?email=mentee@example.org`)
    assert.equal(status, 200)
    assertNoPrivate(data.partner, 'partner')
    assert.equal(data.partner.email, 'mentor@example.org')
    // fields the old hand-picked list silently dropped
    assert.equal(data.partner.organization, 'Acme')
    assert.equal(data.partner.name_pronunciation, 'AK-mee')
    assert.equal(data.partner.freelance_experience, '0_3')
    assert.equal(data.partner.years_climate_experience, '5_10')
    assert.equal(data.partner.scheduling_link, 'https://cal.example.org/m')
  })

  it('shows a mentor the mentee profile without organizer-facing fields', async () => {
    const { data } = await get(`/api/matches/${matchId}?email=mentor@example.org`)
    assertNoPrivate(data.partner, 'partner')
    assert.equal(data.partner.email, 'mentee@example.org')
    assert.equal(data.partner.relevant_projects, 'Solar co-op')
    assert.equal(data.partner.employment_situation, 'growing')
    assert.equal(data.partner.statement_of_intent, 'Learn.')
  })
})

describe('GET /api/matches (active list)', () => {
  for (const [role, email] of [['mentee', 'mentee@example.org'], ['mentor', 'mentor@example.org']]) {
    it(`hides organizer-facing fields from the ${role}'s view of their partner`, async () => {
      const { data } = await get(`/api/matches?email=${email}&role=${role}`)
      assert.equal(data.matches.length, 1)
      assertNoPrivate(data.matches[0].partner_payload, 'partner_payload')
      assert.equal(data.matches[0].partner_payload.organization, 'Acme')
    })
  }
})

describe('GET /api/matches/run/current', () => {
  it('hides organizer-facing mentor fields from the mentee', async () => {
    const { data } = await get('/api/matches/run/current?email=mentee@example.org')
    assert.ok(data.run.matches.length > 0)
    for (const m of data.run.matches) assertNoPrivate(m.mentor_payload, 'mentor_payload')
  })
})

describe('GET /api/matches/past', () => {
  // Finish the match for these tests only, and put it back, so other tests (which expect
  // an ACTIVE match) pass in any order.
  beforeEach(async () => {
    await pool.query(`UPDATE matches SET status = 'FINISHED' WHERE match_id = $1`, [matchId])
  })
  afterEach(async () => {
    await pool.query(`UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`, [matchId])
  })
  for (const [role, email] of [['mentee', 'mentee@example.org'], ['mentor', 'mentor@example.org']]) {
    it(`hides organizer-facing fields from the ${role}'s view of their partner`, async () => {
      const { data } = await get(`/api/matches/past?email=${email}`)
      assert.equal(data.matches.length, 1)
      assertNoPrivate(data.matches[0].partner_payload, 'partner_payload')
    })
  }
})
