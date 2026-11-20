import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { _testGetSent, _testClear, notifyMatchActive, notifyMenteeMatchesReady } from './email.js'

// ── Admin note in notifyMenteeMatchesReady ───────────────────────

describe('notifyMenteeMatchesReady: admin note', () => {
  beforeEach(() => _testClear())

  it('includes italicized note when note is provided', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2, { note: 'Strong overlap in renewable energy' })

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.ok(sent[0].html.includes('font-style: italic'), 'note should be italicized')
    assert.ok(sent[0].html.includes('Strong overlap in renewable energy'), 'note text should appear')
    assert.ok(sent[0].html.includes('Note from the Connected in Climate team:'), 'label should appear')
  })

  it('omits note section when note is empty string', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2, { note: '' })

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.ok(!sent[0].html.includes('font-style: italic'), 'no italic block for empty note')
  })

  it('omits note section when note is whitespace-only', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2, { note: '   ' })

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.ok(!sent[0].html.includes('font-style: italic'), 'no italic block for whitespace note')
  })

  it('omits note section when options object is omitted', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2)

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.ok(!sent[0].html.includes('font-style: italic'), 'no italic block when no options')
  })

  it('omits note section when note key is undefined', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2, {})

    const sent = _testGetSent()
    assert.equal(sent.length, 1)
    assert.ok(!sent[0].html.includes('font-style: italic'), 'no italic block when note is undefined')
  })

  it('escapes HTML in the note', () => {
    notifyMenteeMatchesReady('mentee@test.com', 'Mentee', 2, { note: '<script>alert("xss")</script> & "quotes"' })

    const sent = _testGetSent()
    assert.ok(!sent[0].html.includes('<script>'), 'raw script tag must not appear')
    assert.ok(sent[0].html.includes('&lt;script&gt;'), 'script tag should be escaped')
    assert.ok(sent[0].html.includes('font-style: italic'))
  })
})

// ── Admin note in notifyMatchActive ──────────────────────────────

describe('notifyMatchActive: admin note', () => {
  beforeEach(() => _testClear())

  it('includes italicized note only in mentee email', () => {
    notifyMatchActive('mentor@test.com', 'Mentor', 'mentee@test.com', 'Mentee', { note: 'Great fit for your goals' })

    const sent = _testGetSent()
    assert.equal(sent.length, 2)

    const menteeEmail = sent.find(s => s.to === 'mentee@test.com')
    assert.ok(menteeEmail.html.includes('font-style: italic'), 'mentee email should have italic note')
    assert.ok(menteeEmail.html.includes('Great fit for your goals'), 'note text in mentee email')
    assert.ok(menteeEmail.html.includes('Note from the Connected in Climate team:'), 'label in mentee email')

    const mentorEmail = sent.find(s => s.to === 'mentor@test.com')
    assert.ok(!mentorEmail.html.includes('Great fit for your goals'), 'mentor email should NOT contain note')
    assert.ok(!mentorEmail.html.includes('font-style: italic'), 'mentor email should NOT have italic block')
  })

  it('omits note section from mentee email when note is empty', () => {
    notifyMatchActive('mentor@test.com', 'Mentor', 'mentee@test.com', 'Mentee', { note: '' })

    const sent = _testGetSent()
    const menteeEmail = sent.find(s => s.to === 'mentee@test.com')
    assert.ok(!menteeEmail.html.includes('font-style: italic'))
  })

  it('omits note section when options object is omitted', () => {
    notifyMatchActive('mentor@test.com', 'Mentor', 'mentee@test.com', 'Mentee')

    const sent = _testGetSent()
    const menteeEmail = sent.find(s => s.to === 'mentee@test.com')
    assert.ok(!menteeEmail.html.includes('font-style: italic'))
  })

  it('escapes HTML in the note', () => {
    notifyMatchActive('mentor@test.com', 'Mentor', 'mentee@test.com', 'Mentee', { note: '<img src=x onerror=alert(1)>' })

    const sent = _testGetSent()
    const menteeEmail = sent.find(s => s.to === 'mentee@test.com')
    assert.ok(!menteeEmail.html.includes('<img'), 'raw img tag must not appear')
    assert.ok(menteeEmail.html.includes('&lt;img'), 'img tag should be escaped')
  })
})
