process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'
import adminRouter from './admin-api.js'

// ── Test server setup ──────────────────────────────────────────────

let server, baseUrl

before(async () => {
  await setupDb()

  const profiles = [
    {
      email: 'mentor1@test.com', name: 'Mentor One', role: 'mentor',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        city: 'San Francisco', country: 'US', locations_open_to: ['San Francisco', 'Remote'],
        preferred_name: 'M1', pronouns: 'they/them',
        links: { linkedin: 'https://linkedin.com/test' },
      },
      mentorPayload: {
        top_strengths: ['Topic A', 'Topic B'], general_topics: ['Topic C'],
        motivation: 'Helping people.', max_capacity: 2,
      },
    },
    {
      email: 'mentor2@test.com', name: 'Mentor Two', role: 'mentor',
      shared: {
        career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
        city: 'Washington', country: 'US',
      },
      mentorPayload: {
        top_strengths: ['Topic X'], general_topics: [],
        motivation: 'Policy work.', max_capacity: 1,
      },
    },
    {
      email: 'mentee1@test.com', name: 'Mentee One', role: 'mentee',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        w_horiz: 3, w_vert: 3, w_sector: 3,
        city: 'San Francisco', country: 'US', geo_match_preference: true,
      },
      menteePayload: {
        top_topics: ['Topic A', 'Topic C'], statement_of_intent: 'Transition to climate.',
      },
    },
    {
      email: 'mentee2@test.com', name: 'Mentee Two', role: 'mentee',
      shared: {
        career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
        w_horiz: 1, w_vert: 5, w_sector: 3,
        city: 'Washington', country: 'US', geo_match_preference: false,
      },
      menteePayload: {
        top_topics: ['Topic X'], statement_of_intent: 'Policy career.',
      },
    },
  ]

  for (const p of profiles) {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, payload=EXCLUDED.payload`,
      [p.email, p.name, p.role, JSON.stringify(p.shared)],
    )
    if (p.mentorPayload) {
      await pool.query(
        `INSERT INTO mentor_applications (email, status, payload)
         VALUES ($1, 'APPROVED', $2)
         ON CONFLICT (email) DO UPDATE SET payload=EXCLUDED.payload`,
        [p.email, JSON.stringify(p.mentorPayload)],
      )
    }
    if (p.menteePayload) {
      await pool.query(
        `INSERT INTO mentee_applications (email, status, payload)
         VALUES ($1, 'APPROVED', $2)
         ON CONFLICT (email) DO UPDATE SET payload=EXCLUDED.payload`,
        [p.email, JSON.stringify(p.menteePayload)],
      )
    }
  }

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

// ── Helpers ────────────────────────────────────────────────────────

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

const admin = { 'x-user-email': 'admin@test.com' }

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
    assert.match(data.error, /not found/i)
  })

  it('returns 404 for non-mentee role', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentor1@test.com' })
    assert.equal(status, 404)
    assert.match(data.error, /not found/i)
  })

  it('creates a run with candidate matches', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentee1@test.com' })
    assert.equal(status, 200)
    assert.ok(data.run)
    assert.ok(data.run.run_id)
    assert.equal(data.run.status, 'PENDING_REVIEW')
    assert.equal(data.total_scored, 2)
    assert.ok(data.candidate_count >= 1)
  })

  it('stores candidates and stored matches in DB', async () => {
    const result = await pool.query(
      `SELECT rank, status, mentor_email FROM matches
       WHERE mentee_email = 'mentee1@test.com' ORDER BY rank`,
    )
    assert.equal(result.rows.length, 2)
    assert.equal(result.rows[0].rank, 1)
    assert.equal(result.rows[0].status, 'CANDIDATE')
    assert.equal(result.rows[1].rank, 2)
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

  it('returns 400 when mentee already has an active run', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentee1@test.com' })
    assert.equal(status, 400)
    assert.ok(data.error.includes('already'))
  })
})

// ── GET /api/matches/run/current ──────────────────────────────────

describe('GET /api/matches/run/current', () => {
  it('returns 400 when email is missing', async () => {
    const { status } = await get('/api/matches/run/current')
    assert.equal(status, 400)
  })

  it('returns null for user with no run', async () => {
    const { data } = await get('/api/matches/run/current?email=nobody@test.com')
    assert.equal(data.run, null)
  })

  it('returns PENDING_REVIEW run before admin review', async () => {
    const { data } = await get('/api/matches/run/current?email=mentee1@test.com')
    assert.ok(data.run)
    assert.equal(data.run.status, 'PENDING_REVIEW')
  })
})

// ── After admin review (auto-activate with 1 approved) ────────────

describe('After admin batch review', () => {
  before(async () => {
    const runResult = await pool.query(
      `SELECT run_id FROM match_runs WHERE mentee_email = 'mentee1@test.com' AND status = 'PENDING_REVIEW'`,
    )
    const runId = runResult.rows[0].run_id

    const candidates = await pool.query(
      `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE' ORDER BY rank LIMIT 1`,
      [runId],
    )
    const topMatchId = candidates.rows[0].match_id

    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: [topMatchId] },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.run_status, 'ACTIVE')
  })

  it('GET /api/matches returns ACTIVE matches scoped by role', async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com&role=mentee')
    assert.ok(data.matches.length >= 1)
    for (const m of data.matches) {
      assert.equal(m.status, 'ACTIVE')
      assert.equal(m.your_role, 'mentee')
    }
  })

  it('includes partner info in response', async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com&role=mentee')
    const match = data.matches[0]
    assert.ok(match.partner_name)
    assert.ok(match.partner_email)
    assert.ok(match.match_id)
    assert.ok(match.created_at)
  })

  it('shows match from mentor perspective too', async () => {
    const { data } = await get('/api/matches?email=mentor1@test.com&role=mentor')
    assert.ok(data.matches.length >= 1)
    assert.equal(data.matches[0].your_role, 'mentor')
    assert.equal(data.matches[0].partner_email, 'mentee1@test.com')
  })

  it('run/current shows ACTIVE status', async () => {
    const { data } = await get('/api/matches/run/current?email=mentee1@test.com')
    assert.equal(data.run.status, 'ACTIVE')
    assert.ok(data.run.matches.length >= 1)
    assert.equal(data.run.matches[0].status, 'ACTIVE')
  })
})

