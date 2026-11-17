process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'
import adminRouter from './admin-api.js'

let server, baseUrl
const admin = { 'x-user-email': 'admin@test.com' }

const MENTORS = ['m1@test.com', 'm2@test.com', 'm3@test.com']
const MENTEES = ['e1@test.com', 'e2@test.com']

async function post(path, body, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

async function insertProfile(email, role, shared, appPayload) {
  await pool.query(
    `INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)`,
    [email, email.split('@')[0], role, JSON.stringify(shared)],
  )
  const table = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'
  await pool.query(
    `INSERT INTO ${table} (email, status, payload) VALUES ($1, 'APPROVED', $2)`,
    [email, JSON.stringify(appPayload)],
  )
}

async function latestRun(mentee) {
  const r = await pool.query(
    'SELECT run_id, status FROM match_runs WHERE mentee_email = $1 ORDER BY created_at DESC LIMIT 1',
    [mentee],
  )
  return r.rows[0]
}

async function newRun(mentee) {
  const { status } = await post('/api/matches/run', { email: mentee })
  assert.equal(status, 200)
  return latestRun(mentee)
}

const SHARED = {
  career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
  city: 'San Francisco', country: 'US',
}

before(async () => {
  await setupDb()
  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

// Every test starts from the same known state (mentors, two mentees, no runs) and builds
// anything else itself, so tests pass in any order and on their own.
beforeEach(async () => {
  await resetDb()
  for (const m of MENTORS) {
    await insertProfile(m, 'mentor', SHARED, { top_strengths: ['Topic A'], general_topics: [], motivation: 'Help.', max_capacity: 3 })
  }
  for (const e of MENTEES) {
    await insertProfile(e, 'mentee', { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 }, { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
  }
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

describe('POST /api/admin/runs/:run_id/reset', () => {
  it('requires an admin', async () => {
    const run = await newRun('e1@test.com')
    const { status } = await post(`/api/admin/runs/${run.run_id}/reset`, {}, { 'x-user-email': 'nobody@test.com' })
    assert.equal(status, 403)
  })

  it('returns 404 for an unknown run', async () => {
    const { status } = await post('/api/admin/runs/00000000-0000-0000-0000-000000000000/reset', {}, admin)
    assert.equal(status, 404)
  })

  it('rejects a malformed block list', async () => {
    const run = await newRun('e1@test.com')
    const { status } = await post(`/api/admin/runs/${run.run_id}/reset`, { block_mentor_emails: 'm1@test.com' }, admin)
    assert.equal(status, 400)
  })

  it('rejects blocking a mentor who is not in the run', async () => {
    const run = await newRun('e1@test.com')
    const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, { block_mentor_emails: ['stranger@test.com'] }, admin)
    assert.equal(status, 400)
    assert.match(data.error, /not a mentor in this run/)
    assert.notEqual((await latestRun('e1@test.com')).status, 'CANCELLED')
  })

  it('cancels the run and closes open matches without blocking or re-running', async () => {
    const run = await newRun('e1@test.com')
    const other = await newRun('e2@test.com')
    const runsBefore = (await pool.query('SELECT count(*)::int AS n FROM match_runs WHERE mentee_email = $1', ['e1@test.com'])).rows[0].n

    const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, { reason: 'Not a fit' }, admin)
    assert.equal(status, 200)
    assert.equal(data.status, 'CANCELLED')
    assert.equal(data.blocks_created, 0)
    assert.ok(data.matches_rejected > 0)

    assert.equal((await latestRun('e1@test.com')).status, 'CANCELLED')
    const open = await pool.query(
      `SELECT count(*)::int AS n FROM matches WHERE run_id = $1 AND status IN ('CANDIDATE','APPROVED','ACTIVE')`,
      [run.run_id],
    )
    assert.equal(open.rows[0].n, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM rejections')).rows[0].n, 0)
    // no auto re-run
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM match_runs WHERE mentee_email = $1', ['e1@test.com'])).rows[0].n, runsBefore)
    // reason recorded
    const actions = await pool.query(
      `SELECT payload FROM match_actions a JOIN matches m ON m.match_id = a.match_id WHERE m.run_id = $1 AND a.action_type = 'REJECT'`,
      [run.run_id],
    )
    assert.ok(actions.rows.every(r => r.payload.reset === true && r.payload.reason === 'Not a fit'))
    // other mentee untouched
    assert.equal((await latestRun('e2@test.com')).status, other.status)
  })

  it('refuses to reset an already cancelled run', async () => {
    const run = await newRun('e1@test.com')
    assert.equal((await post(`/api/admin/runs/${run.run_id}/reset`, {}, admin)).status, 200)
    const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, {}, admin)
    assert.equal(status, 400)
    assert.match(data.error, /CANCELLED/)
  })

  it('lets the mentee request new matches after a reset', async () => {
    const first = await newRun('e1@test.com')
    assert.equal((await post(`/api/admin/runs/${first.run_id}/reset`, {}, admin)).status, 200)
    const { status } = await post('/api/matches/run', { email: 'e1@test.com' })
    assert.equal(status, 200)
    assert.notEqual((await latestRun('e1@test.com')).status, 'CANCELLED')
  })

  it('blocks selected mentors only, and they are excluded from the next run', async () => {
    const run = await newRun('e1@test.com')
    const { status, data } = await post(
      `/api/admin/runs/${run.run_id}/reset`,
      { reason: 'Conflict', block_mentor_emails: ['M1@test.com'] },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.blocks_created, 1)

    const blocks = await pool.query('SELECT mentor_email, mentee_email, created_by FROM rejections')
    assert.deepEqual(blocks.rows, [{ mentor_email: 'm1@test.com', mentee_email: 'e1@test.com', created_by: 'admin@test.com' }])

    const next = await newRun('e1@test.com')
    const offered = await pool.query('SELECT mentor_email FROM matches WHERE run_id = $1', [next.run_id])
    const emails = offered.rows.map(r => r.mentor_email)
    assert.ok(!emails.includes('m1@test.com'), 'blocked mentor must not be offered')
    assert.ok(emails.includes('m2@test.com') || emails.includes('m3@test.com'))
  })

  it('treats an existing block as the same pair even if its email differs in case', async () => {
    const run = await newRun('e1@test.com')
    await pool.query(`INSERT INTO rejections (mentor_email, mentee_email, created_by) VALUES ('M2@Test.COM', 'E1@test.com', 'admin@test.com')`)
    const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, { block_mentor_emails: ['m2@test.com'] }, admin)
    assert.equal(status, 200)
    assert.equal(data.blocks_created, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM rejections')).rows[0].n, 1)
  })

  it('does not create a duplicate block when the pair is already blocked', async () => {
    const run = await newRun('e1@test.com')
    // Simulate a pre-existing block on a mentor that is in this run
    await pool.query(
      `INSERT INTO rejections (mentor_email, mentee_email, created_by) VALUES ('m2@test.com', 'e1@test.com', 'admin@test.com')`,
    )
    const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, { block_mentor_emails: ['m2@test.com'] }, admin)
    assert.equal(status, 200)
    assert.equal(data.blocks_created, 0)
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM rejections WHERE mentor_email = 'm2@test.com'`)).rows[0].n, 1)
  })
})

describe('POST /api/admin/matches/:match_id/reject closes the rest of the run', () => {
  it('rejecting the active match also rejects the other open matches in the run', async () => {
    const run = await newRun('e2@test.com').catch(() => latestRun('e2@test.com'))
    // force one match ACTIVE, leave others APPROVED
    await pool.query(`UPDATE matches SET status = 'APPROVED' WHERE run_id = $1 AND status = 'CANDIDATE'`, [run.run_id])
    const first = (await pool.query(`SELECT match_id FROM matches WHERE run_id = $1 AND status = 'APPROVED' ORDER BY rank LIMIT 1`, [run.run_id])).rows[0]
    await pool.query(`UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`, [first.match_id])
    await pool.query(`UPDATE match_runs SET status = 'ACTIVE' WHERE run_id = $1`, [run.run_id])

    const { status } = await post(`/api/admin/matches/${first.match_id}/reject`, { reason: 'x' }, admin)
    assert.equal(status, 200)
    const left = await pool.query(`SELECT count(*)::int AS n FROM matches WHERE run_id = $1 AND status IN ('CANDIDATE','APPROVED','ACTIVE')`, [run.run_id])
    assert.equal(left.rows[0].n, 0)
  })
})

// ── Run statuses, STORED matches, run_status, rollback ─────────────

async function forceState(runId, runStatus) {
  // Normalize the run into a specific lifecycle state
  await pool.query(`UPDATE match_runs SET status = $2 WHERE run_id = $1`, [runId, runStatus])
  const matchStatus = { PENDING_REVIEW: 'CANDIDATE', AWAITING_MENTEE: 'APPROVED', ACTIVE: 'APPROVED' }[runStatus]
  await pool.query(`UPDATE matches SET status = $2 WHERE run_id = $1 AND status <> 'STORED'`, [runId, matchStatus])
  if (runStatus === 'ACTIVE') {
    await pool.query(
      `UPDATE matches SET status = 'ACTIVE', activated_at = now()
       WHERE match_id = (SELECT match_id FROM matches WHERE run_id = $1 AND status = 'APPROVED' ORDER BY rank LIMIT 1)`,
      [runId],
    )
  }
}

describe('reset across run statuses', () => {
  const STATUSES = ['PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE']

  beforeEach(async () => {
    for (const [i] of STATUSES.entries()) {
      await insertProfile(`s${i}@test.com`, 'mentee',
        { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
        { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    }
  })

  for (const [i, runStatus] of STATUSES.entries()) {
    it(`resets a ${runStatus} run`, async () => {
      const mentee = `s${i}@test.com`
      const run = await newRun(mentee)
      await forceState(run.run_id, runStatus)

      const { status, data } = await post(`/api/admin/runs/${run.run_id}/reset`, { reason: 'test' }, admin)
      assert.equal(status, 200)
      assert.equal(data.status, 'CANCELLED')
      assert.ok(data.matches_rejected > 0)
      assert.equal((await latestRun(mentee)).status, 'CANCELLED')
      const open = await pool.query(
        `SELECT count(*)::int AS n FROM matches WHERE run_id = $1 AND status IN ('CANDIDATE','APPROVED','ACTIVE')`,
        [run.run_id],
      )
      assert.equal(open.rows[0].n, 0)
    })
  }

  it('leaves STORED (below-cutoff) matches untouched', async () => {
    await insertProfile('stored@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    const run = await newRun('stored@test.com')
    await forceState(run.run_id, 'PENDING_REVIEW')
    // Mark one match as STORED (below cutoff)
    const stored = (await pool.query(
      `UPDATE matches SET status = 'STORED'
       WHERE match_id = (SELECT match_id FROM matches WHERE run_id = $1 ORDER BY rank DESC LIMIT 1)
       RETURNING match_id`,
      [run.run_id],
    )).rows[0]

    const { status } = await post(`/api/admin/runs/${run.run_id}/reset`, {}, admin)
    assert.equal(status, 200)
    const after = await pool.query('SELECT status FROM matches WHERE match_id = $1', [stored.match_id])
    assert.equal(after.rows[0].status, 'STORED')
  })
})

describe('reject audit trail', () => {
  it('logs an action for each sibling match closed alongside the rejected one', async () => {
    await insertProfile('audit@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    const run = await newRun('audit@test.com')
    await forceState(run.run_id, 'AWAITING_MENTEE')
    const first = (await pool.query(`SELECT match_id FROM matches WHERE run_id = $1 AND status = 'APPROVED' ORDER BY rank LIMIT 1`, [run.run_id])).rows[0]
    await pool.query(`UPDATE matches SET status = 'ACTIVE' WHERE match_id = $1`, [first.match_id])
    await pool.query(`UPDATE match_runs SET status = 'ACTIVE' WHERE run_id = $1`, [run.run_id])
    const siblings = (await pool.query(`SELECT match_id FROM matches WHERE run_id = $1 AND status = 'APPROVED'`, [run.run_id])).rows
    assert.ok(siblings.length > 0, 'need sibling matches for this test')

    const { status } = await post(`/api/admin/matches/${first.match_id}/reject`, { reason: 'no fit' }, admin)
    assert.equal(status, 200)
    for (const sib of siblings) {
      const acts = await pool.query(`SELECT actor_email, payload FROM match_actions WHERE match_id = $1 AND action_type = 'REJECT'`, [sib.match_id])
      assert.equal(acts.rows.length, 1)
      assert.equal(acts.rows[0].actor_email, 'admin@test.com')
      assert.equal(acts.rows[0].payload.closed_with, first.match_id)
      assert.equal(acts.rows[0].payload.reason, 'no fit')
    }
  })
})

describe('GET /api/admin/matches run_status', () => {
  it('includes the run status on each match', async () => {
    const old = await newRun('e1@test.com')
    assert.equal((await post(`/api/admin/runs/${old.run_id}/reset`, {}, admin)).status, 200)
    const current = await newRun('e1@test.com')

    const res = await fetch(`${baseUrl}/api/admin/matches?email=e1@test.com`, { headers: admin })
    const { matches } = await res.json()
    assert.ok(matches.length > 0)
    const valid = ['PENDING_REVIEW', 'AWAITING_MENTEE', 'ACTIVE', 'CANCELLED', 'FINISHED']
    assert.ok(matches.every(m => valid.includes(m.run_status)))
    assert.ok(matches.filter(m => m.run_id === old.run_id).every(m => m.run_status === 'CANCELLED'))

    const forCurrent = matches.filter(m => m.run_id === current.run_id)
    assert.ok(forCurrent.length > 0)
    assert.ok(forCurrent.every(m => m.run_status === current.status))
  })
})

describe('reset is atomic', () => {
  it('rolls everything back if a block insert fails', async () => {
    await insertProfile('atomic@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    const run = await newRun('atomic@test.com')
    await forceState(run.run_id, 'PENDING_REVIEW')

    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_block() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'forced failure'; END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER test_fail_block BEFORE INSERT ON rejections FOR EACH ROW EXECUTE FUNCTION test_fail_block()`)
    try {
      const blockMentor = (await pool.query('SELECT mentor_email FROM matches WHERE run_id = $1 LIMIT 1', [run.run_id])).rows[0].mentor_email
      const { status } = await post(`/api/admin/runs/${run.run_id}/reset`, { block_mentor_emails: [blockMentor] }, admin)
      assert.equal(status, 500)
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS test_fail_block ON rejections')
      await pool.query('DROP FUNCTION IF EXISTS test_fail_block()')
    }

    // Run and matches must be unchanged
    assert.equal((await latestRun('atomic@test.com')).status, 'PENDING_REVIEW')
    const open = await pool.query(`SELECT count(*)::int AS n FROM matches WHERE run_id = $1 AND status = 'CANDIDATE'`, [run.run_id])
    assert.ok(open.rows[0].n > 0)
    const logged = await pool.query(
      `SELECT count(*)::int AS n FROM match_actions a JOIN matches m ON m.match_id = a.match_id
       WHERE m.run_id = $1 AND a.action_type = 'REJECT'`, [run.run_id])
    assert.equal(logged.rows[0].n, 0)
  })
})


describe('block list duplicates', () => {
  async function getJson(path) {
    const res = await fetch(`${baseUrl}${path}`, { headers: admin })
    return res.json()
  }
  async function del(path) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers: admin })
    return { status: res.status, data: await res.json() }
  }
  const count = async () => (await pool.query(
    `SELECT count(*)::int AS n FROM rejections WHERE mentor_email = 'dupm@test.com' AND mentee_email = 'dupe@test.com'`,
  )).rows[0].n

  it('rejects a second block for the same pair (case-insensitive)', async () => {
    const first = await post('/api/admin/blocks', { mentor_email: 'dupm@test.com', mentee_email: 'dupe@test.com' }, admin)
    assert.equal(first.status, 201)
    const second = await post('/api/admin/blocks', { mentor_email: 'DupM@test.com', mentee_email: 'dupe@TEST.com' }, admin)
    assert.equal(second.status, 409)
    assert.equal(second.data.block_id, first.data.block_id)
    assert.equal(await count(), 1)
  })

  it('deleting a block removes legacy duplicates too', async () => {
    const created = await post('/api/admin/blocks', { mentor_email: 'dupm@test.com', mentee_email: 'dupe@test.com' }, admin)
    assert.equal(created.status, 201)
    const id = created.data.block_id
    // simulate a pre-existing duplicate
    await pool.query(`INSERT INTO rejections (mentor_email, mentee_email, created_by) VALUES ('dupm@test.com', 'dupe@test.com', 'admin@test.com')`)
    assert.equal(await count(), 2)
    const { status } = await del(`/api/admin/blocks/${id}`)
    assert.equal(status, 200)
    assert.equal(await count(), 0)
    const { blocks } = await getJson('/api/admin/blocks')
    assert.ok(!blocks.some(b => b.mentor_email === 'dupm@test.com' && b.mentee_email === 'dupe@test.com'))
  })

  it('reject with block reuses an existing block instead of duplicating it', async () => {
    await insertProfile('rj@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    const run = await newRun('rj@test.com')
    await forceState(run.run_id, 'ACTIVE')
    const m = (await pool.query(`SELECT match_id, mentor_email FROM matches WHERE run_id = $1 AND status = 'ACTIVE'`, [run.run_id])).rows[0]
    await pool.query(`INSERT INTO rejections (mentor_email, mentee_email, created_by) VALUES ($1, 'rj@test.com', 'admin@test.com')`, [m.mentor_email])

    const { status, data } = await post(`/api/admin/matches/${m.match_id}/reject`, { block: true, reason: 'x' }, admin)
    assert.equal(status, 200)
    assert.equal(data.block_created, false)
    assert.equal(data.already_blocked, true)
    const n = (await pool.query(`SELECT count(*)::int AS n FROM rejections WHERE mentor_email = $1 AND mentee_email = 'rj@test.com'`, [m.mentor_email])).rows[0].n
    assert.equal(n, 1)
  })
})

describe('lazy match expiry is atomic', () => {
  async function installFailingRunTrigger() {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_fail_run_finish() RETURNS trigger AS $$
      BEGIN
        IF NEW.status = 'FINISHED' THEN RAISE EXCEPTION 'forced failure'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER test_fail_run_finish BEFORE UPDATE ON match_runs FOR EACH ROW EXECUTE FUNCTION test_fail_run_finish()`)
  }
  async function removeTrigger() {
    await pool.query('DROP TRIGGER IF EXISTS test_fail_run_finish ON match_runs')
    await pool.query('DROP FUNCTION IF EXISTS test_fail_run_finish()')
  }

  for (const [label, url] of [
    ['run/current', email => `/api/matches/run/current?email=${email}`],
    ['matches list', email => `/api/matches?email=${email}&role=mentee`],
  ]) {
    it(`${label}: if finishing the run fails, matches are not left FINISHED`, async () => {
      const mentee = label === 'run/current' ? 'xp1@test.com' : 'xp2@test.com'
      await insertProfile(mentee, 'mentee',
        { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
        { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
      const run = await newRun(mentee)
      await forceState(run.run_id, 'ACTIVE')
      await pool.query(`UPDATE matches SET end_date = now() - interval '1 day' WHERE run_id = $1 AND status = 'ACTIVE'`, [run.run_id])

      await installFailingRunTrigger()
      try {
        const res = await fetch(`${baseUrl}${url(mentee)}`)
        assert.equal(res.status, 500)
      } finally {
        await removeTrigger()
      }
      // Nothing half-applied: match still ACTIVE, run still ACTIVE
      const m = await pool.query(`SELECT status FROM matches WHERE run_id = $1 AND status IN ('ACTIVE','FINISHED')`, [run.run_id])
      assert.deepEqual(m.rows.map(r => r.status), ['ACTIVE'])
      assert.equal((await latestRun(mentee)).status, 'ACTIVE')

      // With the failure gone, expiry completes consistently
      const ok = await fetch(`${baseUrl}${url(mentee)}`)
      assert.equal(ok.status, 200)
      assert.equal((await latestRun(mentee)).status, 'FINISHED')
    })
  }
})

describe('concurrent run requests', () => {
  // Make the run insert slow so every concurrent request passes the early
  // "existing run?" check before the first one commits. Without a lock, each would then
  // create its own run.
  async function slowRunInserts() {
    await pool.query(`
      CREATE OR REPLACE FUNCTION test_slow_run_insert() RETURNS trigger AS $$
      BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$ LANGUAGE plpgsql`)
    await pool.query(`CREATE TRIGGER test_slow_run_insert BEFORE INSERT ON match_runs FOR EACH ROW EXECUTE FUNCTION test_slow_run_insert()`)
  }
  async function normalRunInserts() {
    await pool.query('DROP TRIGGER IF EXISTS test_slow_run_insert ON match_runs')
    await pool.query('DROP FUNCTION IF EXISTS test_slow_run_insert()')
  }

  it('creates exactly one run when the same mentee requests matches at once', async () => {
    await insertProfile('race@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })

    await slowRunInserts()
    let results
    try {
      results = await Promise.all(
        Array.from({ length: 4 }, () => post('/api/matches/run', { email: 'race@test.com' })),
      )
    } finally {
      await normalRunInserts()
    }

    // Exactly one request creates a run. The rest are rejected as "already in progress"
    // or find no free mentors; neither creates anything.
    const created = results.filter(r => r.status === 200 && r.data.run)
    assert.equal(created.length, 1, `expected one created run, got ${JSON.stringify(results.map(r => [r.status, r.data.run?.status ?? null]))}`)
    for (const r of results.filter(x => x !== created[0])) {
      assert.ok(
        (r.status === 400 && /already have matches in progress/.test(r.data.error))
          || (r.status === 200 && r.data.run === null),
        `unexpected response ${r.status} ${JSON.stringify(r.data)}`,
      )
    }

    const runs = await pool.query(`SELECT count(*)::int AS n FROM match_runs WHERE mentee_email = 'race@test.com'`)
    assert.equal(runs.rows[0].n, 1)
    // only one set of candidate matches exists, so no mentor is stranded by an orphan run
    const runId = (await latestRun('race@test.com')).run_id
    const stray = await pool.query(`SELECT count(*)::int AS n FROM matches WHERE mentee_email = 'race@test.com' AND run_id <> $1`, [runId])
    assert.equal(stray.rows[0].n, 0)
  })

  it('still allows a new run after the previous one is reset', async () => {
    await insertProfile('race@test.com', 'mentee',
      { ...SHARED, w_horiz: 1, w_vert: 1, w_sector: 1 },
      { top_topics: ['Topic A'], statement_of_intent: 'Transition.' })
    const run = await newRun('race@test.com')
    const reset = await post(`/api/admin/runs/${run.run_id}/reset`, {}, admin)
    assert.equal(reset.status, 200)
    const again = await post('/api/matches/run', { email: 'race@test.com' })
    assert.equal(again.status, 200)
  })
})
