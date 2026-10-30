import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const AuthContext = createContext(null)

const STORAGE_KEY = 'cic_user'

function readStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeStorage(user) {
  try {
    if (user) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch { /* blocked storage is fine */ }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(readStorage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => { writeStorage(user) }, [user])

  const login = useCallback(async (email) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/profiles/me?email=${encodeURIComponent(email)}`)
      if (res.status === 404) {
        setError('No profile found for that email.')
        setLoading(false)
        return false
      }
      if (!res.ok) {
        setError('Something went wrong. Please try again.')
        setLoading(false)
        return false
      }
      const data = await res.json()
      setUser(data)
      return true
    } catch {
      setError('Could not reach the server.')
      setLoading(false)
      return false
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
