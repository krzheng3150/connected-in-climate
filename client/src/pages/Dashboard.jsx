import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useNavigate } from 'react-router-dom'
import MenteeDashboard from './MenteeDashboard.jsx'

export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [view, setView] = useState(user.is_mentee ? 'mentee' : 'mentor')

  return (
    <div className="page">
      <header className="page-header">
        <h1>Connected in Climate</h1>
        <div className="user-info">
          <span>{user.name}</span>
          {user.is_admin && (
            <button className="btn-link" onClick={() => navigate('/admin')}>Admin</button>
          )}
          <button className="btn-link" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="page-body">
        <h2>Welcome, {user.preferred_name || user.name}</h2>

        {user.is_mentee && user.is_mentor && (
          <div className="role-tabs">
            <button
              className={`role-tab ${view === 'mentee' ? 'active' : ''}`}
              onClick={() => setView('mentee')}
            >
              As Mentee
            </button>
            <button
              className={`role-tab ${view === 'mentor' ? 'active' : ''}`}
              onClick={() => setView('mentor')}
            >
              As Mentor
            </button>
          </div>
        )}

        {!user.is_mentee && !user.is_mentor && user.is_admin && (
          <p className="placeholder-text">You're signed in as an admin. Use the Admin link above to manage the platform.</p>
        )}

        {!user.is_mentee && !user.is_mentor && !user.is_admin && (
          <p className="placeholder-text">Your role is not yet configured.</p>
        )}

        {view === 'mentee' && user.is_mentee && <MenteeDashboard />}

        {view === 'mentor' && user.is_mentor && (
          <div className="empty-state">
            <p className="role-badge">mentor</p>
            <p className="placeholder-text">Mentor dashboard coming soon.</p>
          </div>
        )}
      </main>
    </div>
  )
}
