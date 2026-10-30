import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  filterEligible,
  scoreCategorical,
  scoreTopic,
  scoreSemantic,
  scoreGeo,
  computeMatch,
  rankMentors,
} from './matching.js'

// ── Test helpers ───────────────────────────────────────────────────

function makeMentee(overrides = {}) {
  return {
    email: 'mentee@example.com',
    name: 'Test Mentee',
    role: 'mentee',
    payload: {
      career_areas: ['Engineering', 'IT'],
      climate_areas: ['Energy', 'Transportation'],
      sectors: ['Private'],
      top_topics: ['Topic A', 'Topic B', 'Topic C'],
      statement_of_intent: 'I want to transition into climate tech.',
      location: 'San Francisco, CA',
      geo_match_preference: true,
      w_horiz: 3, w_vert: 3, w_sector: 3,
      ...overrides.payload,
    },
    embedding: overrides.embedding ?? null,
    ...overrides,
  }
}

function makeMentor(overrides = {}) {
  return {
    email: 'mentor@example.com',
    name: 'Test Mentor',
    role: 'mentor',
    payload: {
      career_areas: ['Engineering', 'Operations'],
      climate_areas: ['Energy', 'Built Environment'],
      sectors: ['Private'],
      top_strengths: ['Topic A', 'Topic D', 'Topic E'],
      general_topics: ['Topic B', 'Topic F'],
      motivation: 'I want to help engineers transition.',
      max_capacity: 2,
      location: 'San Francisco, CA',
      locations_open_to: ['San Francisco, CA', 'Remote'],
      ...overrides.payload,
    },
    embedding: overrides.embedding ?? null,
    ...overrides,
  }
}

function approxEqual(actual, expected, tolerance = 0.001) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `Expected ~${expected}, got ${actual}`,
  )
}

// ── Phase 1: Eligibility Filter ────────────────────────────────────

describe('Phase 1: filterEligible', () => {
  it('passes an eligible mentor through', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 1)
    assert.equal(filtered.length, 0)
  })

  it('excludes self-match', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ email: 'mentee@example.com' })
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('self_match'))
  })

  it('excludes non-mentor roles', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ role: 'mentee' })
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('not_mentor'))
  })

  it('allows role=both as mentor', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ role: 'both', email: 'both@example.com' })
    const { eligible } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 1)
  })

  it('excludes when active match exists', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const activeMatches = [
      { mentee_email: 'mentee@example.com', mentor_email: 'mentor@example.com', status: 'ACTIVE' },
    ]
    const { eligible, filtered } = filterEligible(mentee, [mentor], activeMatches, [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('active_match_exists'))
  })

  it('ignores non-ACTIVE matches', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const matches = [
      { mentee_email: 'mentee@example.com', mentor_email: 'mentor@example.com', status: 'REJECTED' },
    ]
    const { eligible } = filterEligible(mentee, [mentor], matches, [])
    assert.equal(eligible.length, 1)
  })

  it('excludes blocked pairs', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const blockList = [
      { mentee_email: 'mentee@example.com', mentor_email: 'mentor@example.com' },
    ]
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], blockList)
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('blocked'))
  })

  it('excludes when mentor at capacity', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ payload: { max_capacity: 1 } })
    const activeMatches = [
      { mentee_email: 'other@example.com', mentor_email: 'mentor@example.com', status: 'ACTIVE' },
    ]
    const { eligible, filtered } = filterEligible(mentee, [mentor], activeMatches, [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('capacity_full'))
  })

  it('collects multiple exclusion reasons', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ email: 'mentee@example.com', role: 'mentee' })
    const { filtered } = filterEligible(mentee, [mentor], [], [])
    assert.ok(filtered[0].reasons.includes('self_match'))
    assert.ok(filtered[0].reasons.includes('not_mentor'))
  })

  it('excludes blocked pairs in reverse direction', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const blockList = [
      { mentee_email: 'mentor@example.com', mentor_email: 'mentee@example.com' },
    ]
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], blockList)
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('blocked'))
  })

  it('excludes when max_capacity is 0', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ payload: { max_capacity: 0 } })
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('capacity_full'))
  })

  it('excludes when max_capacity is missing', () => {
    const mentee = makeMentee()
    const mentor = makeMentor({ payload: {} })
    const { eligible, filtered } = filterEligible(mentee, [mentor], [], [])
    assert.equal(eligible.length, 0)
    assert.ok(filtered[0].reasons.includes('capacity_full'))
  })
})

