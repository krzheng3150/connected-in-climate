// A single auto-approved match activates immediately and must create its
// shared Drive folder. Google OAuth is blanked so no real Drive call is made;
// resources.js then logs that it was skipped, which proves it was invoked.
process.env.GOOGLE_OAUTH_CLIENT_ID = ''
process.env.GOOGLE_OAUTH_CLIENT_SECRET = ''
process.env.GOOGLE_OAUTH_REFRESH_TOKEN = ''

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { pool, setupDb, resetDb } from './test-db.js'
import matchRouter from './match-api.js'

let server, baseUrl

const SHARED = { career_areas: ['Engineering'], climate_areas: ['Energy'], sectors: ['Private'], city: 'SF', country: 'US' }

async function insertProfile(email, role, appPayload) {
  await pool.query(`INSERT INTO user_profiles (email, name, role, payload) VALUES ($1, $2, $3, $4)`,
    [email, email.split('@')[0], role, JSON.stringify(SHARED)])
  const table = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'
  await pool.query(`INSERT INTO ${table} (email, status, payload) VALUES ($1, 'APPROVED', $2)`,
    [email, JSON.stringify(appPayload)])
}

before(async () => {
  await setupDb()
  // example.org is NOT in REQUIRE_REVIEW_DOMAINS, so matches auto-approve
  await insertProfile('mentor@example.org', 'mentor', { top_strengths: ['a'], general_topics: [], motivation: 'Help.', max_capacity: 2 })
  await insertProfile('mentee@example.org', 'mentee', { top_topics: ['a'], statement_of_intent: 'Learn.' })

  const app = express()
  app.use(express.json())
  app.use('/api/matches', matchRouter)
  app.use((err, _req, res, _next) => { res.status(500).json({ error: err.message }) })
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  await resetDb()
  server?.close()
  await pool.end()
})

describe('auto-approved single match', () => {
  it('activates the match and creates its Drive resources', async () => {
    const logs = []
    const origLog = console.log
    console.log = (...args) => { logs.push(args.join(' ')); origLog(...args) }
    let body
    try {
      const res = await fetch(`${baseUrl}/api/matches/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'mentee@example.org' }),
      })
      assert.equal(res.status, 200)
      body = await res.json()
      for (let i = 0; i < 20 && !logs.some(l => l.includes('[resources]')); i++) {
        await new Promise(r => setTimeout(r, 50))
      }
    } finally {
      console.log = origLog
    }
    assert.equal(body.run.status, 'ACTIVE')
    const active = await pool.query(`SELECT count(*)::int AS n FROM matches WHERE run_id = $1 AND status = 'ACTIVE'`, [body.run.run_id])
    assert.equal(active.rows[0].n, 1)
    assert.ok(logs.some(l => l.includes('[resources] Google OAuth not configured')),
      'createMatchResources should be invoked for an auto-activated match')
  })
})
