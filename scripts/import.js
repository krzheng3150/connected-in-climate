import { readFileSync } from 'node:fs'
import { parse } from 'node:path'
import { isMentor, isMentee } from '../server/roles.js'
import { FIELDS, normalize, normalizeArray } from '../server/field-registry.js'
import pg from 'pg'

const EMBEDDING_DIMENSIONS = 1536

const STABLE_COLUMNS = new Set(['email', 'name', 'role'])

const ARRAY_FIELDS = new Set([
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
  'certifications', 'interests_hobbies', 'locations_open_to',
])

const ENUM_ARRAY_FIELDS = new Set([
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
])

const ENUM_FIELD_MAP = {
  top_strengths: 'topics',
  general_topics: 'topics',
  top_topics: 'topics',
}

const ENUM_SINGLE_FIELDS = new Set([
  'education_level', 'career_level', 'years_experience', 'years_climate_experience',
  'employment_situation', 'management_experience', 'business_experience',
  'international_experience', 'nonprofit_board_experience',
])

const INT_FIELDS = new Set([
  'max_capacity', 'w_horiz', 'w_vert', 'w_sector', 'geo_match_distance_km',
])

const BOOL_FIELDS = new Set(['geo_match_preference'])

const LINKS_PREFIX = 'links_'

function usage() {
  console.error(`Usage: node scripts/import.js [--dry-run] <file.csv|file.json>

  Imports user profiles into the database.
  --dry-run   Parse and validate only, no DB writes or embedding calls.

CSV format:
  - First row is headers.
  - Required columns: email, name, role (mentor|mentee|both).
  - Array fields (pipe-separated): career_areas, climate_areas, sectors,
    top_strengths, general_topics, top_topics, certifications,
    interests_hobbies, locations_open_to.
  - Integer fields: max_capacity, w_horiz, w_vert, w_sector, geo_match_distance_km.
  - Boolean fields: geo_match_preference (true/false/yes/no/1/0).
  - Link columns: any column starting with "links_" (e.g. links_linkedin,
    links_phone) is collected into a "links" object.
  - Free-text fields: statement_of_intent, motivation, fun_fact, etc.
  - All other columns go into the JSON payload as strings.

JSON format:
  - Array of objects with the same field names.
  - Array fields should be actual arrays (not pipe-separated).
  - Links should be an object: { "links": { "linkedin": "...", "phone": "..." } }.`)
  process.exit(1)
}

// ── CSV parser (handles quoted fields with commas/newlines) ──────────

function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field.trim()); field = ''
    } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
      if (ch === '\r') i++
      row.push(field.trim()); field = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  row.push(field.trim())
  if (row.some(Boolean)) rows.push(row)

  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row')

  const headers = rows[0].map(h => h.toLowerCase().trim())
  return rows.slice(1).map((r, idx) => {
    const obj = {}
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = r[i] ?? ''
    }
    obj._row = idx + 2
    return obj
  })
}

// ── Parse a boolean from CSV string ─────────────────────────────────

function parseBool(val) {
  const s = String(val).toLowerCase().trim()
  if (['true', 'yes', '1'].includes(s)) return true
  if (['false', 'no', '0', ''].includes(s)) return false
  return null
}

// ── Row → profile record ────────────────────────────────────────────

function parseRow(raw) {
  const errors = []

  const email = (raw.email || '').toLowerCase().trim()
  if (!email) errors.push('missing email')

  const name = (raw.name || '').trim()
  if (!name) errors.push('missing name')

  const role = (raw.role || '').toLowerCase().trim()
  if (!['mentor', 'mentee', 'both'].includes(role)) {
    errors.push(`invalid role "${raw.role}" (must be mentor, mentee, or both)`)
  }

  const payload = {}
  const links = {}

  for (const [key, val] of Object.entries(raw)) {
    if (key === '_row' || STABLE_COLUMNS.has(key) || !val) continue

    if (key.startsWith(LINKS_PREFIX)) {
      const linkName = key.slice(LINKS_PREFIX.length)
      if (linkName && String(val).trim()) links[linkName] = String(val).trim()
      continue
    }

    if (key === 'links' && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(links, val)
      continue
    }

    if (ARRAY_FIELDS.has(key)) {
      const items = Array.isArray(val) ? val : String(val).split('|').map(s => s.trim()).filter(Boolean)
      if (!items.length) continue
      const registryField = ENUM_FIELD_MAP[key] || key
      if (ENUM_ARRAY_FIELDS.has(key) && FIELDS[registryField]) {
        const { values, warnings } = normalizeArray(registryField, items)
        for (const w of warnings) errors.push(`${key}: unknown value "${w.value}"`)
        if (values.length) payload[key] = values
      } else {
        payload[key] = items
      }
    } else if (ENUM_SINGLE_FIELDS.has(key)) {
      const result = normalize(key, val)
      if (result && typeof result === 'object' && result.unknown) {
        errors.push(`${key}: unknown value "${result.value}"`)
      } else if (result) {
        payload[key] = result
      }
    } else if (INT_FIELDS.has(key)) {
      const n = Number(val)
      if (Number.isNaN(n)) { errors.push(`${key} must be a number, got "${val}"`); continue }
      payload[key] = n
    } else if (BOOL_FIELDS.has(key)) {
      const b = parseBool(val)
      if (b === null) { errors.push(`${key} must be true/false, got "${val}"`); continue }
      payload[key] = b
    } else {
      payload[key] = String(val)
    }
  }

  if (Object.keys(links).length) payload.links = links

  if (isMentee(role) && !payload.statement_of_intent) errors.push('mentee missing statement_of_intent')
  if (isMentor(role) && !payload.motivation) errors.push('mentor missing motivation')

  const embeddingText = isMentee(role) ? payload.statement_of_intent : payload.motivation

  return { email, name, role, payload, embeddingText, errors }
}

