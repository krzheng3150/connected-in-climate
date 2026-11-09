import { Router } from 'express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
import { FIELDS, normalize, normalizeArray } from './field-registry.js'
import { isMentor, isMentee } from './roles.js'

const router = Router()

const EMBEDDING_DIMENSIONS = 1536

const ENUM_SINGLE_FIELDS = new Set([
  'education_level', 'career_level', 'years_experience', 'years_climate_experience',
  'employment_situation', 'management_experience', 'business_experience',
  'international_experience', 'nonprofit_board_experience', 'freelance_experience',
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

const FREE_TEXT_FIELDS = new Set([
  'preferred_name', 'pronouns', 'location', 'organization', 'timezone', 'scheduling_link',
  'motivation', 'statement_of_intent', 'fun_fact',
  'relevant_projects', 'eq_response', 'additional_info', 'commitment_name',
])

const ARRAY_FREE_TEXT_FIELDS = new Set([
  'certifications', 'interests_hobbies', 'locations_open_to',
])

const MAX_TEXT_LENGTH = {
  statement_of_intent: 2000,
  motivation: 2000,
  fun_fact: 500,
  preferred_name: 200,
  pronouns: 100,
  location: 200,
  organization: 200,
  relevant_projects: 2000,
  eq_response: 2000,
  additional_info: 2000,
  commitment_name: 200,
}

// ── TF-IDF (same algorithm as import.js) ─────────────────────────

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1)
}

function hashBucket(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = (h * 0x01000193) >>> 0
  }
  return h % EMBEDDING_DIMENSIONS
}

function computeSingleEmbedding(text) {
  const tokens = tokenize(text || '')
  if (tokens.length === 0) return null

  const tf = new Map()
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)

  const vec = new Float64Array(EMBEDDING_DIMENSIONS)
  for (const [term, count] of tf) {
    const tfidf = count / tokens.length
    vec[hashBucket(term)] += tfidf
  }

  let mag = 0
  for (let i = 0; i < vec.length; i++) mag += vec[i] ** 2
  mag = Math.sqrt(mag)
  if (mag > 0) for (let i = 0; i < vec.length; i++) vec[i] /= mag

  return Array.from(vec)
}

// ── Validation ────────────────────────────────────────────────────

function validateProfile(body) {
  const errors = []
  const { role, name, ...fields } = body

  if (!name || !String(name).trim()) errors.push({ field: 'name', message: 'Name is required.' })
  if (!['mentor', 'mentee', 'both'].includes(role)) errors.push({ field: 'role', message: 'Role must be mentor, mentee, or both.' })

  if (isMentee(role) && !fields.statement_of_intent?.trim()) {
    errors.push({ field: 'statement_of_intent', message: 'Statement of intent is required for mentees.' })
  }
  if (isMentor(role) && !fields.motivation?.trim()) {
    errors.push({ field: 'motivation', message: 'Motivation is required for mentors.' })
  }
  if (!fields.career_level) {
    errors.push({ field: 'career_level', message: 'Career level is required.' })
  }
  if (!fields.climate_areas || (Array.isArray(fields.climate_areas) && fields.climate_areas.length === 0)) {
    errors.push({ field: 'climate_areas', message: 'At least one climate area is required.' })
  }
  if (!fields.career_areas || (Array.isArray(fields.career_areas) && fields.career_areas.length === 0)) {
    errors.push({ field: 'career_areas', message: 'At least one career area is required.' })
  }

  const payload = {}
  const links = {}

  for (const [key, val] of Object.entries(fields)) {
    if (!val || (Array.isArray(val) && val.length === 0)) continue

    if (key === 'links' && typeof val === 'object' && !Array.isArray(val)) {
      for (const [k, v] of Object.entries(val)) {
        const url = String(v).trim()
        if (!url) continue
        if (!/^https?:\/\//i.test(url)) {
          errors.push({ field: 'links', message: `Invalid URL for ${k}: must start with http:// or https://` })
          continue
        }
        links[k] = url
      }
      continue
    }

    if (ENUM_SINGLE_FIELDS.has(key)) {
      const result = normalize(key, val)
      if (result && typeof result === 'object' && result.unknown) {
        errors.push({ field: key, message: `Invalid value for ${key}: "${val}"` })
      } else if (result) {
        payload[key] = result
      }
    } else if (ENUM_ARRAY_FIELDS.has(key)) {
      const items = Array.isArray(val) ? val : [val]
      const registryField = ENUM_FIELD_MAP[key] || key
      if (FIELDS[registryField]) {
        const { values, warnings } = normalizeArray(registryField, items)
        for (const w of warnings) errors.push({ field: key, message: `Invalid value for ${key}: "${w.value}"` })
        if (values.length) payload[key] = [...new Set(values)]
      }
    } else if (FREE_TEXT_FIELDS.has(key)) {
      const text = String(val).trim()
      const max = MAX_TEXT_LENGTH[key] || 1000
      if (text.length > max) {
        errors.push({ field: key, message: `${key} must be ${max} characters or fewer.` })
        continue
      }
      payload[key] = text
    } else if (ARRAY_FREE_TEXT_FIELDS.has(key)) {
      const items = Array.isArray(val) ? val : String(val).split(/[|\n;]/).map(s => s.trim()).filter(Boolean)
      if (items.length) payload[key] = items
    }
  }

  if (Object.keys(links).length) payload.links = links

  return { errors, name: String(name).trim(), role, payload }
}

function buildEmbedding(role, payload) {
  const embeddingText = isMentee(role) ? payload.statement_of_intent : payload.motivation
  try {
    const embedding = computeSingleEmbedding(embeddingText)
    return embedding ? `[${embedding.join(',')}]` : null
  } catch (err) {
    console.error(`[profile] embedding failed for role=${role}:`, err.message || err)
    return null
  }
}

// ── POST /api/profiles ────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const email = await getAuthEmail(req)
    if (!email) return res.status(401).json({ error: 'not authenticated' })

    const existing = await pool.query(
      'SELECT email FROM user_profiles WHERE email = $1',
      [email],
    )
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Profile already exists.' })
    }

    const { errors, name, role, payload } = validateProfile(req.body)
    if (errors.length) return res.status(400).json({ errors })

    await pool.query(
      `INSERT INTO user_profiles (email, name, role, payload, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5::vector, now())`,
      [email, name, role, JSON.stringify(payload), buildEmbedding(role, payload)],
    )

    console.log(`[profile] created: email=${email} role=${role} name="${name}"`)
    res.status(201).json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /api/profiles ───────────────────────────────────────────

router.patch('/', async (req, res, next) => {
  try {
    const email = await getAuthEmail(req)
    if (!email) return res.status(401).json({ error: 'not authenticated' })

    const existing = await pool.query(
      'SELECT email FROM user_profiles WHERE email = $1',
      [email],
    )
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found.' })
    }

    const { errors, name, role, payload } = validateProfile(req.body)
    if (errors.length) return res.status(400).json({ errors })

    await pool.query(
      `UPDATE user_profiles SET name = $2, role = $3, payload = $4,
              embedding = $5::vector, updated_at = now()
       WHERE email = $1`,
      [email, name, role, JSON.stringify(payload), buildEmbedding(role, payload)],
    )

    console.log(`[profile] updated: email=${email} role=${role} name="${name}"`)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
