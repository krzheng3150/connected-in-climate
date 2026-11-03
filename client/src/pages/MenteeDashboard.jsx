import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'
import { lbl } from '../components/ProfileFields.jsx'
import MatchCard from '../components/MatchCard.jsx'

export default function MenteeDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [finding, setFinding] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [message, setMessage] = useState(null)

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matches?email=${encodeURIComponent(user.email)}`)
      if (res.ok) {
        const data = await res.json()
        setMatches(data.matches)
      }
    } catch { /* network error — leave matches empty */ }
    setLoading(false)
  }, [user.email])

  useEffect(() => { fetchMatches() }, [fetchMatches])

  const pendingMatches = matches.filter(m => m.status === 'PENDING_REVIEW')
  const approvedMatches = matches.filter(m => m.status === 'ADMIN_APPROVED')
  const activeMatches = matches.filter(m => m.status === 'ACTIVE')

  const hasPending = pendingMatches.length > 0
  const hasApproved = approvedMatches.length > 0
  const hasActive = activeMatches.length > 0
  const canFindMentor = !hasPending && !hasApproved && !hasActive

  async function handleFindMentor() {
    setFinding(true)
    setMessage(null)
    try {
      const res = await fetch('/api/matches/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || 'Something went wrong.')
      } else if (!data.match && data.pending_count) {
        setMessage(data.message)
        await fetchMatches()
      } else if (!data.match) {
        setMessage(data.message || 'No mentors available right now.')
      } else {
        setMessage(`Matched with ${data.match.mentor_name}!`)
        await fetchMatches()
      }
    } catch {
      setMessage('Could not reach the server.')
    }
    setFinding(false)
  }

  async function handleSelect(matchId) {
    setSelecting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/matches/${matchId}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email }),
      })
      if (res.ok) {
        setMessage('Mentor selected!')
        await fetchMatches()
      } else {
        const data = await res.json()
        setMessage(data.error || 'Could not select mentor.')
      }
    } catch {
      setMessage('Could not reach the server.')
    }
    setSelecting(false)
  }

  if (loading) {
    return <p className="placeholder-text">Loading matches...</p>
  }

  return (
    <div className="mentee-dashboard">
      {canFindMentor && (
        <div className="dashboard-actions">
          <button className="btn-primary" onClick={handleFindMentor} disabled={finding}>
            {finding ? 'Finding...' : 'Find a Mentor'}
          </button>
        </div>
      )}

      {message && <p className="dashboard-message">{message}</p>}

      {hasPending && (
        <div className="pending-state">
          <h3>Match Under Review</h3>
          <p className="placeholder-text">
            Your match request has been submitted. A human is reviewing your mentor
            candidates and will select the best options for you. Check back soon!
          </p>
        </div>
      )}

      {hasApproved && (
        <div className="pick-section">
          <h3>Choose Your Mentor</h3>
          <p className="placeholder-text">
            Your admin has reviewed your candidates and selected {approvedMatches.length} mentor{approvedMatches.length > 1 ? 's' : ''} for you.
            {approvedMatches.length > 1
              ? ' Compare them and pick the one you\'d like to work with.'
              : ' Review their profile and confirm the match.'}
          </p>
          <div className="match-list">
            {approvedMatches.map(m => (
              <PickCard
                key={m.match_id}
                match={m}
                onSelect={() => handleSelect(m.match_id)}
                onViewDetail={() => navigate(`/matches/${m.match_id}`)}
                disabled={selecting}
              />
            ))}
          </div>
        </div>
      )}

      {hasActive && (
        <div className="match-list">
          <h3>Your Matches</h3>
          {activeMatches.map(m => (
            <MatchCard key={m.match_id} match={m} userEmail={user.email} />
          ))}
        </div>
      )}

      {canFindMentor && matches.length === 0 && (
        <div className="empty-state">
          <p>No matches yet.</p>
          <p className="placeholder-text">
            Click "Find a Mentor" to get matched with a climate tech mentor.
          </p>
        </div>
      )}
    </div>
  )
}

function PickCard({ match, onSelect, onViewDetail, disabled }) {
  const mp = match.mentor_payload || {}
  const score = Math.round(match.final_score * 100)

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <strong>{match.mentor_name}</strong>
        <span className="match-card-score">{score}% match</span>
      </div>
      <div className="pick-card-details" style={{ margin: '0.5rem 0', fontSize: '0.875rem', color: 'var(--muted)' }}>
        {mp.location && <div>{mp.location}</div>}
        {mp.career_areas?.length > 0 && (
          <div>Career: {mp.career_areas.map(a => lbl('career_areas', a)).join(', ')}</div>
        )}
        {mp.climate_areas?.length > 0 && (
          <div>Climate: {mp.climate_areas.map(a => lbl('climate_areas', a)).join(', ')}</div>
        )}
        {mp.top_strengths?.length > 0 && (
          <div>Strengths: {mp.top_strengths.map(t => lbl('topics', t)).join(', ')}</div>
        )}
      </div>
      <div className="admin-card-actions">
        <button className="btn-link" onClick={onViewDetail}>View full profile</button>
        <button className="btn-primary" onClick={onSelect} disabled={disabled}>
          {disabled ? 'Selecting...' : 'Select This Mentor'}
        </button>
      </div>
    </div>
  )
}
