import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const FEATURES = [
  {
    icon: '\u{1F91D}',
    title: 'Mentor Matching',
    description: '1-on-1 calls with a mentor dedicated to your climate career goals',
  },
  {
    icon: '\u{1F331}',
    title: 'Intentional Connections',
    description: 'A supportive job search community—you’re not alone in this',
  },
  {
    icon: '\u{1F3AF}',
    title: 'Customized Support',
    description: 'Programs designed to meet your unique needs and career goals',
  },
]

function FeatureCard({ icon, title, description }) {
  return (
    <div className="landing-feature">
      <span className="landing-feature-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

function LoginForm() {
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
          {loading ? 'Checking…' : "Let’s Connect"}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
    </form>
  )
}

export default function Landing() {
  return (
    <div className="landing">
      <div className="landing-hero">
        <h1>Connected in Climate</h1>
        <p className="tagline">Human connections to land climate jobs</p>
      </div>

      <blockquote className="landing-quote">
        &ldquo;Somewhere, someone is looking for exactly what you have to offer.&rdquo;
      </blockquote>

      <div className="landing-features">
        {FEATURES.map(f => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>

      <hr className="landing-divider" />

      <LoginForm />

    </div>
  )
}
