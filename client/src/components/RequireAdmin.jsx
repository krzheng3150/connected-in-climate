import { useAuth } from '../context/AuthContext.jsx'
import NotFound from '../pages/NotFound.jsx'

export default function RequireAdmin({ children }) {
  const { user } = useAuth()
  if (!user?.is_admin) return <NotFound />
  return children
}
