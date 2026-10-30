import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FIELDS, normalize, normalizeArray, label, hasExperience } from './field-registry.js'

// ── normalize ─────────────────────────────────────────────────────

describe('normalize', () => {
  it('returns ID when given the display label', () => {
    assert.equal(normalize('management_experience', 'I have managed teams (5+) of direct reports.'), 'managed_5plus')
  })

  it('is case-insensitive', () => {
    assert.equal(normalize('management_experience', 'i have managed teams (5+) of direct reports.'), 'managed_5plus')
  })

  it('trims whitespace', () => {
    assert.equal(normalize('business_experience', '  Yes, I have started my own business.  '), 'started_own')
  })

  it('passes through a value that is already an ID', () => {
    assert.equal(normalize('management_experience', 'managed_5plus'), 'managed_5plus')
  })

  it('returns unknown marker for unrecognized value', () => {
    const result = normalize('management_experience', 'Some new wording they changed on the form')
    assert.equal(result.unknown, true)
    assert.equal(result.field, 'management_experience')
    assert.equal(result.value, 'Some new wording they changed on the form')
  })

  it('returns null for empty/falsy input', () => {
    assert.equal(normalize('career_level', ''), null)
    assert.equal(normalize('career_level', null), null)
    assert.equal(normalize('career_level', undefined), null)
  })

  it('returns raw value when field is not in registry', () => {
    assert.equal(normalize('unknown_field', 'whatever'), 'whatever')
  })

  it('normalizes each enum field correctly', () => {
    assert.equal(normalize('education_level', 'Doctorate'), 'doctorate')
    assert.equal(normalize('career_level', 'Director / Executive'), 'director')
    assert.equal(normalize('international_experience', 'Yes, I have worked in multiple countries.'), 'multi_country')
    assert.equal(normalize('nonprofit_board_experience', 'Yes.'), 'yes')
    assert.equal(normalize('employment_situation', 'Full time student.'), 'student')
    assert.equal(normalize('years_experience', '15+'), '15_plus')
  })

  it('normalizes climate_areas display labels', () => {
    assert.equal(normalize('climate_areas', 'AI in Climate'), 'ai_climate')
    assert.equal(normalize('climate_areas', 'Climate Finance & Carbon Markets'), 'climate_finance')
  })

  it('normalizes career_areas display labels', () => {
    assert.equal(normalize('career_areas', 'Business Development'), 'biz_dev')
    assert.equal(normalize('career_areas', 'Data Science'), 'data_science')
  })

  it('normalizes topics display labels', () => {
    assert.equal(normalize('topics', 'Learning about / getting into international work'), 'international_work')
    assert.equal(normalize('topics', 'Developing leadership or management skills'), 'leadership_skills')
    assert.equal(normalize('topics', 'Serving on a nonprofit board'), 'nonprofit_board')
  })
})

// ── normalizeArray ────────────────────────────────────────────────

describe('normalizeArray', () => {
  it('normalizes all values in array', () => {
    const { values, warnings } = normalizeArray('career_areas', ['Engineering', 'Consulting'])
    assert.deepEqual(values, ['engineering', 'consulting'])
    assert.equal(warnings.length, 0)
  })

  it('passes through values already as IDs', () => {
    const { values, warnings } = normalizeArray('career_areas', ['engineering', 'consulting'])
    assert.deepEqual(values, ['engineering', 'consulting'])
    assert.equal(warnings.length, 0)
  })

  it('collects warnings for unknown values', () => {
    const { values, warnings } = normalizeArray('career_areas', ['Engineering', 'Underwater Basket Weaving'])
    assert.deepEqual(values, ['engineering'])
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].value, 'Underwater Basket Weaving')
  })

  it('returns empty for null/empty input', () => {
    assert.deepEqual(normalizeArray('career_areas', null), [])
    assert.deepEqual(normalizeArray('career_areas', []), [])
  })

  it('handles mixed IDs and display labels', () => {
    const { values } = normalizeArray('climate_areas', ['energy', 'AI in Climate', 'transportation'])
    assert.deepEqual(values, ['energy', 'ai_climate', 'transportation'])
  })
})

// ── label ─────────────────────────────────────────────────────────

describe('label', () => {
  it('returns display label for known ID', () => {
    assert.equal(label('career_level', 'director'), 'Director / Executive')
    assert.equal(label('education_level', 'masters'), 'Masters')
  })

  it('returns ID as-is for unknown ID', () => {
    assert.equal(label('career_level', 'unknown_level'), 'unknown_level')
  })

  it('returns ID as-is for unknown field', () => {
    assert.equal(label('nonexistent_field', 'foo'), 'foo')
  })
})

// ── hasExperience ─────────────────────────────────────────────────

describe('hasExperience', () => {
  it('returns true for real experience values', () => {
    assert.equal(hasExperience('managed_5plus'), true)
    assert.equal(hasExperience('lived_abroad'), true)
    assert.equal(hasExperience('started_own'), true)
    assert.equal(hasExperience('yes'), true)
    assert.equal(hasExperience('managed_few'), true)
  })

  it('returns false for none', () => {
    assert.equal(hasExperience('none'), false)
  })

  it('returns false for no', () => {
    assert.equal(hasExperience('no'), false)
  })

  it('returns false for null/undefined', () => {
    assert.equal(hasExperience(null), false)
    assert.equal(hasExperience(undefined), false)
  })
})

// ── FIELDS integrity ──────────────────────────────────────────────

describe('FIELDS integrity', () => {
  it('every field has at least 2 options', () => {
    for (const [field, entries] of Object.entries(FIELDS)) {
      const count = Object.keys(entries).length
      assert.ok(count >= 2, `${field} has only ${count} option(s)`)
    }
  })

  it('no duplicate IDs within a field', () => {
    for (const [field, entries] of Object.entries(FIELDS)) {
      const ids = Object.keys(entries)
      const unique = new Set(ids)
      assert.equal(ids.length, unique.size, `${field} has duplicate IDs`)
    }
  })

  it('no duplicate display labels within a field (case-insensitive)', () => {
    for (const [field, entries] of Object.entries(FIELDS)) {
      const labels = Object.values(entries).map(l => l.toLowerCase().trim())
      const unique = new Set(labels)
      assert.equal(labels.length, unique.size, `${field} has duplicate display labels`)
    }
  })

  it('all expected fields are present', () => {
    const expected = [
      'education_level', 'years_experience', 'years_climate_experience', 'career_level',
      'sectors', 'climate_areas', 'career_areas', 'topics',
      'management_experience', 'business_experience', 'international_experience',
      'nonprofit_board_experience', 'employment_situation',
    ]
    for (const f of expected) {
      assert.ok(FIELDS[f], `Missing field: ${f}`)
    }
  })
})
