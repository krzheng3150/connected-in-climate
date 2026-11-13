import NavBar from '../components/NavBar.jsx'
import carlyPhoto from '../assets/team/carly-cohen.jpg'
import minaPhoto from '../assets/team/mina-johnson.webp'
import kevinPhoto from '../assets/team/kevin-zheng.jpg'

const TEAM = [
  {
    name: 'Carly Cohen',
    title: 'Founder',
    photo: carlyPhoto,
    linkedin: 'https://www.linkedin.com/in/carly-cohen-e-i-t/',
    bio: `I'm an Engineer with a passion for working in Climate. My career spans construction, workforce development, and the nonprofit sector.\n\nI too have experienced firsthand how exhausting and isolating the modern job search can be — so I set out to change that narrative.\n\nDuring my Climatebase Fellowship, I founded Connected in Climate — a mentorship platform dedicated to making the climate job search more human and ensuring climate job seekers feel truly seen and heard.\n\nI am so grateful to have found such incredible people to help me bring Connected in Climate to life.\n\nWe are here to be the bridge between experienced climate professionals and passionate climate job seekers.\n\nTogether let's make the transition into climate easier — one human connection at a time.`,
  },
  {
    name: 'Mina Johnson',
    title: 'Digital Marketing',
    photo: minaPhoto,
    linkedin: 'https://www.linkedin.com/in/minajohnson1/',
    bio: `Mina is a digital marketing leader with over a decade of experience using storytelling and technology to advance missions that matter. She has built her career across the nonprofit sector — from championing food security at the Greater Boston Food Bank to advancing educational equity at Educators for Excellence — and has developed a deep belief that effective communication is one of the most powerful tools for social change.\n\nHer commitment to conservation took root during her three years as Communications Coordinator at the Seneca Park Zoo Society, where she partnered with organizational leadership to amplify the Zoo's mission and found in the natural world a cause she still carries with her.`,
  },
  {
    name: 'Kevin Zheng',
    title: 'Software Engineer',
    photo: kevinPhoto,
    linkedin: 'https://www.linkedin.com/in/kevin-zheng-1b66a770/',
    bio: 'Kevin is a software engineer with over a decade of experience working across a multitude of tech stacks on projects spanning a diverse set of business problems. Kevin prides on being an end-to-end owner that wears multiple hats to quickly build scalable software for any business problem.\n\nAfter years of working in non-climate tech companies, Kevin realized software is the golden opportunity for an individual to make a wide-scale influence to the battle against climate change. He is actively pivoting to a climate tech career, bringing his sense of ownership, neverending curiosity, and ability to quickly understand any business and tech domain to tackle climate problems with simple and scalable software.',
  },
]

export default function About() {
  return (
    <div className="landing landing-wide">
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

      <section className="team-section">
        <h2>Meet the Team</h2>
        <div className="team-grid">
          {TEAM.map((member) => (
            <div className="team-card" key={member.name}>
              <img
                className="team-photo"
                src={member.photo}
                alt={member.name}
              />
              <h3 className="team-name">{member.name}</h3>
              <p className="team-title">{member.title}</p>
              {member.bio && (
                <div className="team-bio">
                  {member.bio.split('\n\n').map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              )}
              <a
                className="team-linkedin"
                href={member.linkedin}
                target="_blank"
                rel="noopener noreferrer"
              >
                LinkedIn &rarr;
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