// ── GET /api/matches/:match_id ─────────────────────────────────────

describe('GET /api/matches/:match_id', () => {
  let matchId

  before(async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com&role=mentee')
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

// ── GET /api/matches edge cases ────────────────────────────────────

describe('GET /api/matches edge cases', () => {
  it('returns 400 when email is missing', async () => {
    const { status, data } = await get('/api/matches')
    assert.equal(status, 400)
    assert.equal(data.error, 'email query param is required')
  })

  it('returns 400 when role is missing', async () => {
    const { status, data } = await get('/api/matches?email=mentee1@test.com')
    assert.equal(status, 400)
    assert.ok(data.error.includes('role'))
  })

  it('returns 400 for invalid role', async () => {
    const { status, data } = await get('/api/matches?email=mentee1@test.com&role=admin')
    assert.equal(status, 400)
    assert.ok(data.error.includes('role'))
  })

  it('returns empty array for user with no matches', async () => {
    const { status, data } = await get('/api/matches?email=nobody@test.com&role=mentor')
    assert.equal(status, 200)
    assert.deepEqual(data.matches, [])
  })
})

// ── Lazy expiration ───────────────────────────────────────────────

describe('Lazy expiration', () => {
  before(async () => {
    await pool.query(
      `UPDATE matches SET activated_at = now() - interval '31 days',
              end_date = now() - interval '1 day'
       WHERE mentee_email = 'mentee1@test.com' AND status = 'ACTIVE'`,
    )
  })

  it('run/current returns null after end_date passes', async () => {
    const { data } = await get('/api/matches/run/current?email=mentee1@test.com')
    assert.equal(data.run, null)
  })

  it('match status is now FINISHED in DB', async () => {
    const result = await pool.query(
      `SELECT status FROM matches WHERE mentee_email = 'mentee1@test.com' AND mentor_email = 'mentor1@test.com'`,
    )
    assert.equal(result.rows[0].status, 'FINISHED')
  })

  it('match_run status is now FINISHED in DB', async () => {
    const result = await pool.query(
      `SELECT status FROM match_runs WHERE mentee_email = 'mentee1@test.com' ORDER BY created_at DESC LIMIT 1`,
    )
    assert.equal(result.rows[0].status, 'FINISHED')
  })

  it('GET /api/matches/past returns the finished match', async () => {
    const { status, data } = await get('/api/matches/past?email=mentee1@test.com')
    assert.equal(status, 200)
    assert.ok(data.matches.length >= 1)
    assert.equal(data.matches[0].status, 'FINISHED')
    assert.equal(data.matches[0].your_role, 'mentee')
    assert.equal(data.matches[0].partner_email, 'mentor1@test.com')
  })

  it('mentor also sees finished match in past', async () => {
    const { data } = await get('/api/matches/past?email=mentor1@test.com')
    assert.ok(data.matches.length >= 1)
    assert.equal(data.matches[0].your_role, 'mentor')
    assert.equal(data.matches[0].partner_email, 'mentee1@test.com')
  })

  it('GET /api/matches no longer returns the expired match', async () => {
    const { data } = await get('/api/matches?email=mentee1@test.com&role=mentee')
    const active = data.matches.filter(m => m.partner_email === 'mentor1@test.com')
    assert.equal(active.length, 0)
  })
})

// ── Mentee selection flow ──────────────────────────────────────────

describe('POST /api/matches/:match_id/select', () => {
  let approvedIds

  before(async () => {
    const { data: runData } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    const runId = runData.run.run_id

    const candidates = await pool.query(
      `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE' ORDER BY rank`,
      [runId],
    )
    approvedIds = candidates.rows.map(r => r.match_id)

    await post(`/api/admin/runs/${runId}/review`, { approved: approvedIds }, admin)
  })

  it('returns 400 without email', async () => {
    const { status } = await post(`/api/matches/${approvedIds[0]}/select`, {})
    assert.equal(status, 400)
  })

  it('returns 403 for wrong user', async () => {
    const { status } = await post(`/api/matches/${approvedIds[0]}/select`, { email: 'nobody@test.com' })
    assert.equal(status, 403)
  })

  it('mentee selects one approved match', async () => {
    const { status, data } = await post(`/api/matches/${approvedIds[0]}/select`, { email: 'mentee2@test.com' })
    assert.equal(status, 200)
    assert.equal(data.status, 'ACTIVE')
  })

  it('other approved matches become REJECTED', async () => {
    if (approvedIds.length < 2) return
    const result = await pool.query(
      'SELECT status FROM matches WHERE match_id = $1',
      [approvedIds[1]],
    )
    assert.equal(result.rows[0].status, 'REJECTED')
  })

  it('returns 400 when selecting already-active match', async () => {
    const { status, data } = await post(`/api/matches/${approvedIds[0]}/select`, { email: 'mentee2@test.com' })
    assert.equal(status, 400)
    assert.ok(data.error.includes('ACTIVE'))
  })
})

// ── Dual-role user isolation ──────────────────────────────────────

describe('Dual-role user sees only role-appropriate matches', () => {
  before(async () => {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload)
       VALUES ('dual@test.com', 'Dual User', 'both', '{"career_areas":["Engineering"],"climate_areas":["Energy"],"sectors":["Private"],"location":"SF, CA","w_horiz":3,"w_vert":3,"w_sector":3}')
       ON CONFLICT (email) DO UPDATE SET role='both'`,
    )
    await pool.query(
      `INSERT INTO mentor_applications (email, status, payload)
       VALUES ('dual@test.com', 'APPROVED', '{"top_strengths":["Topic A"],"motivation":"Help.","max_capacity":5}')
       ON CONFLICT (email) DO UPDATE SET status='APPROVED', payload=EXCLUDED.payload`,
    )
    await pool.query(
      `INSERT INTO mentee_applications (email, status, payload)
       VALUES ('dual@test.com', 'APPROVED', '{"top_topics":["Topic A"],"statement_of_intent":"Learn."}')
       ON CONFLICT (email) DO UPDATE SET status='APPROVED', payload=EXCLUDED.payload`,
    )

    // Create a match where dual user is the mentee (mentor1 is their mentor)
    const runResult = await pool.query(
      `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit)
       VALUES ('dual@test.com', 'ACTIVE', 1, 1, 'test') RETURNING run_id`,
    )
    await pool.query(
      `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit, activated_at, end_date)
       VALUES ($1, 'mentor1@test.com', 'dual@test.com', 'ACTIVE', 0.85, 1, '{}', 'test', now(), now() + interval '30 days')`,
      [runResult.rows[0].run_id],
    )

    // Create a match where dual user is the mentor (mentee2 is their mentee)
    const runResult2 = await pool.query(
      `INSERT INTO match_runs (mentee_email, status, top_candidates, total_scored, code_commit)
       VALUES ('mentee2@test.com', 'ACTIVE', 1, 1, 'test') RETURNING run_id`,
    )
    await pool.query(
      `INSERT INTO matches (run_id, mentor_email, mentee_email, status, final_score, rank, computation_payload, code_commit, activated_at, end_date)
       VALUES ($1, 'dual@test.com', 'mentee2@test.com', 'ACTIVE', 0.70, 1, '{}', 'test', now(), now() + interval '30 days')`,
      [runResult2.rows[0].run_id],
    )
  })

  it('role=mentor returns only mentee partners', async () => {
    const { data } = await get('/api/matches?email=dual@test.com&role=mentor')
    assert.equal(data.matches.length, 1)
    assert.equal(data.matches[0].your_role, 'mentor')
    assert.equal(data.matches[0].partner_email, 'mentee2@test.com')
  })

  it('role=mentee returns only mentor partners', async () => {
    const { data } = await get('/api/matches?email=dual@test.com&role=mentee')
    assert.equal(data.matches.length, 1)
    assert.equal(data.matches[0].your_role, 'mentee')
    assert.equal(data.matches[0].partner_email, 'mentor1@test.com')
  })

  it('past endpoint computes your_role correctly for both', async () => {
    // Finish the matches so they appear in /past
    await pool.query(
      `UPDATE matches SET status = 'FINISHED', end_date = now() - interval '1 day'
       WHERE mentor_email = 'dual@test.com' OR mentee_email = 'dual@test.com'`,
    )
    await pool.query(
      `UPDATE match_runs SET status = 'FINISHED'
       WHERE mentee_email IN ('dual@test.com', 'mentee2@test.com')`,
    )

    const { data } = await get('/api/matches/past?email=dual@test.com')
    assert.equal(data.matches.length, 2)

    const asMentee = data.matches.find(m => m.your_role === 'mentee')
    const asMentor = data.matches.find(m => m.your_role === 'mentor')
    assert.ok(asMentee)
    assert.ok(asMentor)
    assert.equal(asMentee.partner_email, 'mentor1@test.com')
    assert.equal(asMentor.partner_email, 'mentee2@test.com')
  })
})

// ── No mentors available ───────────────────────────────────────────

describe('No mentors available', () => {
  before(async () => {
    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '0')`,
    )
    await pool.query(`UPDATE match_runs SET status = 'CANCELLED' WHERE mentee_email = 'mentee2@test.com'`)
  })

  after(async () => {
    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '2')
       WHERE email = 'mentor1@test.com'`,
    )
    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '1')
       WHERE email = 'mentor2@test.com'`,
    )
  })

  it('returns no-match when all mentors filtered', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    assert.equal(status, 200)
    assert.equal(data.run, null)
    assert.ok(data.message.includes('No mentors'))
  })
})

