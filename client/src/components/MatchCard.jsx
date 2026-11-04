export default function MatchCard({ match, userEmail, onOpen }) {
  const isMentee = match.mentee_email === userEmail
  const partnerName = isMentee ? match.mentor_name : match.mentee_name
  const partnerRole = isMentee ? 'Mentor' : 'Mentee'
  const date = new Date(match.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <button className="match-card" onClick={() => onOpen(match.match_id)}>
      <div className="match-card-top">
        <span className="match-card-name">{partnerName}</span>
        <span className="match-card-role">{partnerRole}</span>
      </div>
      <div className="match-card-meta">
        <span>Matched {date}</span>
        <span className="match-card-score">{Math.round(match.final_score * 100)}% match</span>
      </div>
    </button>
  )
}
