import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useUser as useClerkUser, useAuth as useClerkAuth } from '@clerk/react'

const TEST_USER = import.meta.env.VITE_TEST_USER
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { isSignedIn, isLoaded: authLoaded, getToken } = useClerkAuth()
  const { user: clerkUser, isLoaded: userLoaded } = useClerkUser()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const hasLoaded = useRef(false)

  const fetchProfile = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true)
    setError(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (!TEST_USER) {
        const token = await getToken()
        if (!token) {
          setProfile(null)
          setLoading(false)
          return
        }
        headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`/api/profiles/me`, { headers })
      if (res.status === 401) {
        setProfile(null)
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError('Something went wrong loading your profile.')
        setLoading(false)
        return
      }
      const data = await res.json()
      setProfile(data)
    } catch (err) {
      console.error('[auth] profile fetch failed:', err)
      setError('Could not reach the server.')
    } finally {
      hasLoaded.current = true
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => {
    if (TEST_USER) {
      fetchProfile()
      return
    }
    if (!authLoaded || !userLoaded) return
    if (!isSignedIn) {
      setProfile(null)
      setLoading(false)
      return
    }
    fetchProfile()
  }, [isSignedIn, authLoaded, userLoaded, clerkUser, fetchProfile])

  const user = profile
  const hasProfile = profile?.has_profile !== false

  return (
    <AuthContext.Provider value={{ user, hasProfile, loading, error, isSignedIn: TEST_USER ? !!profile : isSignedIn, refreshProfile: fetchProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
