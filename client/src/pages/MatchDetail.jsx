import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function MatchDetail() {
  const { matchId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [match, setMatch] = useState(null)
  const [feedbacks, setFeedbacks] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackRating, setFeedbackRating] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState(null)

  const fetchMatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/matches/${matchId}?email=${encodeURIComponent(user.email)}`)
      if (res.status === 404) { setError('Match not found.'); return }
      if (res.status === 403) { setError('Not authorized.'); return }
      if (!res.ok) { setError('Something went wrong.'); return }
      const data = await res.json()
      setMatch(data)
    } catch {
      setError('Could not reach the server.')
    }
  }, [matchId, user.email])

  const fetchFeedbacks = useCallback(async () => {
    try {
      const res = await fetch(`/api/feedback?match_id=${matchId}&email=${encodeURIComponent(user.email)}`)
      if (res.ok) {
        const data = await res.json()
        setFeedbacks(data.feedbacks)
      }
    } catch { /* ignore */ }
  }, [matchId, user.email])

  const trackAction = useCallback(async (actionType, payload) => {
    try {
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId,
          email: user.email,
          action_type: actionType,
          payload,
        }),
      })
    } catch { /* fire and forget */ }
  }, [matchId, user.email])

  useEffect(() => {
    (async () => {
      await fetchMatch()
      await fetchFeedbacks()
      setLoading(false)
      trackAction('VIEW')
    })()
  }, [fetchMatch, fetchFeedbacks, trackAction])

  function handleContactClick(linkType, url) {
    trackAction('CONTACT_CLICK', { link_type: linkType, url })
  }

  async function handleFeedbackSubmit(e) {
    e.preventDefault()
    if (!feedbackText.trim()) return
    setSubmitting(true)
    setFeedbackMsg(null)
    try {
      const body = { match_id: matchId, email: user.email, text: feedbackText.trim() }
      if (feedbackRating) body.rating = Number(feedbackRating)
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setFeedbackText('')
        setFeedbackRating('')
        setFeedbackMsg('Feedback submitted!')
        await fetchFeedbacks()
      } else {
        const data = await res.json()
        setFeedbackMsg(data.error || 'Could not submit feedback.')
      }
    } catch {
      setFeedbackMsg('Could not reach the server.')
    }
    setSubmitting(false)
  }

  if (loading) return <div className="page"><main className="page-body"><p className="placeholder-text">Loading...</p></main></div>
  if (error) return (
    <div className="page"><main className="page-body">
      <p className="form-error">{error}</p>
      <button className="btn-link" onClick={() => navigate('/dashboard')}>Back to dashboard</button>
    </main></div>
  )

  const p = match.partner
  const date = new Date(match.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const LABELS = {
    career_level: { entry: 'Associate / Entry', lead: 'Lead', managerial: 'Managerial', director: 'Director / Executive', c_suite: 'C-Suite' },
    education_level: { high_school: 'High school', associates: 'Associates', bachelors: "Bachelor's", masters: "Master's", doctorate: 'Doctorate' },
    years_experience: { '0_5': '0–5 years', '5_10': '5–10 years', '10_15': '10–15 years', '15_plus': '15+ years' },
    years_climate_experience: { '0_5': '0–5 years', '5_10': '5–10 years', '10_15': '10–15 years', '15_plus': '15+ years' },
    climate_areas: { ai_climate: 'AI in Climate', adaptation: 'Adaptation & Resilience', built_environment: 'Built Environment', circular_economy: 'Circular Economy', climate_finance: 'Climate Finance', climate_justice: 'Climate Justice', climate_policy: 'Climate Policy', climate_tech: 'Climate Tech', corporate_sustainability: 'Corporate Sustainability', decarbonization: 'Decarbonization', energy: 'Energy', food_agriculture: 'Food & Agriculture', nature_carbon: 'Nature & Carbon Removal', ocean_water: 'Ocean & Water', transportation: 'Transportation', urban_planning: 'Urban Planning' },
    career_areas: { biz_dev: 'Business Dev', consulting: 'Consulting', operations: 'Operations', engineering: 'Engineering', finance: 'Finance', fundraising: 'Fundraising', it: 'IT', marketing: 'Marketing', nonprofit_mgmt: 'Nonprofit Mgmt', program_mgmt: 'Program Mgmt', project_mgmt: 'Project Mgmt', research: 'R&D', strategy: 'Strategy', data_science: 'Data Science' },
    sectors: { private: 'Private Sector', nonprofit: 'Nonprofit / INGO', project_based: 'Project-based', education: 'Education', government: 'Government' },
    topics: { climate_literacy: 'Climate literacy & translating non-climate experience', career_exploration: 'Career exploration in climate', day_to_day: 'Day-to-day in the job', narrowing_options: 'Narrowing career options', job_search: 'Job search strategy', resume_interview: 'Resume & interview skills', networking: 'Networking', schooling_credentials: 'Schooling & credentials', skills_needed: 'Skills needed in climate', long_term_plan: 'Long-term career planning', career_transition: 'Career transition', international_work: 'International work', professional_challenges: 'Professional challenges', career_advancement: 'Career advancement', leadership_skills: 'Leadership & management skills', work_life_balance: 'Work/life balance', start_business: 'Starting or expanding a business', business_ideas: 'Sounding board for business ideas', nonprofit_board: 'Nonprofit board service' },
  }
  const lbl = (field, id) => LABELS[field]?.[id] ?? id

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-link" onClick={() => navigate('/dashboard')}>&larr; Dashboard</button>
        <span className="match-detail-score">{Math.round(match.final_score * 100)}% match</span>
      </header>

      <main className="page-body">
        <div className="partner-header">
          <h2>{p.preferred_name || p.name}</h2>
          {p.pronouns && <span className="partner-pronouns">{p.pronouns}</span>}
        </div>

        <div className="partner-meta">
          {p.location && <span>{p.location}</span>}
          {p.career_level && <span>{lbl('career_level', p.career_level)}</span>}
          {p.education_level && <span>{lbl('education_level', p.education_level)}</span>}
          {p.years_experience && <span>{lbl('years_experience', p.years_experience)} exp.</span>}
          <span>Matched {date}</span>
        </div>

        {(p.career_areas?.length > 0 || p.climate_areas?.length > 0) && (
          <div className="partner-tags">
            {p.career_areas?.map(a => <span key={a} className="tag">{lbl('career_areas', a)}</span>)}
            {p.climate_areas?.map(a => <span key={a} className="tag tag-climate">{lbl('climate_areas', a)}</span>)}
          </div>
        )}

        {(() => {
          const exp = []
          if (p.international_experience && p.international_experience !== 'none')
            exp.push('International experience')
          if (p.management_experience && p.management_experience !== 'none')
            exp.push('Management experience')
          if (p.business_experience && p.business_experience !== 'none')
            exp.push('Business experience')
          if (p.nonprofit_board_experience && p.nonprofit_board_experience !== 'none')
            exp.push('Nonprofit board')
          return exp.length > 0 ? (
            <div className="partner-tags">
              {exp.map(e => <span key={e} className="tag tag-experience">{e}</span>)}
            </div>
          ) : null
        })()}

        {p.sectors?.length > 0 && (
          <div className="partner-section">
            <h3>Sectors</h3>
            <div className="partner-tags">
              {p.sectors.map(s => <span key={s} className="tag">{lbl('sectors', s)}</span>)}
            </div>
          </div>
        )}

        {p.top_strengths?.length > 0 && (
          <div className="partner-section">
            <h3>Top Strengths</h3>
            <div className="partner-tags">
              {p.top_strengths.map(t => <span key={t} className="tag tag-topic">{lbl('topics', t)}</span>)}
            </div>
          </div>
        )}

        {p.general_topics?.length > 0 && (
          <div className="partner-section">
            <h3>Also Comfortable With</h3>
            <div className="partner-tags">
              {p.general_topics.map(t => <span key={t} className="tag tag-topic">{lbl('topics', t)}</span>)}
            </div>
          </div>
        )}

        {p.top_topics?.length > 0 && (
          <div className="partner-section">
            <h3>Topics of Interest</h3>
            <div className="partner-tags">
              {p.top_topics.map(t => <span key={t} className="tag tag-topic">{lbl('topics', t)}</span>)}
            </div>
          </div>
        )}

        {p.years_climate_experience && (
          <div className="partner-section">
            <h3>Climate Experience</h3>
            <p>{lbl('years_climate_experience', p.years_climate_experience)}</p>
          </div>
        )}

        {p.certifications?.length > 0 && (
          <div className="partner-section">
            <h3>Certifications</h3>
            <p>{p.certifications.join(', ')}</p>
          </div>
        )}

        {(p.motivation || p.statement_of_intent) && (
          <div className="partner-section">
            <h3>About</h3>
            <p>{p.motivation || p.statement_of_intent}</p>
          </div>
        )}

        {p.interests_hobbies?.length > 0 && (
          <div className="partner-section">
            <h3>Interests & Hobbies</h3>
            <p>{p.interests_hobbies.join(', ')}</p>
          </div>
        )}

        {p.fun_fact && (
          <div className="partner-section">
            <h3>Fun Fact</h3>
            <p>{p.fun_fact}</p>
          </div>
        )}

        {p.links && Object.keys(p.links).length > 0 && (
          <div className="partner-section">
            <h3>Contact</h3>
            <div className="contact-links">
              {Object.entries(p.links).map(([type, value]) => (
                <ContactLink key={type} type={type} value={value} onClick={handleContactClick} />
              ))}
            </div>
          </div>
        )}

        <div className="feedback-section">
          <h3>Feedback</h3>
          <form className="feedback-form" onSubmit={handleFeedbackSubmit}>
            <textarea
              placeholder="How is the match going? Share your experience..."
              value={feedbackText}
              onChange={e => setFeedbackText(e.target.value)}
              rows={3}
              required
            />
            <div className="feedback-form-row">
              <select value={feedbackRating} onChange={e => setFeedbackRating(e.target.value)}>
                <option value="">Rating (optional)</option>
                <option value="5">5 — Excellent</option>
                <option value="4">4 — Good</option>
                <option value="3">3 — Okay</option>
                <option value="2">2 — Poor</option>
                <option value="1">1 — Bad</option>
              </select>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'Sending...' : 'Submit'}
              </button>
            </div>
            {feedbackMsg && <p className="feedback-msg">{feedbackMsg}</p>}
          </form>

          {feedbacks.length > 0 && (
            <div className="feedback-list">
              {feedbacks.map(fb => (
                <div key={fb.feedback_id} className="feedback-item">
                  <div className="feedback-item-header">
                    <span className="feedback-author">
                      {fb.submitter_email === user.email ? 'You' : 'Partner'}
                    </span>
                    {fb.rating && <span className="feedback-rating">{'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}</span>}
                    <span className="feedback-date">
                      {new Date(fb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p className="feedback-text">{fb.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function ContactLink({ type, value, onClick }) {
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  const isUrl = value.startsWith('http')

  // Phone numbers are shown as copyable text, not a tel: link
  if (type === 'phone') {
    return (
      <span
        className="contact-link contact-link-text"
        onClick={() => {
          navigator.clipboard.writeText(value).catch(() => {})
          onClick(type, value)
        }}
        title="Click to copy"
        style={{ cursor: 'pointer' }}
      >
        {label}: {value}
      </span>
    )
  }

  const href = isUrl ? value
    : type === 'email' ? `mailto:${value}`
    : value

  if (isUrl || type === 'email') {
    return (
      <a
        className="contact-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onClick(type, value)}
      >
        {label}
      </a>
    )
  }

  return <span className="contact-link contact-link-text">{label}: {value}</span>
}
