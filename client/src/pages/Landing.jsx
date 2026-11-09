import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SignIn } from '@clerk/react'
import NavBar from '../components/NavBar.jsx'
import HowItWorksPanel from '../components/HowItWorksPanel.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { TEST_MODE } from '../config.js'

const FEATURES = [
  {
    icon: '\u{1F91D}',
    title: 'Mentor Matching',
    description: '1-on-1 calls with a mentor dedicated to your climate career goals',
  },
  {
    icon: '\u{1F331}',
    title: 'Intentional Connections',
    description: "A supportive job search community — we’re all in this together",
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

export default function Landing() {
  const [hiwOpen, setHiwOpen] = useState(false)
  const [hiwRole, setHiwRole] = useState(null)
  const [email, setEmail] = useState('')
  const [testError, setTestError] = useState(null)
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const { testLogin, error: authError } = useAuth()
  const navigate = useNavigate()

  const isAdminError = authError && authError.includes('admin')
  const showAdmin = showAdminLogin || isAdminError

  function openHiw(role) {
    setHiwRole(role)
    setHiwOpen(true)
  }

  function handleTestLogin(e) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) return
    setTestError(null)
    testLogin(trimmed)
    navigate('/dashboard')
  }


  return (
    <div className="landing">
      <NavBar />

      <div className="landing-hero">
        <h1>Connected in Climate</h1>
        <p className="tagline">Human connections to land climate jobs</p>
      </div>

      <blockquote className="landing-quote">
        &ldquo;Somewhere, someone is looking for exactly what you have to offer.&rdquo;
      </blockquote>

      <p className="landing-intro">
        Connected in Climate is a mentorship program built on authentic connections designed to help
        those navigating the climate sector build their network and find their next opportunity.
        The program is designed to create lasting relationships for job seekers at all levels.
      </p>

      <div className="landing-features">
        {FEATURES.map(f => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>

      <div className="hiw-teaser">
        <h3>How Connected in Climate Works</h3>
        <p>See the step-by-step process from application to mentorship.</p>
        <div className="hiw-teaser-links">
          <button className="btn-secondary hiw-teaser-btn" onClick={() => openHiw('mentee')}>I'm a Mentee</button>
          <button className="btn-secondary hiw-teaser-btn" onClick={() => openHiw('mentor')}>I'm a Mentor</button>
        </div>
      </div>

      <HowItWorksPanel open={hiwOpen} onClose={() => setHiwOpen(false)} initialRole={hiwRole} />

      <hr className="landing-divider" />

      {TEST_MODE ? (
        <div className="test-login-wrapper">
          <form onSubmit={handleTestLogin} className="test-login-form">
            <label>Enter your email to get started</label>
            <div className="input-row">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
              <button type="submit" className="btn-primary">Go</button>
            </div>
            {(testError || authError) && <p className="form-error">{testError || authError}</p>}
          </form>
          {showAdmin && (
            <>
              <div className="test-login-divider">
                <span>admin sign-in</span>
              </div>
              <div className="clerk-signin-wrapper">
                <SignIn
                  routing="hash"
                  appearance={{
                    elements: {
                      rootBox: { width: '100%', maxWidth: '420px', margin: '0 auto' },
                    },
                  }}
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="clerk-signin-wrapper">
          <SignIn
            routing="hash"
            appearance={{
              elements: {
                rootBox: { width: '100%', maxWidth: '420px', margin: '0 auto' },
              },
            }}
          />
        </div>
      )}
    </div>
  )
}
