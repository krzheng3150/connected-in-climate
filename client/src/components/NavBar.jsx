import { Link, useNavigate } from 'react-router-dom'
import { useClerk } from '@clerk/react'
import { useAuth } from '../context/AuthContext.jsx'

export default function NavBar() {
  const { user } = useAuth()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  return (
    <header className="page-header">
      <div className="user-info">
        <Link to="/" className="btn-link">Home</Link>
        <Link to="/about" className="btn-link">About Us</Link>
        {user && (
          <>
            {user.is_admin && (
              <button className="btn-link" onClick={() => navigate('/admin')}>Admin</button>
            )}
            <span className="nav-user-name">{user.name || user.email}</span>
            <button className="btn-link" onClick={() => signOut()}>Sign out</button>
          </>
        )}
      </div>
    </header>
  )
}
