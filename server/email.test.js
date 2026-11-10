process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool } from './db.js'
import matchRouter from './match-api.js'
import adminRouter from './admin-api.js'
import { _testGetSent, _testClear, notifyAdminsNewApplication, notifyApplicantApproved } from './email.js'

let server, baseUrl

before(async () => {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE IF NOT EXISTS user_profiles (
      email TEXT PRIMARY KEY, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('mentor','mentee','both')),
      payload JSONB NOT NULL DEFAULT '{}', embedding vector(1536),
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'APPROVED';
    CREATE TABLE IF NOT EXISTS mentor_applications (
      email TEXT PRIMARY KEY REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED')),
      payload JSONB NOT NULL DEFAULT '{}', embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mentee_applications (
      email TEXT PRIMARY KEY REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED')),
      payload JSONB NOT NULL DEFAULT '{}', embedding vector(1536),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS match_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentee_email TEXT NOT NULL REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
        CHECK (status IN ('PENDING_REVIEW','AWAITING_MENTEE','ACTIVE','CANCELLED','FINISHED')),
      top_candidates INTEGER NOT NULL, total_scored INTEGER NOT NULL,
      code_commit TEXT NOT NULL, reviewed_by TEXT, reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS matches (
      match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES match_runs(run_id),
      mentor_email TEXT NOT NULL REFERENCES user_profiles(email),
      mentee_email TEXT NOT NULL REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'CANDIDATE'
        CHECK (status IN ('CANDIDATE','APPROVED','REJECTED','ACTIVE','STORED','FINISHED')),
      final_score NUMERIC(5,4) NOT NULL, rank INTEGER NOT NULL,
      computation_payload JSONB NOT NULL, code_commit TEXT NOT NULL,
      resources_folder_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS match_actions (
      action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id UUID NOT NULL REFERENCES matches(match_id),
      actor_email TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('VIEW','FEEDBACK','CONTACT_CLICK','REJECT','APPROVE','SELECT')),
      payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS rejections (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentor_email TEXT NOT NULL, mentee_email TEXT NOT NULL,
      match_id UUID REFERENCES matches(match_id), reason TEXT,
      created_by TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM match_runs')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM mentee_applications')
  await pool.query('DELETE FROM mentor_applications')
  await pool.query('DELETE FROM user_profiles')

  const profiles = [
    {
      email: 'mentor1@test.com', name: 'Mentor One', role: 'mentor',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        location: 'SF, CA', locations_open_to: ['SF, CA', 'Remote'],
      },
      mentorPayload: {
        top_strengths: ['Topic A', 'Topic B'], general_topics: ['Topic C'],
        motivation: 'Helping.', max_capacity: 2,
      },
    },
    {
      email: 'mentor2@test.com', name: 'Mentor Two', role: 'mentor',
      shared: {
        career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
        location: 'DC',
      },
      mentorPayload: {
        top_strengths: ['Topic X'], general_topics: [],
        motivation: 'Policy.', max_capacity: 1,
      },
    },
    {
      email: 'mentee1@test.com', name: 'Mentee One', role: 'mentee',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        w_horiz: 3, w_vert: 3, w_sector: 3,
        location: 'SF, CA', geo_match_preference: true,
      },
      menteePayload: {
        top_topics: ['Topic A', 'Topic C'], statement_of_intent: 'Transition.',
      },
    },
    {
      email: 'mentee2@test.com', name: 'Mentee Two', role: 'mentee',
      shared: {
        career_areas: ['Strategy'], climate_areas: ['Policy'], sectors: ['Government'],
        w_horiz: 1, w_vert: 5, w_sector: 3,
        location: 'DC', geo_match_preference: false,
      },
      menteePayload: {
        top_topics: ['Topic X'], statement_of_intent: 'Policy.',
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
        `INSERT INTO mentor_applications (email, status, payload) VALUES ($1, 'APPROVED', $2)
         ON CONFLICT (email) DO UPDATE SET payload=EXCLUDED.payload`,
        [p.email, JSON.stringify(p.mentorPayload)],
      )
    }
    if (p.menteePayload) {
      await pool.query(
        `INSERT INTO mentee_applications (email, status, payload) VALUES ($1, 'APPROVED', $2)
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
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM match_runs')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM mentee_applications')
  await pool.query('DELETE FROM mentor_applications')
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

const admin = { 'x-user-email': 'admin@test.com' }

// ── New application → admin notification ──────────────────────────

describe('Email: new application submitted', () => {
  beforeEach(() => _testClear())

  it('notifies admins about a new application', () => {
    notifyAdminsNewApplication(['admin@test.com'], 'New Person', 'new@test.com', 'mentee')

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'admin@test.com')
    assert.ok(sent[0].subject.includes('New Person'))
    assert.ok(sent[0].subject.includes('mentee'))
  })

  it('notifies multiple admins', () => {
    notifyAdminsNewApplication(['admin1@test.com', 'admin2@test.com'], 'New Person', 'new@test.com', 'mentor')

    const sent = _testGetSent()
    assert.equal(sent.length, 2)
  })
})

// ── Application approved → applicant notification ─────────────────

describe('Email: application approved', () => {
  beforeEach(() => _testClear())

  it('notifies applicant when approved', () => {
    notifyApplicantApproved('new@test.com', 'New Person')

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'new@test.com')
    assert.ok(sent[0].subject.includes('approved'))
  })
})

// ── POST /api/matches/run → admin notification ───────────────────

describe('Email: match run created', () => {
  beforeEach(() => _testClear())

  it('notifies admins when a match run is created', async () => {
    const { status, data } = await post('/api/matches/run', { email: 'mentee1@test.com' })
    assert.equal(status, 200)
    assert.ok(data.run)

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'admin@test.com')
    assert.ok(sent[0].subject.includes('Mentee One'))
    assert.ok(sent[0].subject.includes('pending review'))
  })

  it('does not send email when no mentors are available', async () => {
    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '0')`,
    )
    await pool.query(`UPDATE match_runs SET status = 'CANCELLED' WHERE mentee_email = 'mentee2@test.com'`)

    const { data } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    assert.equal(data.run, null)

    const sent = _testGetSent()
    assert.equal(sent.length, 0)

    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '2') WHERE email = 'mentor1@test.com'`,
    )
    await pool.query(
      `UPDATE mentor_applications SET payload = jsonb_set(payload, '{max_capacity}', '1') WHERE email = 'mentor2@test.com'`,
    )
  })
})

// ── Admin review: auto-activate (1 approved) → mentor+mentee ─────

describe('Email: admin auto-activates (1 approved)', () => {
  beforeEach(() => _testClear())

  it('notifies mentor and mentee when admin approves exactly 1', async () => {
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

    const sent = _testGetSent()
    assert.equal(sent.length, 2)

    const mentorEmail = sent.find(s => s.to === 'mentor1@test.com')
    assert.ok(mentorEmail, 'mentor should receive an email')
    assert.ok(mentorEmail.subject.includes('Mentee One'))

    const menteeEmail = sent.find(s => s.to === 'mentee1@test.com')
    assert.ok(menteeEmail, 'mentee should receive an email')
    assert.ok(menteeEmail.subject.includes('Mentor One'))
  })
})

// ── Admin review: AWAITING_MENTEE (multiple approved) → mentee ───

describe('Email: admin approves multiple → mentee notified', () => {
  beforeEach(() => _testClear())

  it('notifies mentee to pick when admin approves multiple', async () => {
    // Cancel mentee1's run so mentee2 can get a fresh run
    await pool.query(`UPDATE match_runs SET status = 'CANCELLED' WHERE mentee_email = 'mentee2@test.com'`)

    _testClear()
    const { data: runData } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    const runId = runData.run.run_id

    const candidates = await pool.query(
      `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE' ORDER BY rank`,
      [runId],
    )
    const allIds = candidates.rows.map(r => r.match_id)
    assert.ok(allIds.length >= 2, 'need at least 2 candidates for this test')

    _testClear()
    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: allIds },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.run_status, 'AWAITING_MENTEE')

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].to, 'mentee2@test.com')
    assert.ok(sent[0].subject.includes('ready'))
  })
})

