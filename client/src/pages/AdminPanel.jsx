import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { ProfileDetail } from '../components/ProfileFields.jsx'

const TABS = ['Pending', 'Search', 'Feedback', 'Blocks']

export default function AdminPanel() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('Pending')

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
        {tab === 'Pending' && <PendingTab headers={adminHeaders} />}
        {tab === 'Search' && <SearchTab headers={adminHeaders} />}
        {tab === 'Feedback' && <FeedbackTab headers={adminHeaders} />}
        {tab === 'Blocks' && <BlocksTab headers={adminHeaders} />}
      </main>
    </div>
  )
}

// ── Pending Tab ──────────────────────────────────────────────────

function PendingTab({ headers }) {
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reviewResult, setReviewResult] = useState(null)

  const loadPending = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/pending', { headers })
      if (res.ok) {
        const data = await res.json()
        setRuns(data.pending_runs)
      } else {
        setError('Failed to load pending runs.')
      }
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadPending() }, [loadPending])

  function handleReviewDone(msg) {
    setReviewResult(msg)
    loadPending()
  }

  if (loading) return <p className="placeholder-text">Loading pending runs...</p>
  if (error) return <p className="form-error">{error}</p>

  return (
    <div className="admin-section">
      {reviewResult && <p className="feedback-msg">{reviewResult}</p>}
      {runs.length === 0 && !reviewResult && (
        <p className="placeholder-text">No runs pending review.</p>
      )}
      {runs.length === 0 && reviewResult && (
        <p className="placeholder-text" style={{ marginTop: '0.5rem' }}>No more runs pending.</p>
      )}
      {runs.length > 0 && (
        <h3>Pending Review ({runs.length} run{runs.length !== 1 ? 's' : ''})</h3>
      )}
      {runs.map(run => (
        <RunReviewCard key={run.run_id} run={run} headers={headers} onUpdate={handleReviewDone} />
      ))}
    </div>
  )
}

