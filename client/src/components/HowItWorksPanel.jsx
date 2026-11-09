import { useState, useEffect } from 'react'

const MENTEE_STEPS = [
  {
    icon: '📋',
    title: 'Apply',
    body: 'Fill out the mentee application form so we can learn about your background, goals, and what you\'re looking for in a mentor.',
  },
  {
    icon: '🔍',
    title: 'Review',
    body: 'A member of our team will review your application and reach out with next steps.',
  },
  {
    icon: '📞',
    title: 'First Call + Onboarding',
    body: 'Accepted mentees will have an introductory call with a member of the team to better understand your specific goals and what you hope to get out of the program, as well as complete onboarding.',
  },
  {
    icon: '🤝',
    title: 'Select Your Mentor',
    body: 'Our team will send you three mentor profiles to choose from. You\'ll have the chance to do quick intro calls with each mentor so you can find the best fit.',
  },
  {
    icon: '📅',
    title: 'Begin Meeting',
    body: 'Connect with your selected mentor and schedule your regular calls.',
  },
  {
    icon: '📈',
    title: 'Track Progress',
    body: 'You are not alone — our team is here to support you on your climate career journey and will check in with you to see how things are going.',
  },
]

const MENTOR_STEPS = [
  {
    icon: '📋',
    title: 'Apply',
    body: 'Fill out the mentor application form so we can learn about your experience and what you bring to mentoring.',
  },
  {
    icon: '🔍',
    title: 'Review',
    body: 'A member of our team will review your application and reach out with next steps.',
  },
  {
    icon: '📞',
    title: 'First Call + Onboarding',
    body: 'Accepted mentors will have an introductory call with a member of the team to go over our resources and the program setup, as well as complete onboarding.',
  },
  {
    icon: '🤝',
    title: 'Meet Your Mentee',
    body: 'Connect with your mentee and schedule your regular calls.',
  },
  {
    icon: '📈',
    title: 'Track Progress',
    body: 'Our team is here to support you and provide resources that will help you more effectively guide your mentee.',
  },
]

function StepTimeline({ steps }) {
  return (
    <div className="hiw-timeline">
      {steps.map((s, i) => (
        <div key={i} className="hiw-step">
          <div className="hiw-step-marker">
            <span className="hiw-step-icon">{s.icon}</span>
            {i < steps.length - 1 && <div className="hiw-step-line" />}
          </div>
          <div className="hiw-step-content">
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function HowItWorksPanel({ open, onClose, initialRole }) {
  const [menteeOpen, setMenteeOpen] = useState(false)
  const [mentorOpen, setMentorOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setMenteeOpen(initialRole === 'mentee' || !initialRole)
      setMentorOpen(initialRole === 'mentor')
    }
  }, [open, initialRole])

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [open])

  if (!open) return null

  return (
    <div className="hiw-overlay" onClick={onClose}>
      <div className="hiw-drawer" onClick={e => e.stopPropagation()}>
        <div className="hiw-drawer-header">
          <h2>How It Works</h2>
          <button className="hiw-drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="hiw-drawer-body">
          <div className="hiw-panel">
            <button
              className={`hiw-panel-toggle ${menteeOpen ? 'open' : ''}`}
              onClick={() => setMenteeOpen(o => !o)}
            >
              <span className="hiw-panel-label">
                <span className="hiw-panel-icon">🎓</span>
                For Mentees
              </span>
              <span className="hiw-panel-chevron">{menteeOpen ? '▲' : '▼'}</span>
            </button>
            {menteeOpen && (
              <div className="hiw-panel-body">
                <StepTimeline steps={MENTEE_STEPS} />
              </div>
            )}
          </div>

          <div className="hiw-panel">
            <button
              className={`hiw-panel-toggle ${mentorOpen ? 'open' : ''}`}
              onClick={() => setMentorOpen(o => !o)}
            >
              <span className="hiw-panel-label">
                <span className="hiw-panel-icon">🌱</span>
                For Mentors
              </span>
              <span className="hiw-panel-chevron">{mentorOpen ? '▲' : '▼'}</span>
            </button>
            {mentorOpen && (
              <div className="hiw-panel-body">
                <StepTimeline steps={MENTOR_STEPS} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
