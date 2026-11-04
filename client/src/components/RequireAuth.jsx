import { Navigate } from 'react-router-dom'
import { useAuth as useClerkAuth } from '@clerk/react'
import { useAuth } from '../context/AuthContext.jsx'

export default function RequireAuth({ children }) {
  const { isSignedIn, isLoaded } = useClerkAuth()
  const { loading } = useAuth()

  if (!isLoaded || loading) return <div className="page"><p>Loading…</p></div>
  if (!isSignedIn) return <Navigate to="/" replace />
  return children
}
