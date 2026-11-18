import { Router } from 'express'
import { pool } from './db.js'
import { getAuthEmail } from './auth.js'
import { FIELDS, normalize, normalizeArray } from './field-registry.js'
import { deriveRole } from './roles.js'
import { notifyAdminsNewApplication } from './email.js'

import { AUTO_APPROVE_MENTOR, AUTO_APPROVE_MENTEE, requiresReview } from './flags.js'

const router = Router()

const EMBEDDING_DIMENSIONS = 1536

// Fields that live in user_profiles.payload (shared identity)
import {
  SHARED_PAYLOAD_FIELDS, MENTOR_PAYLOAD_FIELDS, MENTEE_PAYLOAD_FIELDS,
} from '../shared/fields.js'

const ENUM_SINGLE_FIELDS = new Set([
  'education_level', 'career_level', 'years_experience', 'years_climate_experience',
  'employment_situation', 'management_experience', 'business_experience',
  'international_experience', 'nonprofit_board_experience', 'freelance_experience',
  'country',
])

const ENUM_ARRAY_FIELDS = new Set([
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
])

const ENUM_FIELD_MAP = {
  top_strengths: 'topics',
  general_topics: 'topics',
  top_topics: 'topics',
  country: 'countries',
}

const FREE_TEXT_FIELDS = new Set([
  'preferred_name', 'name_pronunciation', 'pronouns', 'city', 'organization', 'timezone', 'scheduling_link',
  'motivation', 'statement_of_intent', 'fun_fact',
  'relevant_projects', 'eq_response', 'additional_info', 'commitment_name',
])

const ARRAY_FREE_TEXT_FIELDS = new Set([
  'certifications', 'interests_hobbies', 'locations_open_to',
])

const MIN_CAPACITY = 1
const MAX_CAPACITY = 10

const MAX_TEXT_LENGTH = {
  statement_of_intent: 2000,
  motivation: 2000,
  fun_fact: 500,
  preferred_name: 200,
  name_pronunciation: 200,
  pronouns: 100,
  city: 200,
  organization: 200,
  relevant_projects: 2000,
  eq_response: 2000,
  additional_info: 2000,
  commitment_name: 200,
}

// ── Embeddings: per-document term frequency, hashed into fixed buckets ──
// No corpus-wide IDF, so a profile's embedding never depends on other profiles.

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

function buildEmbedding(appType, payload) {
  const embeddingText = appType === 'mentee' ? payload.statement_of_intent : payload.motivation
  try {
    const embedding = computeSingleEmbedding(embeddingText)
    return embedding ? `[${embedding.join(',')}]` : null
  } catch (err) {
    console.error(`[profile] embedding failed for ${appType}:`, err.message || err)
    return null
  }
}

// ── Validation ────────────────────────────────────────────────────

function validateFields(body) {
  const errors = []
  const { role, name, ...fields } = body

  if (!name || !String(name).trim()) errors.push({ field: 'name', message: 'Name is required.' })
  if (!['mentor', 'mentee'].includes(role)) errors.push({ field: 'role', message: 'Role must be mentor or mentee.' })

  if (role === 'mentee' && !fields.statement_of_intent?.trim()) {
    errors.push({ field: 'statement_of_intent', message: 'Statement of intent is required for mentees.' })
  }
  if (role === 'mentor' && !fields.motivation?.trim()) {
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
  if ('city' in fields && !fields.city?.trim()) {
    errors.push({ field: 'city', message: 'City is required.' })
  }

  const allPayload = {}
  const links = {}

  for (const [key, val] of Object.entries(fields)) {
    // Checked before the empty-value skip so that 0 is rejected, not silently dropped.
    if (key === 'max_capacity' && val !== '' && val != null) {
      const n = Number(val)
      if (!Number.isInteger(n) || n < MIN_CAPACITY || n > MAX_CAPACITY) {
        errors.push({ field: key, message: `max_capacity must be a whole number from ${MIN_CAPACITY} to ${MAX_CAPACITY}.` })
      } else {
        allPayload[key] = n
      }
      continue
    }
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
      const registryField = ENUM_FIELD_MAP[key] || key
      const result = normalize(registryField, val)
      if (result && typeof result === 'object' && result.unknown) {
        errors.push({ field: key, message: `Invalid value for ${key}: "${val}"` })
      } else if (result) {
        allPayload[key] = result
      }
    } else if (ENUM_ARRAY_FIELDS.has(key)) {
      const items = Array.isArray(val) ? val : [val]
      const registryField = ENUM_FIELD_MAP[key] || key
      if (FIELDS[registryField]) {
        const { values, warnings } = normalizeArray(registryField, items)
        for (const w of warnings) errors.push({ field: key, message: `Invalid value for ${key}: "${w.value}"` })
        if (values.length) allPayload[key] = [...new Set(values)]
      }
    } else if (FREE_TEXT_FIELDS.has(key)) {
      const text = String(val).trim()
      const max = MAX_TEXT_LENGTH[key] || 1000
      if (text.length > max) {
        errors.push({ field: key, message: `${key} must be ${max} characters or fewer.` })
        continue
      }
      allPayload[key] = text
    } else if (ARRAY_FREE_TEXT_FIELDS.has(key)) {
      const items = Array.isArray(val) ? val : String(val).split(/[|\n;]/).map(s => s.trim()).filter(Boolean)
      if (items.length) allPayload[key] = items
    }
  }

  if (Object.keys(links).length) allPayload.links = links

  const rolePayloadFields = role === 'mentor' ? MENTOR_PAYLOAD_FIELDS : MENTEE_PAYLOAD_FIELDS
  const otherRoleFields = role === 'mentor' ? MENTEE_PAYLOAD_FIELDS : MENTOR_PAYLOAD_FIELDS
  const sharedPayload = {}
  const rolePayload = {}
  for (const [key, val] of Object.entries(allPayload)) {
    if (rolePayloadFields.has(key)) {
      rolePayload[key] = val
    } else if (otherRoleFields.has(key)) {
      // Belongs to the other role's application (the form resends the merged
      // payload for users with both roles); never store it as shared.
      continue
    } else {
      sharedPayload[key] = val
    }
  }

  return { errors, name: String(name).trim(), role, sharedPayload, rolePayload }
}

