// ── Database Restore ───────────────────────────────────────────────
// Restores data from a db-wipe.js export file.
//
//   node --env-file=.env scripts/db-restore.js db-export-2026-11-10T12-00-00.json

import { readFileSync } from 'node:fs'
import pg from 'pg'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/db-restore.js <export-file.json>')
  process.exit(1)
}

const isProd = process.env.NODE_ENV === 'production'

function connectionString() {
  const url = new URL(process.env.DATABASE_URL)
  if (isProd) url.searchParams.delete('sslmode')
  return url.toString()
}

const data = JSON.parse(readFileSync(file, 'utf8'))
console.log(`Restoring from ${file} (exported ${data.exported_at})`)

const pool = new pg.Pool({
  connectionString: connectionString(),
  ssl: isProd ? { ca: process.env.CA_CERT, rejectUnauthorized: Boolean(process.env.CA_CERT) } : false,
})

const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
await pool.query(schemaSql)

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // Restore in FK-safe order
  const restoreOrder = [
    'user_profiles', 'match_runs', 'matches', 'match_actions', 'feedbacks', 'rejections',
  ]

  for (const table of restoreOrder) {
    const rows = data.tables[table]
    if (!rows?.length) continue

    const columns = Object.keys(rows[0])
    const hasEmbedding = columns.includes('embedding')

    for (const row of rows) {
      const vals = columns.map((c, i) => `$${i + 1}${c === 'embedding' ? '::vector' : ''}`)
      await client.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${vals.join(', ')})
         ON CONFLICT DO NOTHING`,
        columns.map(c => row[c]),
      )
    }
    console.log(`  ${table}: ${rows.length} rows`)
  }

  await client.query('COMMIT')
  console.log('\nRestore complete.')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  client.release()
  await pool.end()
}
