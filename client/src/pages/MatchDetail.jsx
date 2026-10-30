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
          {p.career_level && <span>{p.career_level}</span>}
          <span>Matched {date}</span>
        </div>

        {(p.career_areas?.length > 0 || p.climate_areas?.length > 0) && (
          <div className="partner-tags">
            {p.career_areas?.map(a => <span key={a} className="tag">{a}</span>)}
            {p.climate_areas?.map(a => <span key={a} className="tag tag-climate">{a}</span>)}
          </div>
        )}

        {(p.motivation || p.statement_of_intent) && (
          <div className="partner-section">
            <h3>{match.your_role === 'mentee' ? 'Motivation' : 'Statement of Intent'}</h3>
            <p>{p.motivation || p.statement_of_intent}</p>
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
