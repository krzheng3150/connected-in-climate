import { Link } from 'react-router-dom'

export default function About() {
  return (
    <div className="landing">
      <nav className="landing-nav">
        <Link to="/" className="landing-nav-brand">Connected in Climate</Link>
        <Link to="/about" className="landing-nav-link active">About Us</Link>
      </nav>

      <div className="landing-story" style={{ paddingTop: '1rem' }}>
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
    </div>
  )
}