// ── Phase 2: Categorical Scoring ───────────────────────────────────

describe('Phase 2: scoreCategorical', () => {
  it('scores perfect overlap as 1.0', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A', 'B'], climate_areas: ['X', 'Y'], sectors: ['S'],
      w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A', 'B'], climate_areas: ['X', 'Y'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    approxEqual(result.combined, 1.0)
  })

  it('scores zero overlap as 0.0', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['B'], climate_areas: ['Y'], sectors: ['T'],
    }})
    const result = scoreCategorical(mentee, mentor)
    approxEqual(result.combined, 0.0)
  })

  it('applies weights correctly', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A'], climate_areas: ['X', 'Y'], sectors: ['S'],
      w_horiz: 5, w_vert: 1, w_sector: 2,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A', 'B', 'C'], climate_areas: ['X'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    // horizontal: jaccard(['A'], ['A','B','C']) = 1/3
    // vertical: jaccard(['X','Y'], ['X']) = 1/2
    // sector: jaccard(['S'], ['S']) = 1
    // combined: (5*(1/3) + 1*(1/2) + 2*1) / 8
    const expected = (5 / 3 + 0.5 + 2) / 8
    approxEqual(result.combined, expected)
  })

  it('records intersection details', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A', 'B', 'C'], climate_areas: ['X'], sectors: ['S'],
      w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['B', 'C', 'D'], climate_areas: ['X'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    assert.deepEqual(result.horizontal.intersection, ['B', 'C'])
    assert.deepEqual(result.vertical.intersection, ['X'])
  })

  it('handles empty arrays on both sides as 0', () => {
    const mentee = makeMentee({ payload: {
      career_areas: [], climate_areas: ['X'], sectors: ['S'],
      w_horiz: 5, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: [], climate_areas: ['X'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    // horizontal: 0 (both empty), vertical: 1, sector: 1
    // (5*0 + 1*1 + 1*1) / 7
    approxEqual(result.combined, 2 / 7)
  })

  it('handles missing payload fields gracefully', () => {
    const mentee = makeMentee({ payload: { w_horiz: 1, w_vert: 1, w_sector: 1 } })
    const mentor = makeMentor({ payload: {} })
    const result = scoreCategorical(mentee, mentor)
    approxEqual(result.combined, 0)
  })

  it('defaults weights to 1 when missing', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    approxEqual(result.combined, 1.0)
    assert.equal(result.horizontal.weight, 1)
  })

  it('handles all weights = 0 without division by zero', () => {
    const mentee = makeMentee({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      w_horiz: 0, w_vert: 0, w_sector: 0,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
    }})
    const result = scoreCategorical(mentee, mentor)
    approxEqual(result.combined, 0)
    assert.ok(Number.isFinite(result.combined))
  })
})

// ── Phase 3: Topic Alignment ───────────────────────────────────────

