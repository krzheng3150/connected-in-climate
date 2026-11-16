// Round-trip guarantees for the application form:
//   1. every field the form can send is actually stored (nothing silently dropped)
//   2. re-saving what the server returned changes nothing (no data loss on edit)
//
// The guard test below reads ApplicationForm.jsx, so adding a form field without
// adding it here fails the suite and forces the question "is it stored?".
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { pool, setupDb, resetDb } from './test-db.js'
import profileRouter from './profile-api.js'
import { FIELDS } from './field-registry.js'

let server, baseUrl
const EMAIL = 'roundtrip@test.com'

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
after(async () => { await resetDb(); server?.close(); await pool.end() })
beforeEach(async () => { await resetDb() })

async function send(method, body) {
  const res = await fetch(`${baseUrl}/api/profiles`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-email': EMAIL },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

const firstId = (field, n = 1) => Object.keys(FIELDS[field]).slice(0, n)

// One value for every field the form can send. Enum values come from the registry.
const SHARED_VALUES = {
  preferred_name: 'Kev',
  name_pronunciation: 'KEV-in',
  pronouns: 'he/him',
  organization: 'Acme Climate',
  country: 'US',
  city: 'Boston',
  timezone: 'America/New_York',
  career_level: firstId('career_level')[0],
  education_level: firstId('education_level')[0],
  years_experience: firstId('years_experience')[0],
  years_climate_experience: firstId('years_climate_experience')[0],
  climate_areas: firstId('climate_areas', 2),
  career_areas: firstId('career_areas', 2),
  sectors: firstId('sectors', 2),
  fun_fact: 'Climbs things',
  additional_info: 'Anything else',
  links: { linkedin: 'https://linkedin.com/in/test' },
}
const MENTOR_VALUES = {
  motivation: 'I want to help.',
  eq_response: 'I would listen first.',
  scheduling_link: 'https://cal.example.org/me',
  commitment_name: 'Kevin Zheng',
  management_experience: firstId('management_experience')[0],
  business_experience: firstId('business_experience')[0],
  international_experience: firstId('international_experience')[0],
  nonprofit_board_experience: firstId('nonprofit_board_experience')[0],
  freelance_experience: firstId('freelance_experience')[0],
  top_strengths: firstId('topics', 3),
  general_topics: firstId('topics', 5).slice(3),
  max_capacity: 4,
}
const MENTEE_VALUES = {
  statement_of_intent: 'I want to switch into climate.',
  relevant_projects: 'Solar co-op',
  commitment_name: 'Kevin Zheng',
  employment_situation: firstId('employment_situation')[0],
  top_topics: firstId('topics', 3),
}

const roleBody = role => ({
  name: 'Kevin Zheng', role, ...SHARED_VALUES, ...(role === 'mentor' ? MENTOR_VALUES : MENTEE_VALUES),
})

async function snapshot() {
  const q = async sql => (await pool.query(sql, [EMAIL])).rows[0]?.payload ?? null
  return {
    shared: await q('SELECT payload FROM user_profiles WHERE email = $1'),
    mentor: await q('SELECT payload FROM mentor_applications WHERE email = $1'),
    mentee: await q('SELECT payload FROM mentee_applications WHERE email = $1'),
  }
}
const merged = s => ({ ...s.shared, ...s.mentor, ...s.mentee })

describe('application form field coverage', () => {
  it('this test knows about every field the form can send', () => {
    const src = readFileSync(new URL('../client/src/components/ApplicationForm.jsx', import.meta.url), 'utf8')
    const sent = new Set([
      ...[...src.matchAll(/set\('([a-z_]+)'/g)].map(m => m[1]),
      ...[...src.matchAll(/key: '([a-z_]+)'/g)].map(m => m[1]),
    ])
    const covered = new Set([
      'name', 'role',
      ...Object.keys(SHARED_VALUES), ...Object.keys(MENTOR_VALUES), ...Object.keys(MENTEE_VALUES),
    ])
    const missing = [...sent].filter(k => !covered.has(k))
    assert.deepEqual(missing, [], `form sends fields this round-trip test does not cover: ${missing.join(', ')}`)
  })
})

describe('form fields are stored', () => {
  for (const role of ['mentor', 'mentee']) {
    it(`every field a ${role} can submit is saved`, async () => {
      const body = roleBody(role)
      const { status, data } = await send('POST', body)
      assert.equal(status, 201, JSON.stringify(data))

      const snap = await snapshot()
      const all = merged(snap)
      const missing = []
      for (const [key, expected] of Object.entries(body)) {
        if (key === 'name' || key === 'role') continue
        if (JSON.stringify(all[key]) !== JSON.stringify(expected)) {
          missing.push(`${key}: sent ${JSON.stringify(expected)}, stored ${JSON.stringify(all[key])}`)
        }
      }
      assert.deepEqual(missing, [], `fields not stored as sent:\n${missing.join('\n')}`)

      // and they land in the right place
      const roleSnap = role === 'mentor' ? snap.mentor : snap.mentee
      const roleKeys = Object.keys(role === 'mentor' ? MENTOR_VALUES : MENTEE_VALUES)
      for (const key of roleKeys) assert.ok(key in roleSnap, `${key} should be in the ${role} application`)
      for (const key of Object.keys(SHARED_VALUES)) assert.ok(key in snap.shared, `${key} should be in the shared payload`)
      for (const key of roleKeys) {
        if (key !== 'commitment_name') assert.ok(!(key in snap.shared), `${key} must not leak into the shared payload`)
      }
    })
  }
})

describe('editing is lossless', () => {
  for (const role of ['mentor', 'mentee']) {
    it(`re-saving a ${role}'s returned profile changes nothing`, async () => {
      await send('POST', roleBody(role))
      const before = await snapshot()
      const { status } = await send('PATCH', { name: 'Kevin Zheng', role, ...merged(before) })
      assert.equal(status, 200)
      assert.deepEqual(await snapshot(), before)
    })
  }

  it('re-saving as either role leaves a dual-role user unchanged', async () => {
    await send('POST', roleBody('mentee'))
    await send('POST', roleBody('mentor'))
    const before = await snapshot()
    for (const role of ['mentor', 'mentee']) {
      const { status } = await send('PATCH', { name: 'Kevin Zheng', role, ...merged(before) })
      assert.equal(status, 200)
      const after = await snapshot()
      assert.deepEqual(after.mentor, before.mentor, `mentor application changed after a ${role} save`)
      assert.deepEqual(after.mentee, before.mentee, `mentee application changed after a ${role} save`)
      assert.deepEqual(after.shared, before.shared, `shared payload changed after a ${role} save`)
    }
  })

  it('does not drop shared data the form never shows (e.g. matching weights)', async () => {
    await send('POST', roleBody('mentee'))
    await pool.query(`UPDATE user_profiles SET payload = payload || '{"w_horiz":5,"w_vert":2,"w_sector":3}' WHERE email = $1`, [EMAIL])
    const before = await snapshot()
    await send('PATCH', { name: 'Kevin Zheng', role: 'mentee', ...merged(before) })
    const after = await snapshot()
    assert.equal(after.shared.w_horiz, 5)
    assert.equal(after.shared.w_vert, 2)
    assert.equal(after.shared.w_sector, 3)
  })
})
