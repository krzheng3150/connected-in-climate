import { Link, useNavigate } from 'react-router-dom'
import { useClerk } from '@clerk/react'
import { useAuth } from '../context/AuthContext.jsx'

import { TEST_MODE } from '../config.js'

export default function NavBar() {
  const { user, testEmail, testLogout } = useAuth()
  const { signOut } = useClerk()
  const navigate = useNavigate()

  function handleSignOut() {
    if (TEST_MODE && testEmail) {
      testLogout()
      navigate('/')
    } else {
      signOut()
    }
  }

  return (
    <header className="page-header">
      <span className="nav-brand">Connected in Climate</span>
      <div className="user-info">
        <Link to="/" className="btn-link">Home</Link>
        <Link to="/about" className="btn-link">About Us</Link>
        {user && (
          <>
            {user.is_admin && (
              <button className="btn-link" onClick={() => navigate('/admin')}>Admin</button>
            )}
            <span className="nav-user-name">{user.name || user.email}</span>
            <button className="btn-link" onClick={handleSignOut}>Sign out</button>
          </>
        )}
      </div>
    </header>
  )
}
