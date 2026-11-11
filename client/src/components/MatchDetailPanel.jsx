import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { lbl, ProfileDetail } from './ProfileFields.jsx'

export default function MatchDetailPanel({ matchId, onClose }) {
  const { user } = useAuth()
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
      setMatch(await res.json())
    } catch {
      setError('Could not reach the server.')
    }
  }, [matchId, user.email])

  const fetchFeedbacks = useCallback(async () => {
    try {
      const res = await fetch(`/api/feedback?match_id=${matchId}&email=${encodeURIComponent(user.email)}`)
      if (res.ok) setFeedbacks((await res.json()).feedbacks)
    } catch { /* ignore */ }
  }, [matchId, user.email])

  const trackAction = useCallback(async (actionType, payload) => {
    try {
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, email: user.email, action_type: actionType, payload }),
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
        setFeedbackMsg((await res.json()).error || 'Could not submit feedback.')
      }
    } catch {
      setFeedbackMsg('Could not reach the server.')
    }
    setSubmitting(false)
  }

  if (loading) return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <span />
        <button className="detail-panel-close" onClick={onClose}>&times;</button>
      </div>
      <p className="placeholder-text">Loading...</p>
    </div>
  )

  if (error) return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <span />
        <button className="detail-panel-close" onClick={onClose}>&times;</button>
      </div>
      <p className="form-error">{error}</p>
    </div>
  )

  const p = match.partner
  const date = new Date(match.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="detail-panel">
      <div className="detail-panel-header">
        <span className="match-card-score">{Math.round(match.final_score * 100)}% match</span>
        <button className="detail-panel-close" onClick={onClose}>&times;</button>
      </div>

      <div className="partner-header">
        <h2>{p.preferred_name || p.name}</h2>
        {p.pronouns && <span className="partner-pronouns">{p.pronouns}</span>}
      </div>

      <div className="partner-meta">
        {p.location && <span>{p.location}</span>}
        {p.timezone && <span>{p.timezone}</span>}
        {p.career_level && <span>{lbl('career_level', p.career_level)}</span>}
        {p.education_level && <span>{lbl('education_level', p.education_level)}</span>}
        {p.years_experience && <span>{lbl('years_experience', p.years_experience)} exp.</span>}
        <span>Matched {date}</span>
      </div>

      <ProfileDetail
        payload={p}
        exclude={['preferred_name', 'pronouns', 'location', 'timezone', 'career_level', 'education_level', 'years_experience', 'links', 'photo_url', 'scheduling_link']}
      />

      <div className="partner-section">
        <h3>Contact</h3>
        {p.scheduling_link && (
          <div style={{ marginBottom: '0.75rem' }}>
            <a
              className="btn-primary"
              href={p.scheduling_link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleContactClick('scheduling_link', p.scheduling_link)}
              style={{ display: 'inline-block', textDecoration: 'none' }}
            >
              Book a Meeting
            </a>
          </div>
        )}
        <div className="contact-links">
          <ContactLink type="email" value={p.email} onClick={handleContactClick} />
          {p.links && Object.entries(p.links).map(([type, value]) => (
            <ContactLink key={type} type={type} value={value} onClick={handleContactClick} />
          ))}
        </div>
        <p className="placeholder-text" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
          Tip: Add each session to your calendar and turn on reminders to make sure you don't miss it.
        </p>
      </div>

      {match.resources_folder_url && match.status === 'ACTIVE' && (
        <div className="partner-section">
          <h3>Shared Resources</h3>
          <a
            className="btn-primary"
            href={match.resources_folder_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => handleContactClick('resources_folder', match.resources_folder_url)}
            style={{ display: 'inline-block', textDecoration: 'none' }}
          >
            Open Resources Folder
          </a>
        </div>
      )}

      {match.status === 'APPROVED' && (
        <p className="placeholder-text" style={{ marginTop: '1rem' }}>
          This match is pending your selection. Return to the dashboard to confirm.
        </p>
      )}

      {match.status === 'ACTIVE' && (
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
                    <span className="feedback-author">You</span>
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
      )}
    </div>
  )
}

function ContactLink({ type, value, onClick }) {
  const label = type.charAt(0).toUpperCase() + type.slice(1)
  const isUrl = value.startsWith('http')

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
