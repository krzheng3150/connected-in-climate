// ── Matching Algorithm ──────────────────────────────────────────────
// Pure functions: no DB, no side effects. Takes profile data in,
// returns scores and computation payloads out.

import { isMentor } from './roles.js'
import { hasExperience } from './field-registry.js'

const TOPIC_EXPERIENCE_MAP = [
  ['international_work', 'international_experience'],
  ['leadership_skills', 'management_experience'],
  ['start_business', 'business_experience'],
  ['business_ideas', 'business_experience'],
  ['nonprofit_board', 'nonprofit_board_experience'],
]

// ── Phase 1: Eligibility Filter ────────────────────────────────────

export function filterEligible(mentee, mentors, activeMatches, blockList) {
  const menteeEmail = mentee.email
  const activePartners = new Set(
    activeMatches
      .filter(m => m.mentee_email === menteeEmail && m.status === 'ACTIVE')
      .map(m => m.mentor_email),
  )
  const blocked = new Set(
    blockList
      .filter(b => b.mentee_email === menteeEmail || b.mentor_email === menteeEmail)
      .map(b => b.mentee_email === menteeEmail ? b.mentor_email : b.mentee_email),
  )

  const eligible = []
  const filtered = []

  for (const mentor of mentors) {
    const reasons = []
    if (mentor.email === menteeEmail) reasons.push('self_match')
    if (!isMentor(mentor.role)) reasons.push('not_mentor')
    if (activePartners.has(mentor.email)) reasons.push('active_match_exists')
    if (blocked.has(mentor.email)) reasons.push('blocked')

    const capacity = mentor.payload?.max_capacity ?? 0
    const activeAsMentor = activeMatches.filter(
      m => m.mentor_email === mentor.email && m.status === 'ACTIVE',
    ).length
    if (activeAsMentor >= capacity) reasons.push('capacity_full')

    if (reasons.length === 0) {
      eligible.push(mentor)
    } else {
      filtered.push({ email: mentor.email, reasons })
    }
  }

  return { eligible, filtered }
}

// ── Phase 2: Categorical Scoring ───────────────────────────────────