// ── Profile approval gating ───────────────────────────────────────

describe('Profile approval gating', () => {
  it('returns 400 for PENDING mentee', async () => {
    await pool.query(`UPDATE mentee_applications SET status = 'PENDING' WHERE email = 'mentee2@test.com'`)
    const { status, data } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    assert.equal(status, 400)
    assert.ok(data.error.includes('under review'))
    await pool.query(`UPDATE mentee_applications SET status = 'APPROVED' WHERE email = 'mentee2@test.com'`)
  })

  it('excludes PENDING mentors from matching pool', async () => {
    await pool.query(`UPDATE match_runs SET status = 'CANCELLED' WHERE mentee_email = 'mentee2@test.com'`)
    await pool.query(`UPDATE matches SET status = 'REJECTED' WHERE mentee_email = 'mentee2@test.com'`)
    await pool.query(`UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '2') WHERE email = 'mentor1@test.com'`)
    await pool.query(`UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '1') WHERE email = 'mentor2@test.com'`)

    await pool.query(`UPDATE mentor_applications SET status = 'PENDING' WHERE email = 'mentor1@test.com'`)

    const { status, data } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    assert.equal(status, 200)
    assert.ok(data.run)
    assert.equal(data.total_scored, 1)

    await pool.query(`UPDATE mentor_applications SET status = 'APPROVED' WHERE email = 'mentor1@test.com'`)
  })
})