function RunReviewCard({ run, headers, onUpdate }) {
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState(null)
  const [expandedScores, setExpandedScores] = useState(new Set())

  function toggleCandidate(matchId) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }

  function toggleScores(matchId) {
    setExpandedScores(prev => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }

  async function handleSubmit() {
    setSubmitting(true)
    setResultMsg(null)
    try {
      const res = await fetch(`/api/admin/runs/${run.run_id}/review`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ approved: [...selected] }),
      })
      if (res.ok) {
        const data = await res.json()
        let msg
        if (data.run_status === 'CANCELLED') {
          msg = 'All candidates rejected. Run cancelled.'
        } else if (data.run_status === 'ACTIVE') {
          msg = '1 approved — auto-activated!'
        } else {
          msg = `${data.approved_count} approved, ${data.rejected_count} rejected. Awaiting mentee selection.`
        }
        onUpdate(msg)
      } else {
        const data = await res.json()
        setResultMsg(data.error || 'Review failed.')
      }
    } catch {
      setResultMsg('Could not reach the server.')
    }
    setSubmitting(false)
  }

  const date = new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="admin-card" style={{ padding: '1rem' }}>
      <div className="admin-card-header">
        <strong>{run.mentee_name}</strong>
        <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
          {run.mentee_email} &middot; {date} &middot; {run.candidates.length} candidates / {run.total_scored} scored
        </span>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        {run.candidates.map(m => {
          const score = Math.round(m.final_score * 100)
          const isSelected = selected.has(m.match_id)
          const showScores = expandedScores.has(m.match_id)

          return (
            <div key={m.match_id} style={{ borderTop: '1px solid var(--border)', paddingTop: '0.5rem', marginTop: '0.5rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleCandidate(m.match_id)}
                />
                <strong>{m.mentor_name}</strong>
                <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                  Rank #{m.rank} &middot; {score}%
                </span>
              </label>
              <div className="admin-card-actions" style={{ marginTop: '0.25rem', marginLeft: '1.5rem' }}>
                <button className="btn-link" onClick={() => toggleScores(m.match_id)}>
                  {showScores ? 'Hide scores' : 'Show scores'}
                </button>
              </div>
              {showScores && m.computation_payload && (
                <div style={{ marginLeft: '1.5rem' }}>
                  <ScoreBreakdown payload={m.computation_payload} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Submitting...' : `Submit Review (${selected.size} approved)`}
        </button>
        {selected.size === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
            Submitting with none selected will cancel this run.
          </span>
        )}
      </div>

      {resultMsg && <p className="feedback-msg" style={{ marginTop: '0.5rem' }}>{resultMsg}</p>}
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
  const joinDate = new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <strong>{profile.name}</strong>
        <span className="role-badge">{profile.role}</span>
      </div>
      <div className="admin-card-meta">
        <span>{profile.email}</span>
        <span>Joined {joinDate}</span>
      </div>
      <ProfileDetail payload={profile.payload} />
    </div>
  )
}

function statusBadgeClass(status) {
  switch (status) {
    case 'ACTIVE': return 'badge-done'
    case 'APPROVED': return 'badge-done'
    case 'CANDIDATE': return 'badge-next'
    case 'STORED': return 'badge-future'
    default: return 'badge-next'
  }
}

function AdminMatchCard({ match: m, headers }) {
  const [showScores, setShowScores] = useState(false)
  const [showProfiles, setShowProfiles] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectForm, setRejectForm] = useState({ reason: '', block: false })
  const [status, setStatus] = useState(m.status)
  const [actionMsg, setActionMsg] = useState(null)

  async function fetchDetail() {
    if (detail) return
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/admin/matches/${m.match_id}`, { headers })
      if (res.ok) setDetail(await res.json())
    } catch { /* ignore */ }
    setDetailLoading(false)
  }

  async function handleToggleProfiles() {
    if (!showProfiles) await fetchDetail()
    setShowProfiles(!showProfiles)
  }

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
        <span className={`badge ${statusBadgeClass(status)}`}>
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
        <button className="btn-link" onClick={() => setShowScores(!showScores)}>
          {showScores ? 'Hide scores' : 'Show scores'}
        </button>
        <button className="btn-link" onClick={handleToggleProfiles} disabled={detailLoading}>
          {detailLoading ? 'Loading...' : showProfiles ? 'Hide profiles' : 'Show profiles'}
        </button>
        {status === 'ACTIVE' && (
          <button className="btn-link" style={{ color: 'var(--error)' }} onClick={() => setRejecting(!rejecting)}>
            {rejecting ? 'Cancel' : 'Reject'}
          </button>
        )}
      </div>

      {showScores && m.computation_payload && (
        <ScoreBreakdown payload={m.computation_payload} />
      )}

      {showProfiles && detail && (
        <div className="admin-match-profiles">
          <div className="admin-match-profile-pair">
            <div>
              <h4>Mentee</h4>
              <ProfileCard
                profile={{ email: detail.mentee_email, name: detail.mentee_name, role: 'mentee', payload: detail.mentee_payload || {}, created_at: m.created_at }}
              />
            </div>
            <div>
              <h4>Mentor</h4>
              <ProfileCard
                profile={{ email: detail.mentor_email, name: detail.mentor_name, role: 'mentor', payload: detail.mentor_payload || {}, created_at: m.created_at }}
              />
            </div>
          </div>
        </div>
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
  const [showRaw, setShowRaw] = useState(false)

  if (!s) return <pre className="admin-json">{JSON.stringify(payload, null, 2)}</pre>

  const pct = (v) => v != null ? Math.round(v * 100) + '%' : 'N/A'

  return (
    <div className="admin-scores">
      <div className="admin-score-row">
        <span>Categorical</span>
        <span>{pct(s.categorical.combined)}</span>
        <span className="admin-weight">w={s.weights_used.categorical}</span>
      </div>
      <CategoricalDetail label="Horizontal" data={s.categorical.horizontal} />
      <CategoricalDetail label="Vertical" data={s.categorical.vertical} />
      <CategoricalDetail label="Sector" data={s.categorical.sector} />

      <div className="admin-score-row">
        <span>Topic</span>
        <span>{pct(s.topic.combined)}</span>
        <span className="admin-weight">w={s.weights_used.topic}{s.topic.harmonic_n ? ` · H(${s.topic.details.length})=${s.topic.harmonic_n}` : ''}</span>
      </div>
      {s.topic.details.length > 0 && (
        <div className="admin-score-detail">
          {s.topic.details.map((d, i) => (
            <div key={i}>
              #{d.rank} {d.topic}: {d.matched_in === 'none'
                ? 'no match'
                : `${d.matched_in} → ${d.score}`}
              {' '}(discounted: {d.discounted})
            </div>
          ))}
        </div>
      )}

      <div className="admin-score-row">
        <span>Semantic</span>
        <span>{pct(s.semantic.cosine_similarity)}</span>
        <span className="admin-weight">w={s.weights_used.semantic}</span>
      </div>
      {s.semantic.reason && (
        <div className="admin-score-detail">{s.semantic.reason}</div>
      )}

      <div className="admin-score-row">
        <span>Geo</span>
        <span>{s.geo.enabled ? pct(s.geo.score) : 'off'}</span>
        <span className="admin-weight">w={s.weights_used.geo ?? '—'}</span>
      </div>
      {s.geo.enabled && (
        <div className="admin-score-detail">
          {s.geo.reason}
          {s.geo.mentee_location && ` · Mentee: ${s.geo.mentee_location}`}
          {s.geo.mentor_location && ` · Mentor: ${s.geo.mentor_location}`}
        </div>
      )}

      <div className="admin-score-row">
        <span>Experience</span>
        <span>{s.experience ? pct(s.experience.score) : 'N/A'}</span>
        <span className="admin-weight">w={s.weights_used.experience}{s.experience ? ` · ${s.experience.matched}/${s.experience.checked} matched` : ''}</span>
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
        <span>{pct(s.final)}</span>
        <span className="admin-weight">reliability={s.reliability_multiplier}</span>
      </div>

      {payload.prior_matches?.length > 0 && (
        <div className="admin-score-detail" style={{ marginTop: '0.5rem' }}>
          Prior matches: {payload.prior_matches.map((pm, i) => (
            <span key={i}>{i > 0 && ', '}{pm.status} ({new Date(pm.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})</span>
          ))}
        </div>
      )}

      <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
        <button className="btn-link" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide raw payload' : 'Show raw payload'}
        </button>
        {showRaw && <pre className="admin-json">{JSON.stringify(payload, null, 2)}</pre>}
      </div>
    </div>
  )
}

function CategoricalDetail({ label, data }) {
  if (!data) return null
  return (
    <div className="admin-score-detail">
      {label}: {Math.round(data.jaccard * 100)}% (w={data.weight})
      {data.intersection?.length > 0 && <> — overlap: {data.intersection.join(', ')}</>}
      {(data.mentee?.length > 0 || data.mentor?.length > 0) && (
        <div style={{ marginLeft: '1rem', color: 'var(--muted)' }}>
          Mentee: [{(data.mentee ?? []).join(', ')}] · Mentor: [{(data.mentor ?? []).join(', ')}]
        </div>
      )}
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
