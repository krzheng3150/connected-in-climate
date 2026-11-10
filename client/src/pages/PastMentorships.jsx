import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import NavBar from '../components/NavBar.jsx'
import MatchDetailPanel from '../components/MatchDetailPanel.jsx'

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PastMentorships() {
  const { user } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [openPanel, setOpenPanel] = useState(null)

  const fetchPast = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matches/past?email=${encodeURIComponent(user.email)}`)
      if (res.ok) {
        const data = await res.json()
        setMatches(data.matches)
      }
    } catch { /* network error */ }
    setLoading(false)
  }, [user.email])

  useEffect(() => { fetchPast() }, [fetchPast])

  return (
    <div className="page">
      <NavBar />
      <main className="page-body">
        <div style={{ marginBottom: '1rem' }}>
          <Link to="/dashboard" className="btn-link">&larr; Back to Dashboard</Link>
        </div>
        <h2>Past Mentorships</h2>

        {loading && <p className="placeholder-text">Loading...</p>}

        {!loading && matches.length === 0 && (
          <div className="empty-state">
            <p className="placeholder-text">No past mentorships yet.</p>
          </div>
        )}

        {!loading && matches.length > 0 && (
          <div className="match-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
            {matches.map(m => {
              const isMentee = m.mentee_email === user.email
              const partnerName = isMentee ? m.mentor_name : m.mentee_name
              const partnerRole = isMentee ? 'Mentor' : 'Mentee'
              const dateRange = m.activated_at && m.end_date
                ? `${formatDate(m.activated_at)} – ${formatDate(m.end_date)}`
                : formatDate(m.created_at)

              return (
                <div key={m.match_id} className="match-card" style={{ cursor: 'default', opacity: 0.85 }}>
                  <div className="match-card-top">
                    <span className="match-card-name">{partnerName}</span>
                    <span className="match-card-role">{partnerRole}</span>
                  </div>
                  <div className="match-card-meta">
                    <span>{dateRange}</span>
                    <span className="match-card-score">{Math.round(m.final_score * 100)}% match</span>
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <button className="btn-link" onClick={() => setOpenPanel(openPanel === m.match_id ? null : m.match_id)}>
                      {openPanel === m.match_id ? 'Hide details' : 'View details'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {openPanel && (
          <div className="detail-panels">
            <MatchDetailPanel matchId={openPanel} onClose={() => setOpenPanel(null)} />
          </div>
        )}
      </main>
    </div>
  )
}
