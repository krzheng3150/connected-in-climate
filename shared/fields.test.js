import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHARED_PAYLOAD_FIELDS, MENTOR_PAYLOAD_FIELDS, MENTEE_PAYLOAD_FIELDS, ORGANIZER_FIELDS,
} from './fields.js'

describe('shared field sets', () => {
  it('mentor and shared sets do not overlap', () => {
    const overlap = [...MENTOR_PAYLOAD_FIELDS].filter(f => SHARED_PAYLOAD_FIELDS.has(f))
    assert.deepEqual(overlap, [], `unexpected overlap: ${overlap}`)
  })

  it('mentee and shared sets do not overlap', () => {
    const overlap = [...MENTEE_PAYLOAD_FIELDS].filter(f => SHARED_PAYLOAD_FIELDS.has(f))
    assert.deepEqual(overlap, [], `unexpected overlap: ${overlap}`)
  })

  it('mentor and mentee only overlap on commitment_name', () => {
    const overlap = [...MENTOR_PAYLOAD_FIELDS].filter(f => MENTEE_PAYLOAD_FIELDS.has(f))
    assert.deepEqual(overlap, ['commitment_name'])
  })

  it('organizer fields are not in any role set', () => {
    for (const f of ORGANIZER_FIELDS) {
      const inRole = MENTOR_PAYLOAD_FIELDS.has(f) || MENTEE_PAYLOAD_FIELDS.has(f)
      assert.equal(inRole, false, `${f} should not be in a role-specific set`)
    }
  })

  it('all sets are non-empty', () => {
    assert.ok(SHARED_PAYLOAD_FIELDS.size > 0)
    assert.ok(MENTOR_PAYLOAD_FIELDS.size > 0)
    assert.ok(MENTEE_PAYLOAD_FIELDS.size > 0)
    assert.ok(ORGANIZER_FIELDS.size > 0)
  })
})
