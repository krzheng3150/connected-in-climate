// Shared DB helpers for integration tests. Import this INSTEAD of ./db.js in test files.
import './test-env.js'
import { pool, migrate } from './db.js'

export { pool }

// Truncate every app table. Order-independent (CASCADE), so FK changes can't break cleanup.
export async function resetDb() {
  await pool.query(`
    TRUNCATE feedbacks, match_actions, rejections, matches, match_runs,
             mentee_applications, mentor_applications, user_profiles
    RESTART IDENTITY CASCADE
  `)
}

// Build the schema with the same code prod runs on boot (db/schema.sql), then start clean.
export async function setupDb() {
  await migrate()
  await resetDb()
}
