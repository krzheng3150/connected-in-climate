import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { useUser as useClerkUser, useAuth as useClerkAuth, useClerk } from '@clerk/react'

import { AUTH_ENABLED } from '../config.js'
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const { isSignedIn, isLoaded: authLoaded, getToken } = useClerkAuth()
  const { user: clerkUser, isLoaded: userLoaded } = useClerkUser()
  const { signOut } = useClerk()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [testEmail, setTestEmail] = useState(() => {
    try { return sessionStorage.getItem('test_email') || null } catch { return null }
  })
  const hasLoaded = useRef(false)

  const testLogin = useCallback((email) => {
    try { sessionStorage.setItem('test_email', email) } catch {}
    setTestEmail(email)
  }, [])

  const testLogout = useCallback(() => {
    try { sessionStorage.removeItem('test_email') } catch {}
    setTestEmail(null)
    setProfile(null)
  }, [])

  const fetchProfile = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true)
    setError(null)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (!AUTH_ENABLED && testEmail) {
        headers['x-user-email'] = testEmail
      } else if (AUTH_ENABLED || !testEmail) {
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
        if (!AUTH_ENABLED && testEmail) {
          setError('This is an admin email. Please sign in below.')
          testLogout()
        }
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
      if (!AUTH_ENABLED && !testEmail && isSignedIn && !data.is_admin) {
        signOut()
        setProfile(null)
        setError('This sign-in is for admins only. Please use the email field above.')
        setLoading(false)
        return
      }
      setProfile(data)
    } catch (err) {
      console.error('[auth] profile fetch failed:', err)
      setError('Could not reach the server.')
    } finally {
      hasLoaded.current = true
      setLoading(false)
    }
  }, [getToken, isSignedIn, testEmail, testLogout])

  useEffect(() => {
    if (!AUTH_ENABLED && testEmail) {
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
  }, [isSignedIn, authLoaded, userLoaded, clerkUser, testEmail, fetchProfile])

  const loggedIn = !AUTH_ENABLED ? (!!testEmail || isSignedIn) : isSignedIn
  const user = profile
  const hasProfile = profile?.has_profile !== false

  return (
    <AuthContext.Provider value={{ user, hasProfile, loading, error, isSignedIn: loggedIn, refreshProfile: fetchProfile, testEmail, testLogin, testLogout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