describe('Phase 3: scoreTopic', () => {
  it('scores all top_strengths matches as 1.0', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B', 'C'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['A', 'B', 'C'],
      general_topics: [],
    }})
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 1.0)
  })

  it('scores all general_topics matches as ~0.6', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B', 'C'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: [],
      general_topics: ['A', 'B', 'C'],
    }})
    const result = scoreTopic(mentee, mentor)
    // (0.6/1 + 0.6/2 + 0.6/3) / H(3) = (0.6 + 0.3 + 0.2) / 1.833
    approxEqual(result.combined, 0.6)
  })

  it('scores no matches as 0.0', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['X', 'Y'],
      general_topics: ['Z'],
    }})
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 0.0)
  })

  it('handles mixed matches with rank discounting', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B', 'C'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['A', 'C'],
      general_topics: ['B'],
    }})
    const result = scoreTopic(mentee, mentor)
    // T1 A: top_strengths, 1.0/1 = 1.0
    // T2 B: general, 0.6/2 = 0.3
    // T3 C: top_strengths, 1.0/3 = 0.333
    // raw = 1.633, H(3) = 1.833
    approxEqual(result.combined, 1.633 / 1.833)
    assert.equal(result.details[0].matched_in, 'top_strengths')
    assert.equal(result.details[1].matched_in, 'general_topics')
  })

  it('adapts to 5 topics', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B', 'C', 'D', 'E'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['A', 'B', 'C', 'D', 'E'],
      general_topics: [],
    }})
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 1.0)
    approxEqual(result.harmonic_n, 1 + 0.5 + 1/3 + 0.25 + 0.2)
  })

  it('adapts to 1 topic', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['A'],
      general_topics: [],
    }})
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 1.0)
    approxEqual(result.harmonic_n, 1.0)
  })

  it('handles empty topics as 0', () => {
    const mentee = makeMentee({ payload: { top_topics: [] } })
    const mentor = makeMentor()
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 0)
    assert.equal(result.details.length, 0)
  })

  it('handles missing top_topics as 0', () => {
    const mentee = makeMentee({ payload: {} })
    const mentor = makeMentor()
    const result = scoreTopic(mentee, mentor)
    approxEqual(result.combined, 0)
  })

  it('prefers top_strengths when topic is in both lists', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['Overlap Topic'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: ['Overlap Topic'],
      general_topics: ['Overlap Topic'],
    }})
    const result = scoreTopic(mentee, mentor)
    assert.equal(result.details[0].matched_in, 'top_strengths')
    assert.equal(result.details[0].score, 1.0)
  })

  it('falls back to general when no top_strengths', () => {
    const mentee = makeMentee({ payload: {
      top_topics: ['A', 'B'],
    }})
    const mentor = makeMentor({ payload: {
      top_strengths: [],
      general_topics: ['A', 'B'],
    }})
    const result = scoreTopic(mentee, mentor)
    assert.equal(result.details[0].matched_in, 'general_topics')
    assert.equal(result.details[1].matched_in, 'general_topics')
    approxEqual(result.combined, 0.6)
  })
})

// ── Phase 4: Semantic Embedding ────────────────────────────────────

describe('Phase 4: scoreSemantic', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 0, 0, 0]
    const result = scoreSemantic(v, v)
    approxEqual(result.cosine_similarity, 1.0)
  })

  it('returns 0.0 for orthogonal vectors', () => {
    const a = [1, 0, 0, 0]
    const b = [0, 1, 0, 0]
    const result = scoreSemantic(a, b)
    approxEqual(result.cosine_similarity, 0.0)
  })

  it('returns known cosine for 45-degree angle', () => {
    const a = [1, 0]
    const b = [1, 1]
    const result = scoreSemantic(a, b)
    approxEqual(result.cosine_similarity, Math.SQRT1_2) // ~0.7071
  })

  it('handles null mentee embedding', () => {
    const result = scoreSemantic(null, [1, 0])
    assert.equal(result.cosine_similarity, null)
    assert.equal(result.reason, 'no_embedding')
  })

  it('handles null mentor embedding', () => {
    const result = scoreSemantic([1, 0], null)
    assert.equal(result.cosine_similarity, null)
    assert.equal(result.reason, 'no_embedding')
  })

  it('handles both null', () => {
    const result = scoreSemantic(null, null)
    assert.equal(result.cosine_similarity, null)
  })

  it('handles zero vectors without division by zero', () => {
    const result = scoreSemantic([0, 0, 0], [0, 0, 0])
    assert.equal(result.cosine_similarity, 0)
    assert.ok(Number.isFinite(result.cosine_similarity))
  })

  it('handles opposite vectors (negative cosine)', () => {
    const a = [1, 0]
    const b = [-1, 0]
    const result = scoreSemantic(a, b)
    approxEqual(result.cosine_similarity, -1.0)
  })
})

// ── Phase 4b: Geographic Proximity ─────────────────────────────────

