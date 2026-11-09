import { Navigate } from 'react-router-dom'
import { useAuth as useClerkAuth } from '@clerk/react'
import { useAuth } from '../context/AuthContext.jsx'
import { TEST_MODE } from '../config.js'

export default function RequireAuth({ children }) {
  const { isSignedIn: clerkSignedIn, isLoaded } = useClerkAuth()
  const { loading, testEmail } = useAuth()

  if (TEST_MODE && testEmail) return loading ? <div className="page"><p>Loading…</p></div> : children
  if (!isLoaded || loading) return <div className="page"><p>Loading…</p></div>
  if (!clerkSignedIn) return <Navigate to="/" replace />
  return children
}
