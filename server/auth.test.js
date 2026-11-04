process.env.ADMIN_EMAILS = 'admin@test.com'

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
import adminRouter from './admin-api.js'

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
    CREATE TABLE IF NOT EXISTS match_runs (
      run_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      mentee_email TEXT NOT NULL REFERENCES user_profiles(email),
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
        CHECK (status IN ('PENDING_REVIEW','AWAITING_MENTEE','ACTIVE','CANCELLED')),
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
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

  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM match_runs')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')

  await pool.query(
    `INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, payload=EXCLUDED.payload`,
    ['user@test.com', 'Test User', 'mentee', JSON.stringify({ career_areas: ['Engineering'] })],
  )

  const app = express()
  app.use(express.json())
  app.use(clerkMiddleware())

  app.get('/api/profiles/me', async (req, res) => {
    const email = await getAuthEmail(req)
    if (!email) return res.status(401).json({ error: 'not authenticated' })
    const result = await pool.query(
      'SELECT email, name, role, payload FROM user_profiles WHERE email = $1',
      [email.toLowerCase().trim()],
    )
    const adminEmails = new Set(
      (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
    )
    const isAdmin = adminEmails.has(email.toLowerCase().trim())
    if (result.rows.length === 0) {
      return res.json({ email, name: email.split('@')[0], role: null, is_admin: isAdmin, has_profile: false })
    }
    const row = result.rows[0]
    res.json({ email: row.email, name: row.name, role: row.role, is_admin: isAdmin, has_profile: true })
  })

  app.use('/api/admin', adminRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })

  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await pool.query('DELETE FROM match_actions')
  await pool.query('DELETE FROM feedbacks')
  await pool.query('DELETE FROM matches')
  await pool.query('DELETE FROM match_runs')
  await pool.query('DELETE FROM rejections')
  await pool.query('DELETE FROM user_profiles')
  server?.close()
  await pool.end()
})

async function get(path, headers = {}) {
  const res = await fetch(`${baseUrl}${path}`, { headers })
  return { status: res.status, data: await res.json() }
}

// ── /api/profiles/me auth tests ───────────────────────────────────

describe('Auth: /api/profiles/me', () => {
  it('returns 401 with no auth header', async () => {
    const { status, data } = await get('/api/profiles/me')
    assert.equal(status, 401)
    assert.equal(data.error, 'not authenticated')
  })

  it('returns profile with x-user-email header (dev fallback)', async () => {
    const { status, data } = await get('/api/profiles/me', { 'x-user-email': 'user@test.com' })
    assert.equal(status, 200)
    assert.equal(data.email, 'user@test.com')
    assert.equal(data.has_profile, true)
    assert.equal(data.name, 'Test User')
  })

  it('returns has_profile=false for unknown email', async () => {
    const { status, data } = await get('/api/profiles/me', { 'x-user-email': 'nobody@test.com' })
    assert.equal(status, 200)
    assert.equal(data.has_profile, false)
    assert.equal(data.is_admin, false)
  })

  it('returns is_admin=true and has_profile=false for admin without profile', async () => {
    const { status, data } = await get('/api/profiles/me', { 'x-user-email': 'admin@test.com' })
    assert.equal(status, 200)
    assert.equal(data.is_admin, true)
    assert.equal(data.has_profile, false)
  })

  it('is case-insensitive for email', async () => {
    const { status, data } = await get('/api/profiles/me', { 'x-user-email': 'User@Test.com' })
    assert.equal(status, 200)
    assert.equal(data.email, 'user@test.com')
    assert.equal(data.has_profile, true)
  })
})

// ── Admin route auth tests ────────────────────────────────────────

describe('Auth: admin routes', () => {
  it('returns 403 with no auth header', async () => {
    const { status, data } = await get('/api/admin/pending')
    assert.equal(status, 403)
    assert.equal(data.error, 'admin access required')
  })

  it('returns 403 for non-admin user', async () => {
    const { status, data } = await get('/api/admin/pending', { 'x-user-email': 'user@test.com' })
    assert.equal(status, 403)
    assert.equal(data.error, 'admin access required')
  })

  it('allows admin email through', async () => {
    const { status } = await get('/api/admin/pending', { 'x-user-email': 'admin@test.com' })
    assert.equal(status, 200)
  })
})
