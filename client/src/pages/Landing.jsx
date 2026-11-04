import { SignIn, useAuth as useClerkAuth } from '@clerk/react'
import { Navigate } from 'react-router-dom'

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

export default function Landing() {
  const { isSignedIn } = useClerkAuth()

  if (isSignedIn) return <Navigate to="/dashboard" replace />

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
    </div>
  )
}
