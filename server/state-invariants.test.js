// Two kinds of safety net:
//
//  1. State invariants, checked after EVERY step of a long scenario that exercises runs,
//     admin review, selection, rejection, blocks, resets and expiry. They describe states
//     that must never exist, whichever sequence of actions got there.
//
//  2. Flow parity: every code path that activates a match must also create its Drive
//     resources. A source-level tripwire fails when a new activation path is added
//     without one.
//
// Google OAuth is blanked so no real Drive call is made; resources.js then logs that it
// was skipped, which shows it was invoked.
process.env.ADMIN_EMAILS = 'admin@test.com'
process.env.GOOGLE_OAUTH_CLIENT_ID = ''
process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = ''

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'
import adminRouter from './admin-api.js'

let server, baseUrl
const admin = { 'x-user-email': 'admin@test.com' }
const logs = []
const origLog = console.log

const MENTORS = ['m1@test.com', 'm2@test.com', 'm3@test.com', 'm4@test.com']
const MENTEES = ['e1@test.com', 'e2@test.com', 'e3@test.com']
const SHARED = { career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'], city: 'SF', country: 'US' }

async function insertProfile(email, role, app) {
  await pool.query(`INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)`,
    [email, email.split('@')[0], role, JSON.stringify(SHARED)])
  const table = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'
  await pool.query(`INSERT INTO ${table} (email, status, payload) VALUES ($1, 'APPROVED', $2)`, [email, JSON.stringify(app)])
}

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json() }
}
const post = (p, b, h) => call('POST', p, b, h)

before(async () => {
  await setupDb()
  for (const m of MENTORS) await insertProfile(m, 'mentor', { top_strengths: ['a'], general_topics: [], motivation: 'Help.', max_capacity: 3 })
  for (const e of MENTEES) await insertProfile(e, 'mentee', { top_topics: ['a'], statement_of_intent: 'Learn.' })

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
  console.log = (...args) => { logs.push(args.join(' ')); origLog(...args) }
})

after(async () => {
  console.log = origLog
  await resetDb()
  server?.close()
  await pool.end()
})

// ── Invariants ─────────────────────────────────────────────────────

const OPEN_RUN = `('PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE')`

const INVARIANTS = {
  'no open match inside a cancelled or finished run': `
    SELECT m.match_id FROM matches m JOIN match_runs r ON r.run_id = m.run_id
    WHERE r.status IN ('CANCELLED', 'FINISHED') AND m.status IN ('CANDIDATE', 'APPROVED', 'ACTIVE')`,
  'at most one open run per mentee': `
    SELECT mentee_email FROM match_runs WHERE status IN ${OPEN_RUN}
    GROUP BY mentee_email HAVING count(*) > 1`,
  'at most one block per mentor/mentee pair': `
    SELECT lower(mentor_email), lower(mentee_email) FROM rejections
    GROUP BY 1, 2 HAVING count(*) > 1`,
  'an ACTIVE run has exactly one ACTIVE match': `
    SELECT r.run_id FROM match_runs r
    LEFT JOIN matches m ON m.run_id = r.run_id AND m.status = 'ACTIVE'
    WHERE r.status = 'ACTIVE' GROUP BY r.run_id HAVING count(m.match_id) <> 1`,
  'an ACTIVE match belongs to an ACTIVE run': `
    SELECT m.match_id FROM matches m JOIN match_runs r ON r.run_id = m.run_id
    WHERE m.status = 'ACTIVE' AND r.status <> 'ACTIVE'`,
  'CANDIDATE matches only exist in runs pending review': `
    SELECT m.match_id FROM matches m JOIN match_runs r ON r.run_id = m.run_id
    WHERE m.status = 'CANDIDATE' AND r.status <> 'PENDING_REVIEW'`,
  'APPROVED matches only exist in runs awaiting the mentee': `
    SELECT m.match_id FROM matches m JOIN match_runs r ON r.run_id = m.run_id
    WHERE m.status = 'APPROVED' AND r.status <> 'AWAITING_MENTEE'`,
  'no mentor is over capacity': `
    SELECT mentor_email FROM matches WHERE status = 'ACTIVE'
    GROUP BY mentor_email HAVING count(*) > 3`,
}

async function assertInvariants(step) {
  for (const [name, sql] of Object.entries(INVARIANTS)) {
    const { rows } = await pool.query(sql)
    assert.equal(rows.length, 0, `after "${step}": violated "${name}": ${JSON.stringify(rows)}`)
  }
}

const runOf = async (mentee, statuses = OPEN_RUN) =>
  (await pool.query(`SELECT run_id, status FROM match_runs WHERE mentee_email = $1 AND status IN ${statuses} ORDER BY created_at DESC LIMIT 1`, [mentee])).rows[0]
const matchesOf = async (runId, status) =>
  (await pool.query(`SELECT match_id, mentor_email FROM matches WHERE run_id = $1 AND status = $2 ORDER BY rank`, [runId, status])).rows
const resourceLogs = () => logs.filter(l => l.includes('[resources]')).length
async function resourcesCalledAfter(action) {
  const before = resourceLogs()
  await action()
  for (let i = 0; i < 30 && resourceLogs() === before; i++) await new Promise(r => setTimeout(r, 50))
  return resourceLogs() - before
}

