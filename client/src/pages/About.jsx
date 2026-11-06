import NavBar from '../components/NavBar.jsx'

export default function About() {
  return (
    <div className="landing">
      <NavBar />

      <div className="landing-story" style={{ paddingTop: '1rem' }}>
        <h2>Our Story</h2>
        <p>
          Our Founder built Connected in Climate to provide others with what she wished she had
          while going through a years-long job search &mdash; genuine relationships with mentors
          in the climate sector and access to an engaging, highly connected network.
        </p>
        <p>
          The job market can be challenging and even feel defeating at times. Our goal with Connected
          in Climate is to support you in overcoming those challenges by connecting you with trusted
          professionals across climate, clean energy, and sustainability &ndash; getting you one step
          closer to finding your next meaningful role.
        </p>
      </div>
    </div>
  )
}