describe('Phase 4b: scoreGeo', () => {
  it('returns 0 with enabled=false when geo disabled', () => {
    const mentee = makeMentee({ payload: { geo_match_preference: false } })
    const mentor = makeMentor()
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.enabled, false)
    assert.equal(result.score, 0)
  })

  it('scores exact city match as 1.0', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'San Francisco, CA',
    }})
    const mentor = makeMentor({ payload: { location: 'San Francisco, CA' } })
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 1.0)
    assert.equal(result.reason, 'exact_city_match')
  })

  it('scores same region as 0.5', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'Oakland, CA',
    }})
    const mentor = makeMentor({ payload: { location: 'San Francisco, CA' } })
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 0.5)
    assert.equal(result.reason, 'same_region')
  })

  it('scores remote mentor as 0.25', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'New York, NY',
    }})
    const mentor = makeMentor({ payload: {
      location: 'San Francisco, CA',
      locations_open_to: ['San Francisco, CA', 'Remote'],
    }})
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 0.25)
    assert.equal(result.reason, 'mentor_open_to_remote')
  })

  it('scores different locations as 0', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'New York, NY',
    }})
    const mentor = makeMentor({ payload: {
      location: 'San Francisco, CA',
      locations_open_to: ['San Francisco, CA'],
    }})
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 0)
    assert.equal(result.reason, 'no_geo_match')
  })

  it('handles missing mentee location', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: '',
    }})
    const mentor = makeMentor()
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 0)
    assert.equal(result.reason, 'missing_location')
  })

  it('is case-insensitive', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'san francisco, ca',
    }})
    const mentor = makeMentor({ payload: { location: 'San Francisco, CA' } })
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 1.0)
  })

  it('handles missing mentor location', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: true, location: 'San Francisco, CA',
    }})
    const mentor = makeMentor({ payload: { location: '' } })
    const result = scoreGeo(mentee, mentor)
    assert.equal(result.score, 0)
    assert.equal(result.reason, 'missing_location')
  })
})

// ── Phase 5: Final Score Synthesis ─────────────────────────────────

describe('Phase 5: computeMatch', () => {
  it('uses geo weights when geo enabled', () => {
    const mentee = makeMentee({ payload: { geo_match_preference: true, location: 'SF, CA' } })
    const mentor = makeMentor({ payload: { location: 'SF, CA' } })
    const result = computeMatch(mentee, mentor)
    assert.equal(result.scores.weights_used.categorical, 0.40)
    assert.equal(result.scores.weights_used.topic, 0.30)
    assert.equal(result.scores.weights_used.geo, 0.15)
  })

  it('uses non-geo weights when geo disabled', () => {
    const mentee = makeMentee({ payload: { geo_match_preference: false } })
    const mentor = makeMentor()
    const result = computeMatch(mentee, mentor)
    assert.equal(result.scores.weights_used.categorical, 0.45)
    assert.equal(result.scores.weights_used.topic, 0.35)
    assert.equal(result.scores.weights_used.geo, null)
  })

  it('final score is weighted sum', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: false,
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_topics: ['T1'],
      w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_strengths: ['T1'], general_topics: [],
    }})
    // categorical = 1.0, topic = 1.0, semantic = 0 (null)
    // 0.45 * 1.0 + 0.35 * 1.0 + 0.20 * 0 = 0.80
    const result = computeMatch(mentee, mentor)
    approxEqual(result.scores.final, 0.80)
  })

  it('includes snapshots with all profile data', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const result = computeMatch(mentee, mentor)
    assert.equal(result.mentee_snapshot.email, 'mentee@example.com')
    assert.deepEqual(result.mentee_snapshot.career_areas, mentee.payload.career_areas)
    assert.equal(result.mentor_snapshot.email, 'mentor@example.com')
    assert.deepEqual(result.mentor_snapshot.top_strengths, mentor.payload.top_strengths)
  })

  it('null embedding scores as 0 and is noted in weights', () => {
    const mentee = makeMentee({ payload: { geo_match_preference: false } })
    const mentor = makeMentor()
    const result = computeMatch(mentee, mentor)
    assert.equal(result.scores.semantic.cosine_similarity, null)
    assert.ok(String(result.scores.weights_used.semantic).includes('no data'))
  })

  it('passes algorithm_version through', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const result = computeMatch(mentee, mentor, { algorithm_version: 'abc123' })
    assert.equal(result.algorithm_version, 'abc123')
  })

  it('passes prior_matches through', () => {
    const mentee = makeMentee()
    const mentor = makeMentor()
    const prior = [{ match_id: 'old', status: 'REJECTED' }]
    const result = computeMatch(mentee, mentor, { prior_matches: prior })
    assert.deepEqual(result.prior_matches, prior)
  })

  it('applies reliability_multiplier to final score', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: false,
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_topics: ['T1'], w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_strengths: ['T1'], general_topics: [],
    }})
    const full = computeMatch(mentee, mentor)
    const discounted = computeMatch(mentee, mentor, { reliability_multiplier: 0.8 })
    approxEqual(discounted.scores.final, full.scores.final * 0.8)
    assert.equal(discounted.scores.reliability_multiplier, 0.8)
  })

  it('embeddings contribute to final score when present', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: false,
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_topics: ['T1'], w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentor = makeMentor({ payload: {
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_strengths: ['T1'], general_topics: [],
    }})
    const withoutEmb = computeMatch(mentee, mentor)
    const withEmb = computeMatch(mentee, mentor, {
      menteeEmbedding: [1, 0, 0],
      mentorEmbedding: [1, 0, 0],
    })
    // semantic = 1.0 with weight 0.20 → should add 0.20 to score
    assert.ok(withEmb.scores.final > withoutEmb.scores.final)
    approxEqual(withEmb.scores.final - withoutEmb.scores.final, 0.20)
    assert.equal(withEmb.scores.semantic.cosine_similarity, 1.0)
  })
})

