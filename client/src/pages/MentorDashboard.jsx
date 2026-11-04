import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import MatchCard from '../components/MatchCard.jsx'
import MatchDetailPanel from '../components/MatchDetailPanel.jsx'

export default function MentorDashboard() {
  const { user } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [openPanels, setOpenPanels] = useState([])

  function togglePanel(matchId) {
    setOpenPanels(prev =>
      prev.includes(matchId) ? prev.filter(id => id !== matchId) : [...prev, matchId],
    )
  }

  function closePanel(matchId) {
    setOpenPanels(prev => prev.filter(id => id !== matchId))
  }

  const fetchMatches = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/matches?email=${encodeURIComponent(user.email)}`)
      if (res.ok) {
        const data = await res.json()
        setMatches(data.matches)
      }
    } catch { /* network error */ }
    setLoading(false)
  }, [user.email])

  useEffect(() => { fetchMatches() }, [fetchMatches])

  if (loading) {
    return <p className="placeholder-text">Loading matches...</p>
  }

  return (
    <div className="mentor-dashboard">
      {matches.length === 0 ? (
        <div className="empty-state">
          <p>No mentees matched yet.</p>
          <p className="placeholder-text">
            When a mentee is matched with you, they'll appear here.
          </p>
        </div>
      ) : (
        <div className="match-list">
          <h3>Your Mentees</h3>
          {matches.map(m => (
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
    </div>
  )
}
