import { SignIn } from '@clerk/react'

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
  return (
    <div className="landing">
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

      <div className="landing-story">
        <h2>Our Story</h2>
        <p>
          Our Founder built Connected in Climate to provide others with what she wished she had
          while going through a years-long job search &mdash; genuine relationships with mentors
          in the climate sector and access to an engaging, highly connected network.
        </p>
        <p>
          The current job market throws one challenge after another at us and can be dehumanizing.
          Our goal with Connected in Climate is to help you navigate those challenges by connecting
          you with trusted professionals across climate, clean energy, and sustainability &ndash;
          getting you one step closer to finding your next meaningful role.
        </p>
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
