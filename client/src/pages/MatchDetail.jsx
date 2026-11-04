import { useParams, useNavigate } from 'react-router-dom'
import MatchDetailPanel from '../components/MatchDetailPanel.jsx'

export default function MatchDetail() {
  const { matchId } = useParams()
  const navigate = useNavigate()

  return (
    <div className="page">
      <header className="page-header">
        <button className="btn-link" onClick={() => navigate('/dashboard')}>&larr; Dashboard</button>
      </header>
      <main className="page-body">
        <MatchDetailPanel matchId={matchId} onClose={() => navigate('/dashboard')} />
      </main>
    </div>
  )
}
