import { useAuth } from '../context/AuthContext.jsx'

export default function Dashboard() {
  const { user, logout } = useAuth()

  return (
    <div className="page">
      <header className="page-header">
        <h1>Connected in Climate</h1>
        <div className="user-info">
          <span>{user.name}</span>
          <button className="btn-link" onClick={logout}>Sign out</button>
        </div>
      </header>

      <main className="page-body">
        <h2>Welcome, {user.preferred_name || user.name}</h2>
        <p className="role-badge">{user.role}</p>
        <p className="placeholder-text">
          Your dashboard is coming soon. Check back for match results and mentor connections.
        </p>
      </main>
    </div>
  )
}
