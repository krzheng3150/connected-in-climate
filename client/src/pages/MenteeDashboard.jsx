import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import MatchCard from '../components/MatchCard.jsx'

export default function MenteeDashboard() {
  const { user } = useAuth()
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [finding, setFinding] = useState(false)
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

  if (loading) {
    return <p className="placeholder-text">Loading matches...</p>
  }

  return (
    <div className="mentee-dashboard">
      <div className="dashboard-actions">
        <button className="btn-primary" onClick={handleFindMentor} disabled={finding}>
          {finding ? 'Finding...' : 'Find a Mentor'}
        </button>
      </div>

      {message && <p className="dashboard-message">{message}</p>}

      {matches.length === 0 ? (
        <div className="empty-state">
          <p>No matches yet.</p>
          <p className="placeholder-text">
            Click "Find a Mentor" to get matched with a climate tech mentor.
          </p>
        </div>
      ) : (
        <div className="match-list">
          <h3>Your Matches</h3>
          {matches.map(m => (
            <MatchCard key={m.match_id} match={m} userEmail={user.email} />
          ))}
        </div>
      )}
    </div>
  )
}
