import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { lbl, ProfileDetail } from '../components/ProfileFields.jsx'
import MatchCard from '../components/MatchCard.jsx'
import MatchDetailPanel from '../components/MatchDetailPanel.jsx'
import ConfirmationModal from '../components/ConfirmationModal.jsx'

export default function MenteeDashboard() {
  const { user } = useAuth()
  const [run, setRun] = useState(undefined)
  const [loading, setLoading] = useState(true)
  const [finding, setFinding] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [message, setMessage] = useState(null)
  const [openPanels, setOpenPanels] = useState([])
  const [confirmFind, setConfirmFind] = useState(false)
  const [confirmSelect, setConfirmSelect] = useState(null)
  const [ackSpoken, setAckSpoken] = useState(false)

  function togglePanel(matchId) {
    setOpenPanels(prev =>
      prev.includes(matchId) ? prev.filter(id => id !== matchId) : [...prev, matchId],
    )
  }

  function closePanel(matchId) {
    setOpenPanels(prev => prev.filter(id => id !== matchId))
  }

  const fetchRun = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matches/run/current?email=${encodeURIComponent(user.email)}`)
      if (res.ok) {
        const data = await res.json()
        setRun(data.run)
      }
    } catch { /* network error */ }
    setLoading(false)
  }, [user.email])

  useEffect(() => { fetchRun() }, [fetchRun])

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
      } else if (data.run) {
        setMessage(data.message)
        await fetchRun()
      } else {
        setMessage(data.message || 'No mentors available right now.')
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
        await fetchRun()
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
    return <p className="placeholder-text">Loading...</p>
  }

  const noRun = !run
  const isPending = run?.status === 'PENDING_REVIEW'
  const isAwaiting = run?.status === 'AWAITING_MENTEE'
  const isActive = run?.status === 'ACTIVE'

  return (
    <div className="mentee-dashboard">
      {noRun && user.status === 'APPROVED' && (
        <>
          <div className="dashboard-actions">
            <button className="btn-primary" onClick={() => setConfirmFind(true)} disabled={finding}>
              {finding ? 'Finding...' : 'Find a Mentor'}
            </button>
          </div>
          <div className="empty-state">
            <p>No matches yet.</p>
            <p className="placeholder-text">
              Click "Find a Mentor" to get matched with a climate tech mentor.
            </p>
          </div>
          {confirmFind && (
            <ConfirmationModal
              title="Confirm Match Request"
              confirmLabel="Find a Mentor"
              onConfirm={() => { setConfirmFind(false); handleFindMentor() }}
              onCancel={() => setConfirmFind(false)}
              confirming={finding}
            >
              <p style={{ marginBottom: '0.75rem', fontSize: '0.9rem', color: 'var(--muted)' }}>
                The algorithm will use your profile to find the best mentor match. Please review your submission:
              </p>
              <ProfileDetail payload={user.payload} exclude={['max_capacity', 'w_horiz', 'w_vert', 'w_sector', 'geo_match_preference']} />
            </ConfirmationModal>
          )}
        </>
      )}

      {message && <p className="dashboard-message">{message}</p>}

      {isPending && (
        <div className="pending-state">
          <h3>Match Under Review</h3>
          <p className="placeholder-text">
            Your match request has been submitted. A human is reviewing your mentor
            candidates and will select the best options for you. Check back soon!
          </p>
        </div>
      )}

      {isAwaiting && (
        <div className="pick-section">
          <h3>Choose Your Mentor</h3>
          <p className="placeholder-text">
            Your admin has reviewed your candidates and selected {run.matches.length} mentor{run.matches.length > 1 ? 's' : ''} for you.
            {run.matches.length > 1
              ? ' Before making your decision, we strongly encourage you to schedule a short (15-minute) introductory call with each mentor. This helps you find the best fit for your goals and working style.'
              : ' Before confirming, we encourage you to schedule a short introductory call with your mentor to make sure it\'s a good fit.'}
          </p>
          <div className="match-list">
            {run.matches.map(m => (
              <PickCard
                key={m.match_id}
                match={m}
                onSelect={() => setConfirmSelect(m)}
                onViewDetail={() => togglePanel(m.match_id)}
                disabled={selecting}
              />
            ))}
          </div>
        </div>
      )}

      {isActive && run.matches.length > 0 && (
        <div className="match-list">
          <h3>Your Matches</h3>
          {run.matches.map(m => (
            <MatchCard key={m.match_id} match={m} userEmail={user.email} onOpen={togglePanel} />
          ))}
        </div>
      )}

      {openPanels.length > 0 && (
        <div className="detail-panels">
          {openPanels.map(id => (
            <MatchDetailPanel key={id} matchId={id} onClose={() => closePanel(id)} />
          ))}
        </div>
      )}

      {confirmSelect && (
        <ConfirmationModal
          title="Confirm Mentor Selection"
          confirmLabel="Select This Mentor"
          onConfirm={() => { const id = confirmSelect.match_id; setConfirmSelect(null); setAckSpoken(false); handleSelect(id) }}
          onCancel={() => { setConfirmSelect(null); setAckSpoken(false) }}
          confirming={selecting}
          confirmDisabled={!ackSpoken}
        >
          <p style={{ marginBottom: '0.75rem' }}>
            You are selecting <strong>{confirmSelect.mentor_name}</strong> as your mentor.
            This decision is final — your other candidates will no longer be available.
          </p>
          {confirmSelect.mentor_payload && (
            <>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.5rem' }}>Mentor profile:</div>
              <ProfileDetail payload={confirmSelect.mentor_payload} exclude={['max_capacity', 'w_horiz', 'w_vert', 'w_sector', 'geo_match_preference']} />
            </>
          )}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginTop: '1rem', fontSize: '0.875rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={ackSpoken} onChange={e => setAckSpoken(e.target.checked)} style={{ marginTop: '0.2rem' }} />
            <span>I have spoken with my matched mentor{run?.matches?.length > 1 ? 's' : ''} and am ready to make my final decision.</span>
          </label>
        </ConfirmationModal>
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
        {mp.scheduling_link && (
          <a className="btn-secondary" href={mp.scheduling_link} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            Book Intro Call
          </a>
        )}
        <button className="btn-link" onClick={onViewDetail}>View full profile</button>
        <button className="btn-primary" onClick={onSelect} disabled={disabled}>
          {disabled ? 'Selecting...' : 'Select This Mentor'}
        </button>
      </div>
    </div>
  )
}
