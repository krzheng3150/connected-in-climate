// ── Database Wipe ──────────────────────────────────────────────────
// Exports all data to a timestamped JSON file, then wipes every table.
// Prompts 3 times before proceeding. Restore with db-restore.js.
//
//   node --env-file=.env scripts/db-wipe.js
//   DATABASE_URL=<prod-url> NODE_ENV=production CA_CERT="..." node scripts/db-wipe.js

import { writeFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import pg from 'pg'

const TABLES = [
  'feedbacks',
  'match_actions',
  'matches',
  'match_runs',
  'rejections',
  'mentee_applications',
  'mentor_applications',
  'user_profiles',
]

const isProd = process.env.NODE_ENV === 'production'

function connectionString() {
  const url = new URL(process.env.DATABASE_URL)
  if (isProd) url.searchParams.delete('sslmode')
  return url.toString()
}

function ask(rl, question) {
  return new Promise(resolve => rl.question(question, resolve))
}

const pool = new pg.Pool({
  connectionString: connectionString(),
  ssl: isProd ? { ca: process.env.CA_CERT, rejectUnauthorized: Boolean(process.env.CA_CERT) } : false,
})

// ── Show what's in the database ────────────────────────────────────

console.log(`\nConnected to: ${isProd ? 'PRODUCTION' : 'local'} database`)
console.log('─'.repeat(50))

const counts = {}
for (const table of TABLES) {
  try {
    const r = await pool.query(`SELECT count(*) FROM ${table}`)
    counts[table] = parseInt(r.rows[0].count, 10)
    console.log(`  ${table}: ${counts[table]} rows`)
  } catch {
    counts[table] = 0
    console.log(`  ${table}: (table does not exist)`)
  }
}

const totalRows = Object.values(counts).reduce((a, b) => a + b, 0)
console.log(`\n  Total: ${totalRows} rows across ${TABLES.length} tables`)

if (totalRows === 0) {
  console.log('\nDatabase is already empty. Nothing to wipe.')
  await pool.end()
  process.exit(0)
}

// ── Triple confirmation ────────────────────────────────────────────

const warn = isProd ? ' ⚠️  THIS IS THE PRODUCTION DATABASE' : ''
console.log(`\nThis will PERMANENTLY DELETE all ${totalRows} rows.${warn}`)

const isTTY = process.stdin.isTTY

async function confirm() {
  if (isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const a1 = await ask(rl, '\n[1/3] Are you sure you want to wipe the database? (type "yes" to continue): ')
    if (a1.trim().toLowerCase() !== 'yes') { rl.close(); return false }

    const a2 = await ask(rl, '[2/3] Data will be exported first, but this is still destructive. Continue? (type "yes"): ')
    if (a2.trim().toLowerCase() !== 'yes') { rl.close(); return false }

    const a3 = await ask(rl, `[3/3] Final confirmation — type "WIPE ${isProd ? 'PRODUCTION' : 'LOCAL'}" to proceed: `)
    rl.close()
    return a3.trim() === `WIPE ${isProd ? 'PRODUCTION' : 'LOCAL'}`
  }

  // Piped input: read all lines at once
  const lines = readFileSync('/dev/stdin', 'utf8').split('\n').map(l => l.trim())
  console.log(`\n[1/3] Are you sure? → "${lines[0]}"`)
  if (lines[0]?.toLowerCase() !== 'yes') return false
  console.log(`[2/3] Continue? → "${lines[1]}"`)
  if (lines[1]?.toLowerCase() !== 'yes') return false
  console.log(`[3/3] Final confirmation → "${lines[2]}"`)
  return lines[2] === `WIPE ${isProd ? 'PRODUCTION' : 'LOCAL'}`
}

if (!await confirm()) {
  console.log('Aborted.')
  await pool.end()
  process.exit(0)
}

// ── Export ──────────────────────────────────────────────────────────

console.log('\nExporting data...')

const exportData = { exported_at: new Date().toISOString(), tables: {} }

for (const table of TABLES) {
  if (counts[table] === 0) continue
  const cols = table === 'user_profiles'
    ? 'email, name, role, payload, embedding::text AS embedding, status, created_at, updated_at'
    : (table === 'mentor_applications' || table === 'mentee_applications')
      ? 'email, status, payload, embedding::text AS embedding, created_at, updated_at'
      : '*'
  const r = await pool.query(`SELECT ${cols} FROM ${table}`)
  exportData.tables[table] = r.rows
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const filename = `db-export-${timestamp}.json`
writeFileSync(filename, JSON.stringify(exportData, null, 2))
console.log(`Exported to ${filename} (${(JSON.stringify(exportData).length / 1024).toFixed(1)} KB)`)

// ── Wipe ───────────────────────────────────────────────────────────

console.log('\nWiping...')
await pool.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`)
console.log('All tables truncated.')

// Verify
for (const table of TABLES) {
  const r = await pool.query(`SELECT count(*) FROM ${table}`)
  console.log(`  ${table}: ${r.rows[0].count} rows`)
}

console.log(`\nDone. Restore with: node scripts/db-restore.js ${filename}`)
await pool.end()
