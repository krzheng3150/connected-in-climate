import { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import MenteeDashboard from './MenteeDashboard.jsx'
import MentorDashboard from './MentorDashboard.jsx'
import ApplicationForm from '../components/ApplicationForm.jsx'
import NavBar from '../components/NavBar.jsx'

export default function Dashboard() {
  const { user, hasProfile, loading, error, refreshProfile } = useAuth()
  const [view, setView] = useState(user?.is_mentee ? 'mentee' : 'mentor')
  const [editing, setEditing] = useState(false)

  if (loading) {
    return <div className="page"><p>Loading…</p></div>
  }

  if (error || !user) {
    return (
      <div className="page">
        <p className="form-error">{error || 'Unable to load your profile.'}</p>
        <button className="btn-primary" onClick={refreshProfile}>Retry</button>
      </div>
    )
  }

  if (!hasProfile) {
    return (
      <div className="page">
        <NavBar />
        <main className="page-body">
          <ApplicationForm />
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <NavBar />

      <main className="page-body">
        {editing && (
          <ApplicationForm
            existingProfile={{ name: user.name, role: user.role, payload: user.payload }}
            onCancel={() => setEditing(false)}
          />
        )}

        {!editing && <>
        <h2>Welcome, {user.preferred_name || user.name}</h2>

        {user.status === 'PENDING' && (
          <div className="pending-banner">
            <strong>Your application is under review.</strong>
            <p>An admin will review your application soon. You can still edit your profile while you wait.</p>
          </div>
        )}

        <button className="btn-link" onClick={() => setEditing(true)}>Edit Profile</button>

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

        {view === 'mentor' && user.is_mentor && <MentorDashboard />}
        </>}
      </main>
    </div>
  )
}