// ── Orchestrator ───────────────────────────────────────────────────

describe('rankMentors', () => {
  it('ranks mentors by final score descending', () => {
    const mentee = makeMentee({ payload: {
      geo_match_preference: false,
      career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
      top_topics: ['T1'], w_horiz: 1, w_vert: 1, w_sector: 1,
    }})
    const mentorHigh = makeMentor({
      email: 'high@example.com',
      payload: {
        career_areas: ['A'], climate_areas: ['X'], sectors: ['S'],
        top_strengths: ['T1'], general_topics: [], max_capacity: 5,
      },
    })
    const mentorLow = makeMentor({
      email: 'low@example.com',
      payload: {
        career_areas: ['Z'], climate_areas: ['Z'], sectors: ['Z'],
        top_strengths: ['Z'], general_topics: [], max_capacity: 5,
      },
    })
    const { results } = rankMentors(mentee, [mentorLow, mentorHigh], [], [])
    assert.equal(results[0].mentor_snapshot.email, 'high@example.com')
    assert.equal(results[0].rank, 1)
    assert.equal(results[1].rank, 2)
  })

  it('returns empty results when no mentors are eligible', () => {
    const mentee = makeMentee()
    const { results, filtered } = rankMentors(mentee, [], [], [])
    assert.equal(results.length, 0)
    assert.equal(filtered.length, 0)
  })

  it('returns filtered reasons for excluded mentors', () => {
    const mentee = makeMentee()
    const self = makeMentor({ email: 'mentee@example.com' })
    const { results, filtered } = rankMentors(mentee, [self], [], [])
    assert.equal(results.length, 0)
    assert.equal(filtered.length, 1)
    assert.ok(filtered[0].reasons.includes('self_match'))
  })
})

// ── Integration: Sample Profile Scenarios ──────────────────────────