// ── Mentee selects a match → mentor+mentee ───────────────────────

describe('Email: mentee selects a match', () => {
  beforeEach(() => _testClear())

  it('notifies mentor and mentee when mentee picks', async () => {
    const approvedResult = await pool.query(
      `SELECT m.match_id FROM matches m
       JOIN match_runs r ON r.run_id = m.run_id
       WHERE r.mentee_email = 'mentee2@test.com' AND m.status = 'APPROVED'
       ORDER BY m.rank LIMIT 1`,
    )
    const matchId = approvedResult.rows[0].match_id

    const { status, data } = await post(
      `/api/matches/${matchId}/select`,
      { email: 'mentee2@test.com' },
    )
    assert.equal(status, 200)
    assert.equal(data.status, 'ACTIVE')

    const sent = _testGetSent()
    assert.equal(sent.length, 2)

    const mentorNotif = sent.find(s => s.to !== 'mentee2@test.com')
    assert.ok(mentorNotif, 'mentor should receive an email')
    assert.ok(mentorNotif.subject.includes('Mentee Two'))

    const menteeNotif = sent.find(s => s.to === 'mentee2@test.com')
    assert.ok(menteeNotif, 'mentee should receive an email')
    assert.ok(menteeNotif.subject.includes('confirmed'))
  })
})

// ── No email on cancelled review ─────────────────────────────────

describe('Email: no notification on cancelled review', () => {
  beforeEach(() => _testClear())

  it('sends no email when admin approves 0 (cancels run)', async () => {
    // Need a fresh run to cancel
    await pool.query(`UPDATE match_runs SET status = 'CANCELLED' WHERE mentee_email = 'mentee2@test.com'`)
    await pool.query(
      `UPDATE matches SET status = 'REJECTED' WHERE mentee_email = 'mentee2@test.com'`,
    )

    _testClear()
    const { data: runData } = await post('/api/matches/run', { email: 'mentee2@test.com' })
    if (!runData.run) return // no mentors available, skip
    const runId = runData.run.run_id

    _testClear()
    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: [] },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.run_status, 'CANCELLED')

    const sent = _testGetSent()
    assert.equal(sent.length, 0)
  })
})
