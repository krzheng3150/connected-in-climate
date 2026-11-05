import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { LABELS } from './ProfileFields.jsx'

const ROLE_OPTIONS = [
  { id: 'mentee', label: 'Mentee', desc: 'I\'m looking for a mentor in climate.' },
  { id: 'mentor', label: 'Mentor', desc: 'I want to mentor someone in climate.' },
]

const SHARED_SINGLE = [
  { key: 'career_level', label: 'Career Level', required: true },
  { key: 'education_level', label: 'Education Level' },
  { key: 'years_experience', label: 'Years of Experience' },
  { key: 'years_climate_experience', label: 'Years in Climate' },
]

const MENTOR_SINGLE = [
  { key: 'management_experience', label: 'Management Experience' },
  { key: 'business_experience', label: 'Business Experience' },
  { key: 'international_experience', label: 'International Experience' },
  { key: 'nonprofit_board_experience', label: 'Nonprofit Board Experience' },
]

const MENTEE_SINGLE = [
  { key: 'employment_situation', label: 'Employment Situation' },
]

const MULTI_SELECT = [
  { key: 'climate_areas', label: 'Climate Areas of Interest' },
  { key: 'career_areas', label: 'Career Areas' },
  { key: 'sectors', label: 'Sectors' },
]

const TOPIC_FIELDS_MENTOR = [
  { key: 'top_strengths', label: 'Topics You Can Mentor On (pick your top 3–5)' },
  { key: 'general_topics', label: 'Other Topics You\'re Comfortable With' },
]

const TOPIC_FIELDS_MENTEE = [
  { key: 'top_topics', label: 'Topics You Want Help With (pick your top 3–5)' },
]

function isMentor(role) { return role === 'mentor' || role === 'both' }
function isMentee(role) { return role === 'mentee' || role === 'both' }

function SelectField({ field, value, onChange }) {
  const options = LABELS[field.key]
  if (!options) return null
  return (
    <div className="form-group">
      <label>{field.label}{field.required && ' *'}</label>
      <select value={value || ''} onChange={e => onChange(field.key, e.target.value || null)}>
        <option value="">Select…</option>
        {Object.entries(options).map(([id, lbl]) => (
          <option key={id} value={id}>{lbl}</option>
        ))}
      </select>
    </div>
  )
}