describe('Integration: sample profiles', () => {
  const alex = {
    email: 'mentor1@example.com', name: 'Alex Chen', role: 'mentor',
    payload: {
      career_areas: ['Engineering', 'Operations', 'Strategy'],
      climate_areas: ['Energy', 'Built Environment'],
      sectors: ['Private'],
      top_strengths: ['Translating non-climate experience', 'Developing leadership',
                      'Networking', 'VPP architecture', 'Team building'],
      general_topics: ['Job search strategy', 'Interview prep'],
      motivation: 'Helped 20+ engineers transition into climate tech.',
      max_capacity: 2,
      location: 'San Francisco, CA',
      locations_open_to: ['San Francisco, CA', 'Remote'],
    },
    embedding: null,
  }

  const priya = {
    email: 'mentor2@example.com', name: 'Priya Sharma', role: 'mentor',
    payload: {
      career_areas: ['Strategy', 'Nonprofit Management'],
      climate_areas: ['Climate Policy', 'Climate Finance & Carbon Markets'],
      sectors: ['Nonprofit', 'Government'],
      top_strengths: ['Navigating career transition', 'International work',
                      'Policy advocacy', 'Climate finance structuring', 'Stakeholder engagement'],
      general_topics: ['Climate Policy', 'Public speaking'],
      motivation: '15 years shaping global climate policy.',
      max_capacity: 3,
      location: 'Washington, DC',
      locations_open_to: ['Washington, DC', 'Geneva', 'Remote'],
    },
    embedding: null,
  }

  const jane = {
    email: 'mentee1@example.com', name: 'Jane Doe', role: 'mentee',
    payload: {
      career_areas: ['Engineering', 'IT'],
      climate_areas: ['Energy', 'Transportation'],
      sectors: ['Private'],
      top_topics: ['Translating non-climate experience', 'Job search strategy', 'Networking'],
      statement_of_intent: '6 years building high-throughput distributed ledger systems.',
      location: 'San Francisco, CA',
      geo_match_preference: true,
      w_horiz: 5, w_vert: 1, w_sector: 2,
    },
    embedding: null,
  }

  const marcus = {
    email: 'mentee2@example.com', name: 'Marcus Rivera', role: 'mentee',
    payload: {
      career_areas: ['Consulting', 'Strategy'],
      climate_areas: ['Climate Policy', 'Climate Finance'],
      sectors: ['Nonprofit', 'Government'],
      top_topics: ['Navigating career transition', 'International work', 'Climate Policy'],
      statement_of_intent: '4 years as a policy analyst at a DC think tank.',
      location: 'Washington, DC',
      geo_match_preference: true,
      w_horiz: 2, w_vert: 5, w_sector: 3,
    },
    embedding: null,
  }

  it('Jane matches Alex better than Priya', () => {
    const { results } = rankMentors(jane, [alex, priya], [], [])
    assert.equal(results.length, 2)
    assert.equal(results[0].mentor_snapshot.email, 'mentor1@example.com')
    assert.ok(results[0].scores.final > results[1].scores.final)
  })

  it('Marcus matches Priya better than Alex', () => {
    const { results } = rankMentors(marcus, [alex, priya], [], [])
    assert.equal(results.length, 2)
    assert.equal(results[0].mentor_snapshot.email, 'mentor2@example.com')
    assert.ok(results[0].scores.final > results[1].scores.final)
  })

  it('Jane→Alex categorical shows Engineering overlap', () => {
    const result = computeMatch(jane, alex)
    assert.ok(result.scores.categorical.horizontal.intersection.includes('Engineering'))
    assert.ok(result.scores.categorical.vertical.intersection.includes('Energy'))
    assert.deepEqual(result.scores.categorical.sector.intersection, ['Private'])
  })

  it('Jane→Alex topic shows top_strengths and general matches', () => {
    const result = computeMatch(jane, alex)
    const details = result.scores.topic.details
    assert.equal(details[0].topic, 'Translating non-climate experience')
    assert.equal(details[0].matched_in, 'top_strengths')
    assert.equal(details[1].topic, 'Job search strategy')
    assert.equal(details[1].matched_in, 'general_topics')
    assert.equal(details[2].topic, 'Networking')
    assert.equal(details[2].matched_in, 'top_strengths')
  })

  it('Jane→Alex geo is exact city match', () => {
    const result = computeMatch(jane, alex)
    assert.equal(result.scores.geo.score, 1.0)
    assert.equal(result.scores.geo.reason, 'exact_city_match')
  })

  it('Marcus→Priya geo is exact city match (DC)', () => {
    const result = computeMatch(marcus, priya)
    assert.equal(result.scores.geo.score, 1.0)
    assert.equal(result.scores.geo.reason, 'exact_city_match')
  })
})
