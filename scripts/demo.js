#!/usr/bin/env node

// E2E demo script — run with: npm run demo [--headless]
// Resets DB, imports sample data, starts the server, runs the Playwright
// scenario through the full user flow, then tears everything down.

import { execSync, spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { SLOWMO_MS, BASE_URL } from './demo/fixtures.js'
import runScenario from './demo/scenario.js'

const headless = process.argv.includes('--headless')
const root = new URL('..', import.meta.url).pathname

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

async function waitForPostgres(timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(
        'docker compose exec -T db pg_isready -U postgres',
        { cwd: root, stdio: 'pipe' },
      )
      // pg_isready can pass before init scripts finish; verify with a real query
      execSync(
        'docker compose exec -T db psql -U postgres -d connected_in_climate -c "SELECT 1" 2>&1',
        { cwd: root, stdio: 'pipe' },
      )
      return
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error(`Postgres did not start within ${timeoutMs}ms`)
}

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`)
      if (res.ok) return
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`)
}

let server

async function setup() {
  console.log('\n══ Setup ══\n')

  console.log('Resetting database...')
  run('docker compose down -v 2>/dev/null || true', { stdio: 'pipe' })
  run('docker compose up -d db')
  console.log('Waiting for Postgres...')
  await waitForPostgres()

  console.log('Importing sample data...')
  run('node --env-file=.env scripts/import.js scripts/sample-profiles.csv')

  console.log('Seeding match lifecycle data...')
  run('node --env-file=.env scripts/seed.js')

  console.log('Building client (test mode)...')
  run('VITE_TEST_USER=1 npm run build', { stdio: 'pipe' })

  console.log('Killing any existing process on port 3000...')
  try { execSync('lsof -ti:3000 | xargs kill -9 2>/dev/null || true', { stdio: 'pipe' }) } catch { /* nothing to kill */ }
  await new Promise(r => setTimeout(r, 500))

  console.log('Starting server...')
  server = spawn('node', ['server/index.js'], {
    cwd: root,
    env: { ...process.env },
    stdio: 'pipe',
  })
  server.stdout.on('data', (d) => {
    const msg = d.toString().trim()
    if (msg) console.log(`  [server] ${msg}`)
  })
  server.stderr.on('data', (d) => {
    const msg = d.toString().trim()
    if (msg) console.error(`  [server] ${msg}`)
  })

  await waitForServer(BASE_URL)
  console.log('Server is ready.\n')
}

async function teardown() {
  console.log('\n══ Teardown ══\n')

  if (server) {
    console.log('Stopping server...')
    server.kill('SIGTERM')
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log('Cleaning up Google Drive test folders...')
  try {
    const { cleanupDriveFolders } = await import('./cleanup-drive-lib.js')
    const { deleted } = await cleanupDriveFolders({ silent: true })
    if (deleted > 0) console.log(`  Removed ${deleted} Drive folder(s)`)
    else console.log('  No Drive folders to clean up')
  } catch { console.log('  Skipped (Google OAuth not configured)') }

  console.log('Wiping database...')
  run('docker compose down -v 2>/dev/null || true', { stdio: 'pipe' })
  console.log('Done.\n')
}

// ── Main ────────────────────────────────────────────────────────────

let exitCode = 0

try {
  await setup()

  const browser = await chromium.launch({
    headless,
    slowMo: headless ? 0 : SLOWMO_MS,
  })
  const context = await browser.newContext({ viewport: null })
  const page = await context.newPage()

  try {
    await runScenario(page)
  } catch (err) {
    console.error(`\n✗ Demo failed: ${err.message}`)
    exitCode = 1
  } finally {
    await browser.close()
  }
} catch (err) {
  console.error(`\n✗ Setup failed: ${err.message}`)
  exitCode = 1
} finally {
  await teardown()
}

process.exit(exitCode)