function jaccard(a, b) {
  if (!a?.length && !b?.length) return 0
  const setA = new Set(a ?? [])
  const setB = new Set(b ?? [])
  let intersection = 0
  for (const item of setA) {
    if (setB.has(item)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function jaccardDetail(menteeArr, mentorArr) {
  const a = menteeArr ?? []
  const b = mentorArr ?? []
  const setB = new Set(b)
  const intersection = a.filter(item => setB.has(item))
  const j = jaccard(a, b)
  return { mentee: a, mentor: b, intersection, jaccard: j }
}

export function scoreCategorical(mentee, mentor) {
  const mp = mentee.payload ?? {}
  const mm = mentor.payload ?? {}

  const horizontal = jaccardDetail(mp.career_areas, mm.career_areas)
  const vertical = jaccardDetail(mp.climate_areas, mm.climate_areas)
  const sector = jaccardDetail(mp.sectors, mm.sectors)

  const wH = mp.w_horiz ?? 1
  const wV = mp.w_vert ?? 1
  const wS = mp.w_sector ?? 1
  const totalWeight = wH + wV + wS

  const combined = totalWeight === 0
    ? 0
    : (wH * horizontal.jaccard + wV * vertical.jaccard + wS * sector.jaccard) / totalWeight

  return {
    horizontal: { ...horizontal, weight: wH },
    vertical: { ...vertical, weight: wV },
    sector: { ...sector, weight: wS },
    combined: round(combined),
  }
}

// ── Phase 3: Topic Alignment ───────────────────────────────────────

function harmonicNumber(n) {
  let h = 0
  for (let k = 1; k <= n; k++) h += 1 / k
  return h
}

export function scoreTopic(mentee, mentor) {
  const topics = mentee.payload?.top_topics ?? []
  const strengths = new Set(mentor.payload?.top_strengths ?? [])
  const general = new Set(mentor.payload?.general_topics ?? [])

  if (topics.length === 0) {
    return { details: [], harmonic_n: 0, combined: 0 }
  }

  const details = topics.map((topic, i) => {
    const rank = i + 1
    let matched_in = 'none'
    let score = 0
    if (strengths.has(topic)) { matched_in = 'top_strengths'; score = 1.0 }
    else if (general.has(topic)) { matched_in = 'general_topics'; score = 0.6 }
    const discounted = score / rank
    return { rank, topic, matched_in, score, discounted: round(discounted) }
  })

  const raw = details.reduce((sum, d) => sum + d.discounted, 0)
  const hN = harmonicNumber(topics.length)
  const combined = hN === 0 ? 0 : raw / hN

  return { details, harmonic_n: round(hN), combined: round(combined) }
}

// ── Phase 4: Semantic Embedding ────────────────────────────────────

export function scoreSemantic(menteeEmbedding, mentorEmbedding) {
  if (!menteeEmbedding || !mentorEmbedding) {
    return { cosine_similarity: null, reason: 'no_embedding' }
  }

  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < menteeEmbedding.length; i++) {
    dot += menteeEmbedding[i] * mentorEmbedding[i]
    magA += menteeEmbedding[i] ** 2
    magB += mentorEmbedding[i] ** 2
  }
  magA = Math.sqrt(magA)
  magB = Math.sqrt(magB)

  const cosine = (magA === 0 || magB === 0) ? 0 : dot / (magA * magB)
  return { cosine_similarity: round(cosine) }
}

// ── Phase 4b: Geographic Proximity ─────────────────────────────────

function normalizeLocation(loc) {
  return (loc ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function extractRegion(loc) {
  const parts = loc.split(',').map(s => s.trim())
  return parts.length >= 2 ? parts.slice(1).join(', ') : ''
}

export function scoreGeo(mentee, mentor) {
  const enabled = mentee.payload?.geo_match_preference === true
  if (!enabled) {
    return { enabled: false, score: 0 }
  }

  const menteeLoc = mentee.payload?.location ?? ''
  const mentorLoc = mentor.payload?.location ?? ''

  if (!menteeLoc || !mentorLoc) {
    return {
      enabled: true,
      mentee_location: menteeLoc || null,
      mentor_location: mentorLoc || null,
      reason: 'missing_location',
      score: 0,
    }
  }

  const mteNorm = normalizeLocation(menteeLoc)
  const mtrNorm = normalizeLocation(mentorLoc)

  if (mteNorm === mtrNorm) {
    return {
      enabled: true,
      mentee_location: menteeLoc,
      mentor_location: mentorLoc,
      reason: 'exact_city_match',
      score: 1.0,
    }
  }

  const mteRegion = extractRegion(mteNorm)
  const mtrRegion = extractRegion(mtrNorm)
  if (mteRegion && mtrRegion && mteRegion === mtrRegion) {
    return {
      enabled: true,
      mentee_location: menteeLoc,
      mentor_location: mentorLoc,
      reason: 'same_region',
      score: 0.5,
    }
  }

  const mentorOpen = (mentor.payload?.locations_open_to ?? []).map(normalizeLocation)
  if (mentorOpen.some(loc => loc === 'remote')) {
    return {
      enabled: true,
      mentee_location: menteeLoc,
      mentor_location: mentorLoc,
      reason: 'mentor_open_to_remote',
      score: 0.25,
    }
  }

  return {
    enabled: true,
    mentee_location: menteeLoc,
    mentor_location: mentorLoc,
    reason: 'no_geo_match',
    score: 0,
  }
}

// ── Phase 5: Experience Signals ───────────────────────────────────

export function scoreExperienceSignals(mentee, mentor) {
  const topics = mentee.payload?.top_topics ?? []
  const mentorPayload = mentor.payload ?? {}

  const details = []
  for (const [topicId, expField] of TOPIC_EXPERIENCE_MAP) {
    if (!topics.includes(topicId)) continue
    const mentorVal = mentorPayload[expField]
    const matched = hasExperience(mentorVal)
    details.push({ topic: topicId, field: expField, mentor_value: mentorVal ?? null, matched })
  }

  if (details.length === 0) {
    return { details: [], checked: 0, matched: 0, score: 0 }
  }

  const matched = details.filter(d => d.matched).length
  const score = matched / details.length

  return { details, checked: details.length, matched, score: round(score) }
}

// ── Phase 6: Final Score Synthesis ─────────────────────────────────

const WEIGHTS_GEO = { categorical: 0.35, topic: 0.25, semantic: 0.15, geo: 0.15, experience: 0.10 }
const WEIGHTS_NO_GEO = { categorical: 0.40, topic: 0.30, semantic: 0.15, geo: 0, experience: 0.15 }

function buildSnapshot(profile) {
  return { email: profile.email, name: profile.name, role: profile.role, ...profile.payload }
}

export function computeMatch(mentee, mentor, opts = {}) {
  const categorical = scoreCategorical(mentee, mentor)
  const topic = scoreTopic(mentee, mentor)
  const semantic = scoreSemantic(
    opts.menteeEmbedding ?? mentee.embedding,
    opts.mentorEmbedding ?? mentor.embedding,
  )
  const geo = scoreGeo(mentee, mentor)
  const experience = scoreExperienceSignals(mentee, mentor)

  const geoEnabled = geo.enabled
  const w = geoEnabled ? { ...WEIGHTS_GEO } : { ...WEIGHTS_NO_GEO }

  const semanticVal = semantic.cosine_similarity ?? 0
  const geoVal = geo.score ?? 0
  const expVal = experience.score ?? 0

  const reliability = opts.reliability_multiplier ?? 1.0

  const final = reliability * (
    w.categorical * categorical.combined +
    w.topic * topic.combined +
    w.semantic * semanticVal +
    w.geo * geoVal +
    w.experience * expVal
  )

  return {
    algorithm_version: opts.algorithm_version ?? 'unknown',
    mentee_snapshot: buildSnapshot(mentee),
    mentor_snapshot: buildSnapshot(mentor),
    scores: {
      categorical,
      topic,
      semantic,
      geo,
      experience,
      weights_used: {
        categorical: w.categorical,
        topic: w.topic,
        semantic: semantic.cosine_similarity === null ? `${w.semantic} (no data, scored as 0)` : w.semantic,
        geo: geoEnabled ? w.geo : null,
        experience: w.experience,
      },
      reliability_multiplier: reliability,
      final: round(final),
    },
    prior_matches: opts.prior_matches ?? [],
  }
}

// ── Orchestrator ───────────────────────────────────────────────────

export function rankMentors(mentee, mentors, activeMatches, blockList, opts = {}) {
  const { eligible, filtered } = filterEligible(mentee, mentors, activeMatches, blockList)

  if (eligible.length === 0) {
    return { results: [], filtered }
  }

  const results = eligible
    .map(mentor => computeMatch(mentee, mentor, opts))
    .sort((a, b) => b.scores.final - a.scores.final)
    .map((result, i) => ({ ...result, rank: i + 1 }))

  return { results, filtered }
}

// ── Helpers ─────────────────────────────────────────────────────────

function round(n) {
  return Math.round(n * 10000) / 10000
}
