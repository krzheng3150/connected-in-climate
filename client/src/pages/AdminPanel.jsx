import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const TABS = ['Search', 'Feedback', 'Blocks']

export default function AdminPanel() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('Search')

  const adminHeaders = {
    'Content-Type': 'application/json',
    'x-user-email': user.email,
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Admin Panel</h1>
        <button className="btn-link" onClick={() => navigate('/dashboard')}>&larr; Dashboard</button>
      </header>

      <div className="role-tabs" style={{ marginTop: '1rem' }}>
        {TABS.map(t => (
          <button key={t} className={`role-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <main className="page-body" style={{ paddingTop: '1rem' }}>
        {tab === 'Search' && <SearchTab headers={adminHeaders} />}
        {tab === 'Feedback' && <FeedbackTab headers={adminHeaders} />}
        {tab === 'Blocks' && <BlocksTab headers={adminHeaders} />}
      </main>
    </div>
  )
}

// ── Search Tab ────────────────────────────────────────────────────

function SearchTab({ headers }) {
  const [email, setEmail] = useState('')
  const [profile, setProfile] = useState(null)
  const [matches, setMatches] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    setProfile(null)
    setMatches([])

    try {
      const [profileRes, matchesRes] = await Promise.all([
        fetch(`/api/admin/profiles?email=${encodeURIComponent(email.trim())}`, { headers }),
        fetch(`/api/admin/matches?email=${encodeURIComponent(email.trim())}`, { headers }),
      ])

      if (profileRes.status === 404) {
        setError('Profile not found.')
      } else if (profileRes.ok) {
        const data = await profileRes.json()
        setProfile(data.profile)
      }

      if (matchesRes.ok) {
        const data = await matchesRes.json()
        setMatches(data.matches)
      }
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }

  return (
    <>
      <form className="admin-search-form" onSubmit={handleSearch}>
        <div className="input-row">
          <input
            type="email"
            placeholder="Search by email..."
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && <p className="form-error">{error}</p>}

      {profile && <ProfileCard profile={profile} />}

      {matches.length > 0 && (
        <div className="admin-section">
          <h3>Matches ({matches.length})</h3>
          {matches.map(m => (
            <AdminMatchCard key={m.match_id} match={m} headers={headers} />
          ))}
        </div>
      )}

      {profile && matches.length === 0 && !loading && (
        <p className="placeholder-text" style={{ marginTop: '1rem' }}>No matches found.</p>
      )}
    </>
  )
}

function ProfileCard({ profile }) {
  const p = profile.payload || {}
  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <strong>{profile.name}</strong>
        <span className="role-badge">{profile.role}</span>
      </div>
      <div className="admin-card-meta">
        <span>{profile.email}</span>
        {p.location && <span>{p.location}</span>}
        {p.career_level && <span>{p.career_level}</span>}
      </div>
      {p.career_areas?.length > 0 && (
        <div className="partner-tags" style={{ marginTop: '0.5rem' }}>
          {p.career_areas.map(a => <span key={a} className="tag">{a}</span>)}
        </div>
      )}
    </div>
  )
}

function AdminMatchCard({ match: m, headers }) {
  const [expanded, setExpanded] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectForm, setRejectForm] = useState({ reason: '', block: false })
  const [status, setStatus] = useState(m.status)
  const [actionMsg, setActionMsg] = useState(null)

  async function handleReject(e) {
    e.preventDefault()
    setActionMsg(null)
    try {
      const res = await fetch(`/api/admin/matches/${m.match_id}/reject`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ reason: rejectForm.reason || null, block: rejectForm.block }),
      })
      if (res.ok) {
        const data = await res.json()
        setStatus('REJECTED')
        setRejecting(false)
        setActionMsg(`Rejected${data.block_created ? ' + blocked' : ''}`)
      } else {
        const data = await res.json()
        setActionMsg(data.error || 'Failed to reject')
      }
    } catch {
      setActionMsg('Could not reach the server.')
    }
  }

  const isMentee = m.mentee_email === m.mentee_email
  const score = Math.round(m.final_score * 100)
  const date = new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <span>
          <strong>{m.mentee_name}</strong>
          <span className="admin-arrow"> → </span>
          <strong>{m.mentor_name}</strong>
        </span>
        <span className={`badge badge-${status === 'ACTIVE' ? 'done' : status === 'STORED' ? 'future' : 'next'}`}>
          {status}
        </span>
      </div>
      <div className="admin-card-meta">
        <span>Rank #{m.rank}</span>
        <span>{score}% match</span>
        <span>{date}</span>
        {m.code_commit && <span className="admin-commit">{m.code_commit.slice(0, 7)}</span>}
      </div>

      <div className="admin-card-actions">
        <button className="btn-link" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Hide scores' : 'Show scores'}
        </button>
        {status === 'ACTIVE' && (
          <button className="btn-link" style={{ color: 'var(--error)' }} onClick={() => setRejecting(!rejecting)}>
            {rejecting ? 'Cancel' : 'Reject'}
          </button>
        )}
      </div>

      {expanded && m.computation_payload && (
        <ScoreBreakdown payload={m.computation_payload} />
      )}

      {rejecting && (
        <form className="admin-reject-form" onSubmit={handleReject}>
          <input
            type="text"
            placeholder="Reason (optional)"
            value={rejectForm.reason}
            onChange={e => setRejectForm({ ...rejectForm, reason: e.target.value })}
          />
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={rejectForm.block}
              onChange={e => setRejectForm({ ...rejectForm, block: e.target.checked })}
            />
            Also block this pair
          </label>
          <button type="submit" className="btn-primary" style={{ background: 'var(--error)' }}>
            Confirm Reject
          </button>
        </form>
      )}

      {actionMsg && <p className="feedback-msg">{actionMsg}</p>}
    </div>
  )
}

function ScoreBreakdown({ payload }) {
  const s = payload.scores
  if (!s) return <pre className="admin-json">{JSON.stringify(payload, null, 2)}</pre>

  return (
    <div className="admin-scores">
      <div className="admin-score-row">
        <span>Categorical</span>
        <span>{Math.round(s.categorical.combined * 100)}%</span>
        <span className="admin-weight">w={s.weights_used.categorical}</span>
      </div>
      <div className="admin-score-detail">
        Horizontal: {Math.round(s.categorical.horizontal.jaccard * 100)}%
        {s.categorical.horizontal.intersection.length > 0 && ` (${s.categorical.horizontal.intersection.join(', ')})`}
        {' · '}Vertical: {Math.round(s.categorical.vertical.jaccard * 100)}%
        {s.categorical.vertical.intersection.length > 0 && ` (${s.categorical.vertical.intersection.join(', ')})`}
        {' · '}Sector: {Math.round(s.categorical.sector.jaccard * 100)}%
      </div>

      <div className="admin-score-row">
        <span>Topic</span>
        <span>{Math.round(s.topic.combined * 100)}%</span>
        <span className="admin-weight">w={s.weights_used.topic}</span>
      </div>
      {s.topic.details.length > 0 && (
        <div className="admin-score-detail">
          {s.topic.details.map((d, i) => (
            <div key={i}>#{d.rank} {d.topic}: {d.matched_in === 'none' ? 'no match' : `${d.matched_in} (${d.score})`}</div>
          ))}
        </div>
      )}

      <div className="admin-score-row">
        <span>Semantic</span>
        <span>{s.semantic.cosine_similarity != null ? Math.round(s.semantic.cosine_similarity * 100) + '%' : 'N/A'}</span>
        <span className="admin-weight">w={s.weights_used.semantic}</span>
      </div>

      <div className="admin-score-row">
        <span>Geo</span>
        <span>{s.geo.enabled ? Math.round(s.geo.score * 100) + '%' : 'off'}</span>
        <span className="admin-weight">w={s.weights_used.geo ?? '—'}</span>
      </div>
      {s.geo.enabled && s.geo.reason && (
        <div className="admin-score-detail">{s.geo.reason}</div>
      )}

      <div className="admin-score-row">
        <span>Experience</span>
        <span>{s.experience ? Math.round(s.experience.score * 100) + '%' : 'N/A'}</span>
        <span className="admin-weight">w={s.weights_used.experience}</span>
      </div>
      {s.experience?.details.length > 0 && (
        <div className="admin-score-detail">
          {s.experience.details.map((d, i) => (
            <div key={i}>{d.topic} → {d.field}: {d.matched ? '✓' : '✗'} ({d.mentor_value ?? 'missing'})</div>
          ))}
        </div>
      )}

      <div className="admin-score-row admin-score-final">
        <span>Final</span>
        <span>{Math.round(s.final * 100)}%</span>
        <span className="admin-weight">reliability={s.reliability_multiplier}</span>
      </div>
    </div>
  )
}

// ── Feedback Tab ──────────────────────────────────────────────────

function FeedbackTab({ headers }) {
  const [email, setEmail] = useState('')
  const [feedbacks, setFeedbacks] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    setFeedbacks([])
    setSearched(true)

    try {
      const res = await fetch(`/api/admin/feedback?email=${encodeURIComponent(email.trim())}`, { headers })
      if (res.ok) {
        const data = await res.json()
        setFeedbacks(data.feedbacks)
      } else {
        setError('Failed to load feedback.')
      }
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }

  return (
    <>
      <form className="admin-search-form" onSubmit={handleSearch}>
        <div className="input-row">
          <input
            type="email"
            placeholder="Search feedback by email..."
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      {error && <p className="form-error">{error}</p>}

      {feedbacks.length > 0 && (
        <div className="admin-section">
          <h3>Feedback ({feedbacks.length})</h3>
          {feedbacks.map(fb => (
            <div key={fb.feedback_id} className="admin-card">
              <div className="admin-card-header">
                <strong>{fb.submitter_email}</strong>
                {fb.rating && <span className="feedback-rating">{'★'.repeat(fb.rating)}{'☆'.repeat(5 - fb.rating)}</span>}
              </div>
              <div className="admin-card-meta">
                <span>Match: {fb.mentee_email} → {fb.mentor_email}</span>
                <span>{new Date(fb.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.9375rem' }}>{fb.text}</p>
            </div>
          ))}
        </div>
      )}

      {searched && feedbacks.length === 0 && !loading && !error && (
        <p className="placeholder-text" style={{ marginTop: '1rem' }}>No feedback found.</p>
      )}
    </>
  )
}

// ── Blocks Tab ────────────────────────────────────────────────────

function BlocksTab({ headers }) {
  const [blocks, setBlocks] = useState([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ mentor_email: '', mentee_email: '', reason: '' })
  const [formMsg, setFormMsg] = useState(null)

  const loadBlocks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/blocks', { headers })
      if (res.ok) {
        const data = await res.json()
        setBlocks(data.blocks)
      }
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
    setLoaded(true)
  }, [])

  if (!loaded && !loading) loadBlocks()

  async function handleAdd(e) {
    e.preventDefault()
    setFormMsg(null)
    if (!form.mentor_email.trim() || !form.mentee_email.trim()) return

    try {
      const res = await fetch('/api/admin/blocks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mentor_email: form.mentor_email.trim(),
          mentee_email: form.mentee_email.trim(),
          reason: form.reason.trim() || null,
        }),
      })
      if (res.ok) {
        setForm({ mentor_email: '', mentee_email: '', reason: '' })
        setFormMsg('Block added.')
        loadBlocks()
      } else {
        const data = await res.json()
        setFormMsg(data.error || 'Failed to add block.')
      }
    } catch {
      setFormMsg('Could not reach the server.')
    }
  }

  async function handleDelete(id) {
    try {
      const res = await fetch(`/api/admin/blocks/${id}`, { method: 'DELETE', headers })
      if (res.ok) loadBlocks()
    } catch { /* ignore */ }
  }

  return (
    <>
      <div className="admin-section">
        <h3>Add Block</h3>
        <form className="admin-block-form" onSubmit={handleAdd}>
          <input
            type="email"
            placeholder="Mentor email"
            value={form.mentor_email}
            onChange={e => setForm({ ...form, mentor_email: e.target.value })}
            required
          />
          <input
            type="email"
            placeholder="Mentee email"
            value={form.mentee_email}
            onChange={e => setForm({ ...form, mentee_email: e.target.value })}
            required
          />
          <input
            type="text"
            placeholder="Reason (optional)"
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
          />
          <button type="submit" className="btn-primary">Add Block</button>
          {formMsg && <p className="feedback-msg">{formMsg}</p>}
        </form>
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="admin-section">
        <h3>Block List ({blocks.length})</h3>
        {blocks.length === 0 && loaded && !loading && (
          <p className="placeholder-text">No blocks.</p>
        )}
        {blocks.map(b => (
          <div key={b.id} className="admin-card">
            <div className="admin-card-header">
              <span>{b.mentee_email} → {b.mentor_email}</span>
              <button className="btn-link" style={{ color: 'var(--error)' }} onClick={() => handleDelete(b.id)}>
                Remove
              </button>
            </div>
            <div className="admin-card-meta">
              {b.reason && <span>{b.reason}</span>}
              <span>by {b.created_by}</span>
              <span>{new Date(b.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
