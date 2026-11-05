---
description: Scaffold API tests for a new or existing Express router. Generates the test file with DB setup, auth helpers, and stub test cases.
---

# Test API

Generate a test file for an Express router following the established project patterns.

## Test file structure

Every API test file follows this skeleton:

```js
import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { clerkMiddleware } from '@clerk/express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
// import the router under test

let server, baseUrl

before(async () => {
  // Ensure tables exist (CREATE TABLE IF NOT EXISTS)
  // Mount express app with json(), clerkMiddleware(), and the router
  // Listen on port 0 for random available port
  await new Promise(resolve => { server = app.listen(0, resolve) })
  baseUrl = `http://localhost:${server.address().port}`
})

after(async () => {
  // Clean up test data
  server?.close()
  await pool.end()
})

beforeEach(async () => {
  // Delete test data between tests for isolation
})
```

## Auth in tests

Use the `x-user-email` header — `getAuthEmail()` falls back to this in non-production:

```js
async function req(method, path, body, headers = {}) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${baseUrl}${path}`, opts)
  return { status: res.status, data: await res.json() }
}
```

Create shorthand helpers for the routes being tested:
```js
function post(body, email = 'test@test.com') {
  return req('POST', '/api/whatever', body, { 'x-user-email': email })
}
```

## Standard test cases per route

For each endpoint, include at minimum:

- **Happy path**: valid request returns expected status and data
- **401 no auth**: request without `x-user-email` header returns 401
- **400 validation**: request with invalid/missing required fields returns 400 with error messages
- **404 not found**: request for nonexistent resource returns 404 (where applicable)
- **409 conflict**: duplicate creation returns 409 (where applicable)
- **DB verification**: after a successful write, query the DB directly to verify the data was stored correctly

## Conventions

- Use snake_case field IDs from `field-registry.js` in test fixtures (e.g., `'entry'` not `'Mid-level'`, `'ai_climate'` not `'Renewable Energy'`)
- Keep test data minimal — only the fields needed to exercise the test case
- Name the test file `<module>.test.js` next to the module it tests
- Add a `test:<name>` script to `package.json` and wire it into `test:all`
- Tests need a running Postgres — `npm run db:up` before `npm run test:all`