function MultiSelectField({ field, value = [], onChange }) {
  const lookupKey = field.key === 'top_strengths' || field.key === 'general_topics' || field.key === 'top_topics'
    ? 'topics' : field.key
  const options = LABELS[lookupKey]
  if (!options) return null

  function toggle(id) {
    const next = value.includes(id) ? value.filter(v => v !== id) : [...value, id]
    onChange(field.key, next)
  }

  return (
    <div className="form-group">
      <label>{field.label}</label>
      <div className="checkbox-grid">
        {Object.entries(options).map(([id, lbl]) => (
          <label key={id} className="checkbox-option">
            <input type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} />
            <span>{lbl}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export default function ApplicationForm({ existingProfile, onCancel }) {
  const isEdit = Boolean(existingProfile)
  const { user, refreshProfile } = useAuth()
  const [step, setStep] = useState(isEdit ? 1 : 0)
  const [form, setForm] = useState(() => {
    if (!existingProfile) return { role: null, name: '' }
    const { name, role, payload = {} } = existingProfile
    return { role, name, ...payload }
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      const res = await fetch('/api/profiles', {
        method: isEdit ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.errors?.join(' ') || data.error || 'Something went wrong.')
        return
      }
      await refreshProfile()
      if (isEdit && onCancel) onCancel()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 0: Role ──
  if (step === 0) {
    return (
      <div className="application-form">
        <h2>Apply to Connected in Climate</h2>
        <p>Select how you'd like to participate:</p>
        <div className="role-select">
          {ROLE_OPTIONS.map(r => (
            <button
              key={r.id}
              className={`role-option ${form.role === r.id ? 'selected' : ''}`}
              onClick={() => set('role', r.id)}
            >
              <strong>{r.label}</strong>
              <span>{r.desc}</span>
            </button>
          ))}
        </div>
        <div className="form-actions">
          <button className="btn-primary" disabled={!form.role} onClick={() => setStep(1)}>
            Next
          </button>
        </div>
      </div>
    )
  }

  // ── Step 1: Basic info + selects ──
  if (step === 1) {
    const singleFields = [
      ...SHARED_SINGLE,
      ...(isMentor(form.role) ? MENTOR_SINGLE : []),
      ...(isMentee(form.role) ? MENTEE_SINGLE : []),
    ]
    return (
      <div className="application-form">
        <h2>Your Background</h2>
        <div className="form-group">
          <label>Full Name *</label>
          <input type="text" value={form.name || ''} onChange={e => set('name', e.target.value)} placeholder="Your full name" />
        </div>
        <div className="form-group">
          <label>Preferred Name</label>
          <input type="text" value={form.preferred_name || ''} onChange={e => set('preferred_name', e.target.value)} placeholder="What should we call you?" />
        </div>
        <div className="form-group">
          <label>Pronouns</label>
          <input type="text" value={form.pronouns || ''} onChange={e => set('pronouns', e.target.value)} placeholder="e.g. she/her, he/him, they/them" />
        </div>
        <div className="form-group">
          <label>Organization</label>
          <input type="text" value={form.organization || ''} onChange={e => set('organization', e.target.value)} placeholder="Where do you work?" />
        </div>
        <div className="form-group">
          <label>Location</label>
          <input type="text" value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="City, Country" />
        </div>
        {singleFields.map(f => (
          <SelectField key={f.key} field={f} value={form[f.key]} onChange={set} />
        ))}
        <div className="form-actions">
          {isEdit
            ? <button className="btn-secondary" onClick={onCancel}>Cancel</button>
            : <button className="btn-secondary" onClick={() => setStep(0)}>Back</button>}
          <button className="btn-primary" disabled={!form.name?.trim() || !form.career_level} onClick={() => setStep(2)}>Next</button>
        </div>
      </div>
    )
  }

  // ── Step 2: Multi-selects (areas, topics) ──
  if (step === 2) {
    const topicFields = isMentor(form.role) ? TOPIC_FIELDS_MENTOR : []
    const menteeTopics = isMentee(form.role) ? TOPIC_FIELDS_MENTEE : []
    return (
      <div className="application-form">
        <h2>Your Interests</h2>
        {MULTI_SELECT.map(f => (
          <MultiSelectField key={f.key} field={f} value={form[f.key] || []} onChange={set} />
        ))}
        {[...topicFields, ...menteeTopics].map(f => (
          <MultiSelectField key={f.key} field={f} value={form[f.key] || []} onChange={set} />
        ))}
        <div className="form-actions">
          <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
          <button className="btn-primary" onClick={() => setStep(3)}>Next</button>
        </div>
      </div>
    )
  }

  // ── Step 3: Free text + links + submit ──
  return (
    <div className="application-form">
      <h2>Tell Us More</h2>
      {isMentee(form.role) && (
        <div className="form-group">
          <label>Statement of Intent *</label>
          <textarea
            rows={4}
            value={form.statement_of_intent || ''}
            onChange={e => set('statement_of_intent', e.target.value)}
            placeholder="What are you hoping to get out of this mentorship? What are your goals?"
          />
        </div>
      )}
      {isMentor(form.role) && (
        <div className="form-group">
          <label>Motivation *</label>
          <textarea
            rows={4}
            value={form.motivation || ''}
            onChange={e => set('motivation', e.target.value)}
            placeholder="Why do you want to mentor? What experience and perspective do you bring?"
          />
        </div>
      )}
      <div className="form-group">
        <label>Fun Fact</label>
        <input type="text" value={form.fun_fact || ''} onChange={e => set('fun_fact', e.target.value)} placeholder="Something interesting about you" />
      </div>
      <div className="form-group">
        <label>LinkedIn URL</label>
        <input type="url" value={form.links?.linkedin || ''} onChange={e => set('links', { ...form.links, linkedin: e.target.value })} placeholder="https://linkedin.com/in/..." />
      </div>
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
        <button className="btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Submit Application'}
        </button>
      </div>
    </div>
  )
}
