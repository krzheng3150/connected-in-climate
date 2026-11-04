import { Navigate } from 'react-router-dom'
import { useAuth as useClerkAuth } from '@clerk/react'
import { useAuth } from '../context/AuthContext.jsx'

const TEST_USER = import.meta.env.VITE_TEST_USER

export default function RequireAuth({ children }) {
  const { isSignedIn, isLoaded } = useClerkAuth()
  const { loading } = useAuth()

  if (TEST_USER) return loading ? <div className="page"><p>Loading…</p></div> : children
  if (!isLoaded || loading) return <div className="page"><p>Loading…</p></div>
  if (!isSignedIn) return <Navigate to="/" replace />
  return children
}
