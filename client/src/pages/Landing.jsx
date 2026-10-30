import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Landing() {
  const [email, setEmail] = useState('')
  const { login, error, loading } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return
    const ok = await login(trimmed)
    if (ok) navigate('/dashboard', { replace: true })
  }

  return (
    <div className="landing">
      <div className="landing-hero">
        <h1>Connected in Climate</h1>
        <p className="tagline">Mentor matching for climate tech professionals</p>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <label htmlFor="email">Enter your email to get started</label>
        <div className="input-row">
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
            autoComplete="email"
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Checking...' : 'Enter'}
          </button>
        </div>
        {error && <p className="form-error">{error}</p>}
      </form>

      <p className="help-text">
        Only registered participants can sign in. If you haven't received an
        invitation, contact your program coordinator.
      </p>
    </div>
  )
}
