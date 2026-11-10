function formatDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function MatchCard({ match, userEmail, onOpen }) {
  const isMentee = match.mentee_email === userEmail
  const partnerName = isMentee ? match.mentor_name : match.mentee_name
  const partnerRole = isMentee ? 'Mentor' : 'Mentee'
  const dateRange = match.activated_at && match.end_date
    ? `${formatDate(match.activated_at)} – ${formatDate(match.end_date)}`
    : `Matched ${formatDate(match.created_at)}`

  return (
    <button className="match-card" onClick={() => onOpen(match.match_id)}>
      <div className="match-card-top">
        <span className="match-card-name">{partnerName}</span>
        <span className="match-card-role">{partnerRole}</span>
      </div>
      <div className="match-card-meta">
        <span>{dateRange}</span>
        <span className="match-card-score">{Math.round(match.final_score * 100)}% match</span>
      </div>
    </button>
  )
}
