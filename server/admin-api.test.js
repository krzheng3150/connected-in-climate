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
    DO $$ BEGIN
      ALTER TABLE match_runs DROP CONSTRAINT IF EXISTS match_runs_status_check;
      ALTER TABLE match_runs ADD CONSTRAINT match_runs_status_check
        CHECK (status IN ('PENDING_REVIEW','AWAITING_MENTEE','ACTIVE','CANCELLED','FINISHED'));
    END $$;
    CREATE TABLE IF NOT EXISTS matches (
      match_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES match_runs(run_id),
      mentor_email TEXT NOT NULL REFERENCES user_profiles(email),
      mentee_email TEXT NOT NULL REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'CANDIDATE'
        CHECK (status IN ('CANDIDATE','APPROVED','REJECTED','ACTIVE','STORED','FINISHED')),
      final_score NUMERIC(5,4) NOT NULL, rank INTEGER NOT NULL,
      computation_payload JSONB NOT NULL, code_commit TEXT NOT NULL,
      resources_folder_url TEXT, activated_at TIMESTAMPTZ, end_date TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ;
    ALTER TABLE matches ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS match_actions (
      action_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id UUID NOT NULL REFERENCES matches(match_id),
      actor_email TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('VIEW','FEEDBACK','CONTACT_CLICK','REJECT','APPROVE','SELECT')),
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
  await pool.query('DELETE FROM match_runs')
  await pool.query('DELETE FROM mentee_applications')
  await pool.query('DELETE FROM mentor_applications')
  await pool.query('DELETE FROM user_profiles')

  const profiles = [
    {
      email: 'mentor@test.com', name: 'Mentor', role: 'mentor',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        city: 'San Francisco', country: 'US', preferred_name: 'M', pronouns: 'they/them',
      },
      mentorPayload: {
        top_strengths: ['Topic A'], general_topics: [],
        motivation: 'Helping.', max_capacity: 2,
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
        motivation: 'Policy.', max_capacity: 1,
      },
    },
    {
      email: 'mentee@test.com', name: 'Mentee', role: 'mentee',
      shared: {
        career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'],
        w_horiz: 1, w_vert: 1, w_sector: 1, city: 'San Francisco', country: 'US', geo_match_preference: false,
      },
      menteePayload: {
        top_topics: ['Topic A'], statement_of_intent: 'Transition.',
      },
    },
  ]
  for (const p of profiles) {
    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)
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
  app.use('/api/feedback', feedbackRouter)
  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`

  // Create a run (matches start as CANDIDATE)
  await post('/api/matches/run', { email: 'mentee@test.com' })
})

after(async () => {
  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM match_runs')
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

async function get(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers })
  return { status: res.status, data: await res.json() }
}

async function del(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE', headers })
  return { status: res.status, data: await res.json() }
}

const admin = { 'x-user-email': 'admin@test.com' }

async function getRunId() {
  const result = await pool.query(
    `SELECT run_id FROM match_runs WHERE mentee_email = 'mentee@test.com' ORDER BY created_at DESC LIMIT 1`,
  )
  return result.rows[0].run_id
}

async function getCandidateIds(runId) {
  const result = await pool.query(
    `SELECT match_id FROM matches WHERE run_id = $1 AND status = 'CANDIDATE' ORDER BY rank`,
    [runId],
  )
  return result.rows.map(r => r.match_id)
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

// ── GET /api/admin/applications ────────────────────────────────────

describe('GET /api/admin/applications', () => {
  it('returns profiles with status field', async () => {
    const { status, data } = await get('/api/admin/applications', admin)
    assert.equal(status, 200)
    assert.ok(data.profiles.length >= 1)
    assert.ok(data.profiles[0].status)
  })
})

// ── POST /api/admin/applications/:email/approve ───────────────────

describe('POST /api/admin/applications/:email/approve', () => {
  it('approves a pending application', async () => {
    await pool.query(`UPDATE mentor_applications SET status = 'PENDING' WHERE email = 'mentor@test.com'`)

    const { status, data } = await post('/api/admin/applications/mentor@test.com/approve', {}, admin)
    assert.equal(status, 200)
    assert.equal(data.ok, true)

    const result = await pool.query('SELECT status FROM mentor_applications WHERE email = $1', ['mentor@test.com'])
    assert.equal(result.rows[0].status, 'APPROVED')
  })

  it('returns ok for already-approved application', async () => {
    const { status, data } = await post('/api/admin/applications/mentor@test.com/approve', {}, admin)
    assert.equal(status, 200)
    assert.equal(data.message, 'already approved')
  })

  it('returns 404 for unknown email', async () => {
    const { status } = await post('/api/admin/applications/nobody@test.com/approve', {}, admin)
    assert.equal(status, 404)
  })
})

// ── GET /api/admin/pending ─────────────────────────────────────────

describe('GET /api/admin/pending', () => {
  it('returns pending runs with candidates', async () => {
    const { status, data } = await get('/api/admin/pending', admin)
    assert.equal(status, 200)
    assert.ok(data.pending_runs.length >= 1)
    const run = data.pending_runs[0]
    assert.equal(run.mentee_email, 'mentee@test.com')
    assert.ok(run.candidates.length >= 1)
    assert.equal(run.candidates[0].status, 'CANDIDATE')
    assert.ok(run.candidates[0].computation_payload)
  })
})

// ── POST /api/admin/runs/:run_id/review ────────────────────────────

describe('POST /api/admin/runs/:run_id/review', () => {
  it('returns 400 when approved is not an array', async () => {
    const runId = await getRunId()
    const { status, data } = await post(`/api/admin/runs/${runId}/review`, { approved: 'bad' }, admin)
    assert.equal(status, 400)
    assert.ok(data.error.includes('array'))
  })

  it('returns 400 for invalid match_id in approved list', async () => {
    const runId = await getRunId()
    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: ['00000000-0000-0000-0000-000000000000'] },
      admin,
    )
    assert.equal(status, 400)
    assert.ok(data.error.includes('not a candidate'))
  })

  it('approves 1 candidate → auto-activates run', async () => {
    const runId = await getRunId()
    const candidateIds = await getCandidateIds(runId)

    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: [candidateIds[0]] },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.run_status, 'ACTIVE')
    assert.equal(data.approved_count, 1)
    assert.equal(data.rejected_count, candidateIds.length - 1)

    // Verify match status in DB
    const match = await pool.query('SELECT status FROM matches WHERE match_id = $1', [candidateIds[0]])
    assert.equal(match.rows[0].status, 'ACTIVE')
  })

  it('returns 400 when reviewing an already-reviewed run', async () => {
    const runId = await getRunId()
    const { status, data } = await post(
      `/api/admin/runs/${runId}/review`,
      { approved: [] },
      admin,
    )
    assert.equal(status, 400)
    assert.ok(data.error.includes('not PENDING_REVIEW'))
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

  it('includes computation_payload and run_id', async () => {
    const { data } = await get('/api/admin/matches?email=mentee@test.com', admin)
    const match = data.matches[0]
    assert.ok(match.computation_payload)
    assert.ok(match.computation_payload.scores)
    assert.ok(match.code_commit)
    assert.ok(match.run_id)
  })
})

// ── GET /api/admin/matches/:match_id ───────────────────────────────

describe('GET /api/admin/matches/:match_id', () => {
  it('returns full match detail with both profiles', async () => {
    const { data: listData } = await get('/api/admin/matches?email=mentee@test.com', admin)
    const matchId = listData.matches[0].match_id

    const { status, data } = await get(`/api/admin/matches/${matchId}`, admin)
    assert.equal(status, 200)
    assert.ok(data.computation_payload)
    assert.ok(data.mentor_payload)
    assert.ok(data.mentee_payload)
    assert.ok(data.mentor_name)
    assert.ok(data.run_id)
  })

  it('returns 404 for unknown match', async () => {
    const { status } = await get('/api/admin/matches/00000000-0000-0000-0000-000000000000', admin)
    assert.equal(status, 404)
  })
})

// ── POST /api/admin/matches/:match_id/reject ───────────────────────

describe('POST /api/admin/matches/:match_id/reject', () => {
  it('rejects an active match', async () => {
    const { data: listData } = await get('/api/admin/matches?email=mentee@test.com', admin)
    const activeMatch = listData.matches.find(m => m.status === 'ACTIVE')
    assert.ok(activeMatch, 'expected an ACTIVE match')

    const { status, data } = await post(
      `/api/admin/matches/${activeMatch.match_id}/reject`,
      { reason: 'Domain mismatch' },
      admin,
    )
    assert.equal(status, 200)
    assert.equal(data.status, 'REJECTED')
    assert.equal(data.block_created, false)
  })

  it('match status is now REJECTED in DB', async () => {
    const result = await pool.query(
      `SELECT status FROM matches WHERE mentee_email = 'mentee@test.com' AND rank = 1`,
    )
    assert.equal(result.rows[0].status, 'REJECTED')
  })

  it('returns 400 when rejecting a non-active match', async () => {
    const { data: listData } = await get('/api/admin/matches?email=mentee@test.com', admin)
    const rejectedMatch = listData.matches.find(m => m.status === 'REJECTED')

    const { status, data } = await post(
      `/api/admin/matches/${rejectedMatch.match_id}/reject`,
      { reason: 'Again' },
      admin,
    )
    assert.equal(status, 400)
    assert.ok(data.error.includes('not ACTIVE'))
  })
})

// ── Reject with block ──────────────────────────────────────────────

describe('Reject with block', () => {
  before(async () => {
    // Set rank-1 match back to ACTIVE so we can test block
    await pool.query(
      `UPDATE matches SET status = 'ACTIVE'
       WHERE mentee_email = 'mentee@test.com' AND rank = 1`,
    )
  })

  it('rejects and creates a block entry', async () => {
    const result = await pool.query(
      `SELECT match_id FROM matches WHERE mentee_email = 'mentee@test.com' AND rank = 1`,
    )
    const matchId = result.rows[0].match_id

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
  before(async () => {
    // Create feedback on an existing match
    const result = await pool.query(
      `SELECT match_id FROM matches WHERE mentee_email = 'mentee@test.com' LIMIT 1`,
    )
    await pool.query(
      `INSERT INTO feedbacks (match_id, submitter_email, text) VALUES ($1, 'mentee@test.com', 'Great match!')`,
      [result.rows[0].match_id],
    )
  })

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
