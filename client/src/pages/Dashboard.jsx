import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import MenteeDashboard from './MenteeDashboard.jsx'
import MentorDashboard from './MentorDashboard.jsx'
import ApplicationForm from '../components/ApplicationForm.jsx'
import NavBar from '../components/NavBar.jsx'

export default function Dashboard() {
  const { user, hasProfile, loading, error, refreshProfile } = useAuth()
  const defaultView = user?.is_mentee ? 'mentee' : user?.is_mentor ? 'mentor' : 'mentee'
  const [view, setView] = useState(defaultView)
  const [editing, setEditing] = useState(false)
  const [addingRole, setAddingRole] = useState(null)

  useEffect(() => {
    if (user?.is_mentee && !user?.is_mentor) setView('mentee')
    else if (user?.is_mentor && !user?.is_mentee) setView('mentor')
  }, [user?.is_mentee, user?.is_mentor])

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

  if (addingRole) {
    return (
      <div className="page">
        <NavBar />
        <main className="page-body">
          <ApplicationForm
            forRole={addingRole}
            onCancel={() => setAddingRole(null)}
          />
        </main>
      </div>
    )
  }

  const hasMentorApp = !!user.mentor_status
  const hasMenteeApp = !!user.mentee_status
  const mentorPending = user.mentor_status === 'PENDING'
  const menteePending = user.mentee_status === 'PENDING'

  return (
    <div className="page">
      <NavBar />

      <main className="page-body">
        {editing && (
          <ApplicationForm
            existingProfile={{ name: user.name, role: view, payload: user.payload }}
            onCancel={() => setEditing(false)}
          />
        )}

        {!editing && <>
        <h2>Welcome, {user.preferred_name || user.name}</h2>

        {hasMentorApp && hasMenteeApp && (
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

        {menteePending && view === 'mentee' && (
          <div className="pending-banner">
            <strong>Your mentee application is under review.</strong>
            <p>An admin will review your application soon. You can still edit your profile while you wait.</p>
          </div>
        )}

        {mentorPending && view === 'mentor' && (
          <div className="pending-banner">
            <strong>Your mentor application is under review.</strong>
            <p>An admin will review your application soon. You can still edit your profile while you wait.</p>
          </div>
        )}

        <button className="btn-link" onClick={() => setEditing(true)}>Edit Profile</button>

        {!hasMentorApp && !hasMenteeApp && user.is_admin && (
          <p className="placeholder-text">You're signed in as an admin. Use the Admin link above to manage the platform.</p>
        )}

        {!hasMentorApp && !hasMenteeApp && !user.is_admin && (
          <p className="placeholder-text">Your role is not yet configured.</p>
        )}

        {view === 'mentee' && user.is_mentee && <MenteeDashboard />}

        {view === 'mentor' && user.is_mentor && <MentorDashboard />}

        {hasMenteeApp && !hasMentorApp && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <button className="btn-secondary" onClick={() => setAddingRole('mentor')}>
              Also become a Mentor
            </button>
          </div>
        )}

        {hasMentorApp && !hasMenteeApp && (
          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
            <button className="btn-secondary" onClick={() => setAddingRole('mentee')}>
              Also become a Mentee
            </button>
          </div>
        )}

        <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
          <Link to="/dashboard/past" className="btn-link">Past Mentorships</Link>
        </div>
        </>}
      </main>
    </div>
  )
}