// ── Local TF-IDF embeddings (no external API) ─────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
}

// FNV-1a hash → bucket index in [0, EMBEDDING_DIMENSIONS)
function hashBucket(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h % EMBEDDING_DIMENSIONS
}

function computeEmbeddings(texts) {
  const docFreq = new Map()
  const tokenized = texts.map(text => {
    const tokens = tokenize(text || '')
    const unique = new Set(tokens)
    for (const t of unique) docFreq.set(t, (docFreq.get(t) || 0) + 1)
    return tokens
  })

  const N = texts.length
  return tokenized.map(tokens => {
    if (tokens.length === 0) return null

    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)

    const vec = new Float64Array(EMBEDDING_DIMENSIONS)
    for (const [term, count] of tf) {
      const tfidf = (count / tokens.length) * Math.log(N / (docFreq.get(term) || 1))
      vec[hashBucket(term)] += tfidf
    }

    // L2 normalize
    let mag = 0
    for (let i = 0; i < vec.length; i++) mag += vec[i] ** 2
    mag = Math.sqrt(mag)
    if (mag > 0) for (let i = 0; i < vec.length; i++) vec[i] /= mag

    return Array.from(vec)
  })
}

// ── DB upsert ───────────────────────────────────────────────────────

async function upsertProfiles(pool, profiles) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const p of profiles) {
      const embeddingLiteral = p.embedding ? `[${p.embedding.join(',')}]` : null
      await client.query(
        `INSERT INTO user_profiles (email, name, role, payload, embedding, updated_at)
         VALUES ($1, $2, $3, $4, $5::vector, now())
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           payload = EXCLUDED.payload,
           embedding = EXCLUDED.embedding,
           updated_at = now()`,
        [p.email, p.name, p.role, JSON.stringify(p.payload), embeddingLiteral],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Main ────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const file = args.find(a => !a.startsWith('-'))
if (!file) usage()

console.log(`Reading ${file}...`)
const raw = readFileSync(file, 'utf8')

const ext = parse(file).ext.toLowerCase()
let rows
if (ext === '.json') {
  rows = JSON.parse(raw)
  if (!Array.isArray(rows)) throw new Error('JSON file must contain an array of objects')
} else {
  rows = parseCSV(raw)
}
console.log(`Parsed ${rows.length} rows`)

const profiles = rows.map(r => ({ ...parseRow(r), _row: r._row }))
const valid = profiles.filter(p => p.errors.length === 0)
const invalid = profiles.filter(p => p.errors.length > 0)

if (invalid.length) {
  console.error(`\n${invalid.length} rows with errors:`)
  for (const p of invalid) {
    console.error(`  Row ${p._row ?? '?'} (${p.email || 'no email'}): ${p.errors.join(', ')}`)
  }
}

console.log(`\n${valid.length} valid profiles (${invalid.length} skipped)`)

const mentors = valid.filter(p => isMentor(p.role))
const mentees = valid.filter(p => isMentee(p.role))
console.log(`  Mentors: ${mentors.length}  |  Mentees: ${mentees.length}`)

if (dryRun) {
  console.log('\n[DRY RUN] Previewing first 3 profiles:\n')
  for (const p of valid.slice(0, 3)) {
    console.log(`  ${p.email} (${p.role})`)
    console.log(`    name: ${p.name}`)
    console.log(`    payload keys: ${Object.keys(p.payload).join(', ')}`)
    if (p.payload.links) console.log(`    links: ${Object.keys(p.payload.links).join(', ')}`)
    if (p.payload.location) console.log(`    location: ${p.payload.location}`)
    console.log(`    embedding text: "${(p.embeddingText || '').slice(0, 80)}..."`)
    console.log()
  }
  console.log('[DRY RUN] No database writes or API calls made.')
  process.exit(0)
}

console.log('\nComputing TF-IDF embeddings locally...')
const texts = valid.map(p => p.embeddingText)
const embeddings = computeEmbeddings(texts)
for (let i = 0; i < valid.length; i++) {
  valid[i].embedding = embeddings[i]
}
const nonNull = embeddings.filter(Boolean).length
console.log(`Computed ${nonNull} embeddings (${EMBEDDING_DIMENSIONS} dimensions each, ${embeddings.length - nonNull} skipped)`)

console.log('\nUpserting into database...')
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
try {
  const schemaSql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  await pool.query(schemaSql)
  await upsertProfiles(pool, valid)
  console.log(`Done! ${valid.length} profiles upserted.`)
} finally {
  await pool.end()
}