describe('state invariants hold through a realistic sequence of actions', () => {
  it('holds after every step', async () => {
    await assertInvariants('initial state')

    for (const e of MENTEES) {
      const { status } = await post('/api/matches/run', { email: e })
      assert.equal(status, 200)
    }
    await assertInvariants('all three mentees requested matches')

    // e1: admin approves exactly one -> ACTIVE, and a Drive folder is created
    const r1 = await runOf('e1@test.com')
    const c1 = await matchesOf(r1.run_id, 'CANDIDATE')
    const calls1 = await resourcesCalledAfter(async () => {
      const res = await post(`/api/admin/runs/${r1.run_id}/review`, { approved: [c1[0].match_id] }, admin)
      assert.equal(res.status, 200)
    })
    assert.equal(calls1, 1, 'admin review activating one match must create resources')
    await assertInvariants('admin approved one match for e1')

    // e2: admin approves two, mentee selects one -> ACTIVE, Drive folder created
    const r2 = await runOf('e2@test.com')
    const c2 = await matchesOf(r2.run_id, 'CANDIDATE')
    await post(`/api/admin/runs/${r2.run_id}/review`, { approved: [c2[0].match_id, c2[1].match_id] }, admin)
    await assertInvariants('admin approved two matches for e2')
    const calls2 = await resourcesCalledAfter(async () => {
      const res = await post(`/api/matches/${c2[1].match_id}/select`, { email: 'e2@test.com' })
      assert.equal(res.status, 200)
    })
    assert.equal(calls2, 1, 'mentee selecting a mentor must create resources')
    await assertInvariants('e2 selected a mentor')

    // e1's active match is rejected and the pair blocked; a second reject is refused
    const active1 = (await matchesOf(r1.run_id, 'ACTIVE'))[0]
    assert.equal((await post(`/api/admin/matches/${active1.match_id}/reject`, { block: true, reason: 'x' }, admin)).status, 200)
    await assertInvariants('e1 active match rejected with block')
    assert.equal((await post(`/api/admin/matches/${active1.match_id}/reject`, { block: true }, admin)).status, 400)
    await assertInvariants('second reject refused')

    // blocking the same pair again is refused, not duplicated
    assert.equal((await post('/api/admin/blocks', { mentor_email: active1.mentor_email.toUpperCase(), mentee_email: 'e1@test.com' }, admin)).status, 409)
    await assertInvariants('duplicate block refused')

    // e3: reset the pending run, blocking one mentor
    const r3 = await runOf('e3@test.com')
    const c3 = await matchesOf(r3.run_id, 'CANDIDATE')
    assert.equal((await post(`/api/admin/runs/${r3.run_id}/reset`, { block_mentor_emails: [c3[0].mentor_email] }, admin)).status, 200)
    await assertInvariants('e3 run reset with a block')

    // e3 asks again; a repeat request while one is open must not create a second run
    assert.equal((await post('/api/matches/run', { email: 'e3@test.com' })).status, 200)
    assert.equal((await post('/api/matches/run', { email: 'e3@test.com' })).status, 400)
    await assertInvariants('e3 requested matches again, then repeated the request')
    const newRun = await runOf('e3@test.com')
    const offered = (await pool.query(`SELECT mentor_email FROM matches WHERE run_id = $1`, [newRun.run_id])).rows.map(r => r.mentor_email)
    assert.ok(!offered.includes(c3[0].mentor_email), 'the mentor blocked in the reset must not be offered again')

    // e2's mentorship passes its end date; both lazy-expiry paths run
    await pool.query(`UPDATE matches SET end_date = now() - interval '1 day' WHERE mentee_email = 'e2@test.com' AND status = 'ACTIVE'`)
    assert.equal((await call('GET', '/api/matches/run/current?email=e2@test.com')).status, 200)
    await assertInvariants('e2 mentorship expired via run/current')
    assert.equal((await call('GET', '/api/matches?email=e2@test.com&role=mentee')).status, 200)
    await assertInvariants('e2 mentorship expired via the matches list')

    // e1 asks again after being rejected, then an admin resets that run too
    assert.equal((await post('/api/matches/run', { email: 'e1@test.com' })).status, 200)
    await assertInvariants('e1 requested matches again')
    const r1b = await runOf('e1@test.com')
    assert.equal((await post(`/api/admin/runs/${r1b.run_id}/reset`, {}, admin)).status, 200)
    await assertInvariants('e1 second run reset')

    // unblocking removes the block entirely
    const block = (await pool.query(`SELECT id FROM rejections LIMIT 1`)).rows[0]
    assert.equal((await call('DELETE', `/api/admin/blocks/${block.id}`, null, admin)).status, 200)
    await assertInvariants('a block was deleted')
  })
})

describe('every path that activates a match creates its Drive resources', () => {
  // Tripwire: if you add a new place that sets a match ACTIVE, you must also call
  // createMatchResources there (and bump both counts), or this fails.
  it('each activation site has a matching createMatchResources call', () => {
    const read = f => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    const sources = ['match-api.js', 'admin-api.js'].map(read).join('\n')
    const activations = (sources.match(/UPDATE matches SET status = 'ACTIVE'/g) || []).length
    const resourceCalls = (sources.match(/createMatchResources\(/g) || []).length
    assert.equal(
      resourceCalls, activations,
      `found ${activations} place(s) that activate a match but ${resourceCalls} createMatchResources call(s). ` +
      'Every activation path must create the shared Drive folder.',
    )
    assert.ok(activations >= 3, 'expected the select, admin-review and auto-approve activation paths')
  })
})
