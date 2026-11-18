import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stepComplete } from './form-validation.js'

// ── Step 0: role selection ──

describe('step 0 — role', () => {
  it('incomplete without role', () => {
    assert.equal(stepComplete(0, {}, {}), false)
  })
  it('incomplete with null role', () => {
    assert.equal(stepComplete(0, { role: null }, {}), false)
  })
  it('complete with role', () => {
    assert.equal(stepComplete(0, { role: 'mentee' }, {}), true)
  })
})

// ── Step 1: basic info ──

describe('step 1 — first app', () => {
  const opts = { isSecondApp: false }
  const full = { name: 'Alice', career_level: 'mid', city: 'Boston', country: 'US' }

  it('complete with all required fields', () => {
    assert.equal(stepComplete(1, full, opts), true)
  })
  it('incomplete without name', () => {
    assert.equal(stepComplete(1, { ...full, name: '' }, opts), false)
  })
  it('incomplete with whitespace-only name', () => {
    assert.equal(stepComplete(1, { ...full, name: '   ' }, opts), false)
  })
  it('incomplete without career_level', () => {
    assert.equal(stepComplete(1, { ...full, career_level: null }, opts), false)
  })
  it('incomplete without city', () => {
    assert.equal(stepComplete(1, { ...full, city: '' }, opts), false)
  })
  it('incomplete without country', () => {
    assert.equal(stepComplete(1, { ...full, country: null }, opts), false)
  })
})

describe('step 1 — second app', () => {
  const opts = { isSecondApp: true }

  it('complete with just career_level', () => {
    assert.equal(stepComplete(1, { career_level: 'mid' }, opts), true)
  })
  it('incomplete without career_level', () => {
    assert.equal(stepComplete(1, {}, opts), false)
  })
  it('does not require name/city/country', () => {
    assert.equal(stepComplete(1, { career_level: 'mid' }, opts), true)
  })
})

// ── Step 2: multi-selects ──

describe('step 2 — areas', () => {
  it('complete with both arrays populated', () => {
    assert.equal(stepComplete(2, { climate_areas: ['a'], career_areas: ['b'] }, {}), true)
  })
  it('incomplete with empty climate_areas', () => {
    assert.equal(stepComplete(2, { climate_areas: [], career_areas: ['b'] }, {}), false)
  })
  it('incomplete with missing career_areas', () => {
    assert.equal(stepComplete(2, { climate_areas: ['a'] }, {}), false)
  })
  it('incomplete with both missing', () => {
    assert.equal(stepComplete(2, {}, {}), false)
  })
})

// ── Step 3: free text + commitment ──

describe('step 3 — mentor', () => {
  const opts = { isMentor: true, isMentee: false }

  it('complete with motivation and commitment_name', () => {
    assert.equal(stepComplete(3, { motivation: 'I care', commitment_name: 'Alice' }, opts), true)
  })
  it('incomplete without motivation', () => {
    assert.equal(stepComplete(3, { motivation: '', commitment_name: 'Alice' }, opts), false)
  })
  it('incomplete with whitespace-only motivation', () => {
    assert.equal(stepComplete(3, { motivation: '  ', commitment_name: 'Alice' }, opts), false)
  })
  it('incomplete without commitment_name', () => {
    assert.equal(stepComplete(3, { motivation: 'I care', commitment_name: '' }, opts), false)
  })
})

describe('step 3 — mentee', () => {
  const opts = { isMentor: false, isMentee: true }

  it('complete with statement_of_intent and commitment_name', () => {
    assert.equal(stepComplete(3, { statement_of_intent: 'Switch careers', commitment_name: 'Bob' }, opts), true)
  })
  it('incomplete without statement_of_intent', () => {
    assert.equal(stepComplete(3, { statement_of_intent: '', commitment_name: 'Bob' }, opts), false)
  })
  it('incomplete without commitment_name', () => {
    assert.equal(stepComplete(3, { statement_of_intent: 'Switch careers' }, opts), false)
  })
})
