import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function RequireAuth({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/" replace />
  return children
}
