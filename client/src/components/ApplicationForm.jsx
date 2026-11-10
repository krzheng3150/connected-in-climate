import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { LABELS } from './ProfileFields.jsx'
import HowItWorksPanel from './HowItWorksPanel.jsx'

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
  { key: 'freelance_experience', label: 'Freelance Experience' },
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
  { key: 'top_strengths', label: 'Pick the top 3–5 topics you can mentor on' },
  { key: 'general_topics', label: 'Other Topics You\'re Comfortable With' },
]

const TOPIC_FIELDS_MENTEE = [
  { key: 'top_topics', label: 'Pick the top 3–5 Topics You Want Help With' },
]

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

// forRole: when adding a second application, the role is pre-set
// existingProfile: when editing an existing application
export default function ApplicationForm({ existingProfile, forRole, onCancel }) {
  const isEdit = Boolean(existingProfile)
  const isSecondApp = Boolean(forRole)
  const { user, refreshProfile } = useAuth()
  const skipRoleStep = isEdit || isSecondApp
  const [step, setStep] = useState(skipRoleStep ? 1 : 0)
  const [form, setForm] = useState(() => {
    if (existingProfile) {
      const { name, role, payload = {} } = existingProfile
      return { role, name, ...payload }
    }
    if (forRole) {
      return { role: forRole, name: user?.name || '' }
    }
    return { role: null, name: '' }
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [hiwOpen, setHiwOpen] = useState(false)

  const isMentor = form.role === 'mentor'
  const isMentee = form.role === 'mentee'

  const STEP_FIELDS = {
    0: ['role'],
    1: ['name', 'career_level'],
    2: ['climate_areas', 'career_areas'],
    3: ['statement_of_intent', 'motivation'],
  }

  function errorsForStep(s) {
    const fields = STEP_FIELDS[s] || []
    return fields.filter(f => fieldErrors[f]).map(f => fieldErrors[f])
  }

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      const headers = { 'Content-Type': 'application/json' }
      const res = await fetch('/api/profiles', {
        method: isEdit ? 'PATCH' : 'POST',
        headers,
        body: JSON.stringify(form),
      })
      let data
      try {
        data = await res.json()
      } catch (parseErr) {
        console.error('[ApplicationForm] Non-JSON response:', res.status, parseErr)
        setError(`Server error (${res.status}) — please try again.`)
        return
      }
      if (!res.ok) {
        if (Array.isArray(data.errors) && data.errors[0]?.field) {
          const byField = {}
          for (const e of data.errors) byField[e.field] = e.message
          setFieldErrors(byField)
          const allSteps = [0, 1, 2, 3]
          const earliest = allSteps.find(s => (STEP_FIELDS[s] || []).some(f => byField[f]))
          if (earliest !== undefined) setStep(earliest)
        } else {
          setError(data.errors?.map(e => e.message || e).join(' ') || data.error || 'Something went wrong.')
        }
        return
      }
      await refreshProfile()
      if ((isEdit || isSecondApp) && onCancel) onCancel()
    } catch (err) {
      console.error('[ApplicationForm] Network error:', err)
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
          <button className="btn-secondary" onClick={() => setHiwOpen(true)}>
            See How It Works
          </button>
        </div>
        <HowItWorksPanel open={hiwOpen} onClose={() => setHiwOpen(false)} initialRole={form.role} />
      </div>
    )
  }

  // ── Step 1: Basic info + selects ──
  if (step === 1) {
    const singleFields = [
      ...SHARED_SINGLE,
      ...(isMentor ? MENTOR_SINGLE : []),
      ...(isMentee ? MENTEE_SINGLE : []),
    ]
    return (
      <div className="application-form">
        <h2>{isSecondApp ? `Apply as ${isMentor ? 'Mentor' : 'Mentee'}` : 'Your Background'}</h2>
        {!isSecondApp && (
          <>
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
            <div className="form-group">
              <label>Timezone</label>
              <input type="text" value={form.timezone || ''} onChange={e => set('timezone', e.target.value)} placeholder="e.g. EST, PST, GMT+1" />
            </div>
          </>
        )}
        {singleFields.map(f => (
          <SelectField key={f.key} field={f} value={form[f.key]} onChange={set} />
        ))}
        {errorsForStep(1).map((msg, i) => <p key={i} className="form-error">{msg}</p>)}
        <div className="form-actions">
          {isEdit
            ? <button className="btn-secondary" onClick={onCancel}>Cancel</button>
            : isSecondApp
              ? <button className="btn-secondary" onClick={onCancel}>Cancel</button>
              : <button className="btn-secondary" onClick={() => setStep(0)}>Back</button>}
          <button className="btn-primary" disabled={!isSecondApp && (!form.name?.trim() || !form.career_level)} onClick={() => setStep(2)}>Next</button>
        </div>
      </div>
    )
  }

  // ── Step 2: Multi-selects (areas, topics) ──
  if (step === 2) {
    const topicFields = isMentor ? TOPIC_FIELDS_MENTOR : []
    const menteeTopics = isMentee ? TOPIC_FIELDS_MENTEE : []
    return (
      <div className="application-form">
        <h2>Your Interests</h2>
        <p className="placeholder-text" style={{ marginBottom: '0.5rem' }}>
          Select the areas you're interested in pursuing — not just where you are today.
        </p>
        {MULTI_SELECT.map(f => (
          <MultiSelectField key={f.key} field={f} value={form[f.key] || []} onChange={set} />
        ))}
        {[...topicFields, ...menteeTopics].map(f => (
          <MultiSelectField key={f.key} field={f} value={form[f.key] || []} onChange={set} />
        ))}
        {errorsForStep(2).map((msg, i) => <p key={i} className="form-error">{msg}</p>)}
        <div className="form-actions">
          <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
          <button className="btn-primary" disabled={!form.climate_areas?.length || !form.career_areas?.length} onClick={() => setStep(3)}>Next</button>
        </div>
      </div>
    )
  }

  // ── Step 3: Free text + links + submit ──
  return (
    <div className="application-form">
      <h2>Tell Us More</h2>
      <p className="placeholder-text" style={{ marginBottom: '1rem' }}>
        Please keep responses to less than 200 words. We ask that you do not use AI or any LLMs
        to respond to these questions. We want to hear your genuine thoughts and goals in your
        own words! Feel free to be informal with your language.
      </p>
      {isMentee && (
        <>
          <div className="form-group">
            <label>In your own words, what are you hoping to gain from this mentorship? What are three things that are important to you in a potential mentor? *</label>
            <textarea
              rows={4}
              value={form.statement_of_intent || ''}
              onChange={e => set('statement_of_intent', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>If applicable, please list or provide links to any relevant climate/sustainability/environmental projects, case studies, capstone projects, etc. that you have worked on</label>
            <textarea
              rows={3}
              value={form.relevant_projects || ''}
              onChange={e => set('relevant_projects', e.target.value)}
            />
          </div>
        </>
      )}
      {isMentor && (
        <>
          <div className="form-group">
            <label>In your own words, why do you want to be a mentor? What do you think is your greatest strength you bring to mentoring? *</label>
            <textarea
              rows={4}
              value={form.motivation || ''}
              onChange={e => set('motivation', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Current job market trends suggest it takes about 3–12 months to find a job in climate. How would you help someone who is dealing with a long job search?</label>
            <textarea
              rows={4}
              value={form.eq_response || ''}
              onChange={e => set('eq_response', e.target.value)}
            />
          </div>
        </>
      )}
      <div className="form-group">
        <label>Anything else you would like us to know or consider in matching you with a {isMentor ? 'mentee' : 'mentor'}?</label>
        <textarea
          rows={3}
          value={form.additional_info || ''}
          onChange={e => set('additional_info', e.target.value)}
        />
      </div>
      <div className="form-group">
        <label>Fun Fact</label>
        <input type="text" value={form.fun_fact || ''} onChange={e => set('fun_fact', e.target.value)} placeholder="Something interesting about you" />
      </div>
      {!isSecondApp && (
        <div className="form-group">
          <label>LinkedIn URL</label>
          <input type="url" value={form.links?.linkedin || ''} onChange={e => set('links', { ...form.links, linkedin: e.target.value })} placeholder="https://linkedin.com/in/..." />
        </div>
      )}
      {isMentor && (
        <div className="form-group">
          <label>Scheduling Link</label>
          <input type="url" value={form.scheduling_link || ''} onChange={e => set('scheduling_link', e.target.value)} placeholder="e.g. https://calendly.com/yourname" />
        </div>
      )}
      <div className="commitment-block">
        <label>
          <strong>Please confirm you can commit to meeting regularly with your selected {isMentor ? 'mentee' : 'mentor'} (i.e. once per week or once biweekly).</strong> Type your name below as confirmation.
        </label>
        <input
          type="text"
          value={form.commitment_name || ''}
          onChange={e => set('commitment_name', e.target.value)}
          placeholder="Type your full name"
        />
      </div>
      {errorsForStep(3).map((msg, i) => <p key={i} className="form-error">{msg}</p>)}
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
