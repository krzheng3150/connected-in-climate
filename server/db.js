import fs from 'node:fs/promises'
import pg from 'pg'

const isProd = process.env.NODE_ENV === 'production'

function connectionString() {
  const url = new URL(process.env.DATABASE_URL)
  // pg lets sslmode in the URL override the ssl option below, and newer versions
  // treat sslmode=require as full verification, which fails without the CA.
  if (isProd) url.searchParams.delete('sslmode')
  return url.toString()
}

export const pool = new pg.Pool({
  connectionString: connectionString(),
  // DigitalOcean managed Postgres requires TLS. CA_CERT is bound in .do/app.yaml.
  ssl: isProd ? { ca: process.env.CA_CERT, rejectUnauthorized: Boolean(process.env.CA_CERT) } : false,
})

export async function migrate() {
  const sql = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  await pool.query(sql)
}