// ── POST /api/profiles ────────────────────────────────────────────

router.post('/', async (req, res, next) => {
  try {
    const email = await getAuthEmail(req)
    if (!email) return res.status(401).json({ error: 'not authenticated' })

    const { errors, name, role, sharedPayload, rolePayload } = validateFields(req.body)
    if (errors.length) return res.status(400).json({ errors })

    const appTable = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'

    const existingApp = await pool.query(
      `SELECT email FROM ${appTable} WHERE email = $1`,
      [email],
    )
    if (existingApp.rows.length > 0) {
      return res.status(409).json({ error: `You already have a ${role} application.` })
    }

    // Country drives location scoring (15% of a match), so it is required when the shared
    // profile is created. A second application reuses the existing profile's country.
    const hasSharedProfile = (await pool.query('SELECT 1 FROM user_profiles WHERE email = $1', [email])).rows.length > 0
    if (!hasSharedProfile && !sharedPayload.country) {
      return res.status(400).json({ errors: [{ field: 'country', message: 'Country is required.' }] })
    }

    const autoApprove = ((role === 'mentor' && AUTO_APPROVE_MENTOR) || (role === 'mentee' && AUTO_APPROVE_MENTEE)) && !requiresReview(email)
    const appStatus = autoApprove ? 'APPROVED' : 'PENDING'
    const embedding = buildEmbedding(role, rolePayload)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const existingProfile = await client.query(
        'SELECT email FROM user_profiles WHERE email = $1',
        [email],
      )

      if (existingProfile.rows.length === 0) {
        const derivedRole = role
        await client.query(
          `INSERT INTO user_profiles (email, name, role, payload, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
          [email, name, derivedRole, JSON.stringify(sharedPayload), appStatus],
        )
      } else {
        const otherTable = role === 'mentor' ? 'mentee_applications' : 'mentor_applications'
        const otherApp = (await client.query(
          `SELECT email FROM ${otherTable} WHERE email = $1`, [email],
        )).rows[0]
        const newRole = deriveRole(
          role === 'mentor' || !!otherApp,
          role === 'mentee' || !!otherApp,
        )
        await client.query(
          `UPDATE user_profiles SET name = $2, role = $3, payload = payload || $4,
                  updated_at = now()
           WHERE email = $1`,
          [email, name, newRole, JSON.stringify(sharedPayload)],
        )
      }

      await client.query(
        `INSERT INTO ${appTable} (email, status, payload, embedding, updated_at)
         VALUES ($1, $2, $3, $4::vector, now())`,
        [email, appStatus, JSON.stringify(rolePayload), embedding],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    console.log(`[profile] created ${role} application: email=${email} name="${name}" status=${appStatus}`)

    if (appStatus === 'PENDING') {
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)
      if (adminEmails.length > 0) {
        notifyAdminsNewApplication(adminEmails, name, email, role)
      }
    }

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

    const { errors, name, role, sharedPayload, rolePayload } = validateFields(req.body)
    if (errors.length) return res.status(400).json({ errors })

    const appTable = role === 'mentor' ? 'mentor_applications' : 'mentee_applications'
    const existingApp = await pool.query(
      `SELECT email FROM ${appTable} WHERE email = $1`, [email],
    )
    if (existingApp.rows.length === 0) {
      return res.status(404).json({ error: `No ${role} application found.` })
    }
    if (!sharedPayload.country) {
      return res.status(400).json({ errors: [{ field: 'country', message: 'Country is required.' }] })
    }

    const embedding = buildEmbedding(role, rolePayload)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Keep shared keys the form doesn't manage (e.g. matching weights, geo
      // preferences). Form-managed keys are replaced, so clearing a field works.
      // Role-specific keys never belong in the shared payload, so they are dropped.
      const current = await client.query(
        'SELECT payload FROM user_profiles WHERE email = $1 FOR UPDATE',
        [email],
      )
      const preserved = Object.fromEntries(
        Object.entries(current.rows[0]?.payload ?? {}).filter(([k]) =>
          !SHARED_PAYLOAD_FIELDS.has(k) && !MENTOR_PAYLOAD_FIELDS.has(k) && !MENTEE_PAYLOAD_FIELDS.has(k)),
      )

      await client.query(
        `UPDATE user_profiles SET name = $2, payload = $3, updated_at = now()
         WHERE email = $1`,
        [email, name, JSON.stringify({ ...preserved, ...sharedPayload })],
      )

      await client.query(
        `UPDATE ${appTable} SET payload = $2, embedding = $3::vector, updated_at = now()
         WHERE email = $1`,
        [email, JSON.stringify(rolePayload), embedding],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    console.log(`[profile] updated ${role} application: email=${email} name="${name}"`)
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
