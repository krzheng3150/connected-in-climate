import { useState, useCallback, useEffect } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { lbl, ProfileDetail } from '../components/ProfileFields.jsx'
import ConfirmationModal from '../components/ConfirmationModal.jsx'
import NavBar from '../components/NavBar.jsx'

const TABS = ['Applications', 'Pending', 'Profiles', 'Search', 'Feedback', 'Blocks']

export default function AdminPanel() {
  const { user } = useAuth()
  const [tab, setTab] = useState('Pending')

  const adminHeaders = {
    'Content-Type': 'application/json',
    'x-user-email': user.email,
  }

  return (
    <div className="page">
      <NavBar />

      <div className="role-tabs" style={{ marginTop: '1rem' }}>
        {TABS.map(t => (
          <button key={t} className={`role-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <main className="page-body" style={{ paddingTop: '1rem' }}>
        {tab === 'Applications' && <ApplicationsTab headers={adminHeaders} />}
        {tab === 'Pending' && <PendingTab headers={adminHeaders} />}
        {tab === 'Profiles' && <ProfilesTab headers={adminHeaders} />}
        {tab === 'Search' && <SearchTab headers={adminHeaders} />}
        {tab === 'Feedback' && <FeedbackTab headers={adminHeaders} />}
        {tab === 'Blocks' && <BlocksTab headers={adminHeaders} />}
      </main>
    </div>
  )
}

// ── Applications Tab ─────────────────────────────────────────────

function ApplicationsTab({ headers }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [actionMsg, setActionMsg] = useState(null)
  const [expanded, setExpanded] = useState(new Set())

  const loadProfiles = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/applications', { headers })
      if (res.ok) {
        const data = await res.json()
        setProfiles(data.profiles.filter(p => p.status === 'PENDING'))
      } else {
        setError('Failed to load applications.')
      }
    } catch {
      setError('Could not reach the server.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadProfiles() }, [loadProfiles])

  async function handleApprove(email, name) {
    setActionMsg(null)
    try {
      const res = await fetch(`/api/admin/applications/${encodeURIComponent(email)}/approve`, {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        setActionMsg(`Approved ${name} (${email})`)
        loadProfiles()
      } else {
        const data = await res.json()
        setActionMsg(data.error || 'Failed to approve.')
      }
    } catch {
      setActionMsg('Could not reach the server.')
    }
  }

  function toggleExpand(email) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(email)) next.delete(email)
      else next.add(email)
      return next
    })
  }

  if (loading) return <p className="placeholder-text">Loading applications...</p>
  if (error) return <p className="form-error">{error}</p>

  return (
    <div className="admin-section">
      {actionMsg && <p className="feedback-msg">{actionMsg}</p>}
      {profiles.length === 0 && (
        <p className="placeholder-text">No pending applications.</p>
      )}
      {profiles.length > 0 && (
        <h3>Pending Applications ({profiles.length})</h3>
      )}
      {profiles.map(p => {
        const date = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        return (
          <div key={p.email} className="admin-card" style={{ padding: '1rem' }}>
            <div className="admin-card-header">
              <strong>{p.name}</strong>
              <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
                {p.email} &middot; <span className="role-badge">{p.role}</span> &middot; {date}
                {p.payload?.timezone && <> &middot; {p.payload.timezone}</>}
              </span>
            </div>
            <div className="admin-card-actions" style={{ marginTop: '0.25rem' }}>
              <button className="btn-link" onClick={() => toggleExpand(p.email)}>
                {expanded.has(p.email) ? 'Hide profile' : 'Show profile'}
              </button>
              <button className="btn-primary" onClick={() => handleApprove(p.email, p.name)}>
                Approve
              </button>
            </div>
            {expanded.has(p.email) && <ProfileDetail payload={p.payload} />}
          </div>
        )
      })}
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

function MenteeProfileSummary({ payload, name, email }) {
  const p = payload || {}
  const topClimates = (p.climate_areas || []).slice(0, 3)
  const topTopics = (p.top_topics || []).slice(0, 5)

  return (
    <div className="review-mentee-panel">
      <h3 className="review-mentee-name">{name}</h3>
      {p.pronouns && <span className="review-meta-line">{p.pronouns}</span>}

      <div className="review-field-group">
        {p.timezone && <div className="review-field"><span className="review-field-label">Timezone</span><span>{p.timezone}</span></div>}
        {p.links?.linkedin && <div className="review-field"><span className="review-field-label">LinkedIn</span><a href={p.links.linkedin} target="_blank" rel="noopener noreferrer">{p.links.linkedin.replace(/^https?:\/\/(www\.)?/, '')}</a></div>}
        {email && <div className="review-field"><span className="review-field-label">Email</span><span>{email}</span></div>}
      </div>

      <div className="review-field-group">
        <span className="review-field-label">Background</span>
        <div className="review-meta-tags">
          {p.education_level && <span className="tag">{lbl('education_level', p.education_level)}</span>}
          {p.years_experience && <span className="tag">{lbl('years_experience', p.years_experience)} exp.</span>}
          {p.employment_situation && <span className="tag">{lbl('employment_situation', p.employment_situation)}</span>}
          {p.career_level && <span className="tag">{lbl('career_level', p.career_level)}</span>}
        </div>
      </div>

      {topClimates.length > 0 && (
        <div className="review-field-group">
          <span className="review-field-label">Climate Areas{p.climate_areas?.length > 3 ? ` (top 3 of ${p.climate_areas.length})` : ''}</span>
          <div className="review-meta-tags">
            {topClimates.map(id => <span key={id} className="tag tag-climate">{lbl('climate_areas', id)}</span>)}
          </div>
        </div>
      )}

      {topTopics.length > 0 && (
        <div className="review-field-group">
          <span className="review-field-label">Wants Help With</span>
          <ol className="review-topic-list">
            {topTopics.map(id => <li key={id}>{lbl('topics', id)}</li>)}
          </ol>
        </div>
      )}

      {p.motivation && (
        <div className="review-field-group">
          <span className="review-field-label">Motivation</span>
          <p className="review-text-block">{p.motivation}</p>
        </div>
      )}

      {p.statement_of_intent && (
        <div className="review-field-group">
          <span className="review-field-label">Statement of Intent</span>
          <p className="review-text-block">{p.statement_of_intent}</p>
        </div>
      )}

      {p.fun_fact && (
        <div className="review-field-group">
          <span className="review-field-label">Fun Fact</span>
          <p className="review-text-block">{p.fun_fact}</p>
        </div>
      )}
    </div>
  )
}

function MentorCandidateCard({ match: m, isSelected, onToggle, expandedScores, onToggleScores, expandedProfile, onToggleProfile }) {
  const p = m.mentor_payload || {}
  const score = Math.round(m.final_score * 100)

  return (
    <div className={`review-mentor-card ${isSelected ? 'review-mentor-card-selected' : ''}`}>
      <div className="review-mentor-header">
        <label className="review-mentor-check">
          <input type="checkbox" checked={isSelected} onChange={onToggle} />
          <strong>Mentor {m.rank}</strong>
          <span className="review-mentor-score">Rank #{m.rank} &middot; {score}%</span>
        </label>
      </div>

      <div className="review-mentor-summary">
        <div className="review-field"><span className="review-field-label">Name</span><span>{m.mentor_name}</span></div>
        {p.timezone && <div className="review-field"><span className="review-field-label">Timezone</span><span>{p.timezone}</span></div>}
        {(p.links?.linkedin || m.mentor_email) && (
          <div className="review-field">
            <span className="review-field-label">LinkedIn / Contact</span>
            {p.links?.linkedin
              ? <a href={p.links.linkedin} target="_blank" rel="noopener noreferrer">{p.links.linkedin.replace(/^https?:\/\/(www\.)?/, '')}</a>
              : <span>{m.mentor_email}</span>}
          </div>
        )}
      </div>

      <div className="review-mentor-actions">
        <button className="btn-link" onClick={onToggleProfile}>
          {expandedProfile ? 'Hide details' : 'Show details'}
        </button>
        <button className="btn-link" onClick={onToggleScores}>
          {expandedScores ? 'Hide algorithm details' : 'Algorithm details'}
        </button>
      </div>

      {expandedProfile && (
        <div className="review-mentor-detail">
          <ProfileDetail payload={p} exclude={['timezone', 'links']} />
        </div>
      )}

      {expandedScores && m.computation_payload && (
        <div className="review-mentor-detail">
          <ScoreBreakdown payload={m.computation_payload} />
        </div>
      )}
    </div>
  )
}

function RunReviewCard({ run, headers, onUpdate }) {
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [resultMsg, setResultMsg] = useState(null)
  const [expandedScores, setExpandedScores] = useState(new Set())
  const [expandedProfiles, setExpandedProfiles] = useState(new Set())
  const [showConfirm, setShowConfirm] = useState(false)

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

  function toggleProfile(matchId) {
    setExpandedProfiles(prev => {
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
    <div className="review-run-card">
      <div className="review-run-header">
        <span className="review-run-title">Match Run — {run.mentee_name}</span>
        <span className="review-run-meta">{date} &middot; {run.candidates.length} candidates / {run.total_scored} scored</span>
      </div>

      <div className="review-layout">
        <MenteeProfileSummary payload={run.mentee_payload} name={run.mentee_name} email={run.mentee_email} />

        <div className="review-mentors-column">
          {run.candidates.map(m => (
            <MentorCandidateCard
              key={m.match_id}
              match={m}
              isSelected={selected.has(m.match_id)}
              onToggle={() => toggleCandidate(m.match_id)}
              expandedScores={expandedScores.has(m.match_id)}
              onToggleScores={() => toggleScores(m.match_id)}
              expandedProfile={expandedProfiles.has(m.match_id)}
              onToggleProfile={() => toggleProfile(m.match_id)}
            />
          ))}
        </div>
      </div>

      <div className="review-submit-bar">
        <button className="btn-primary" onClick={() => setShowConfirm(true)} disabled={submitting}>
          {submitting ? 'Submitting...' : `Submit Review (${selected.size} approved)`}
        </button>
        {selected.size === 0 && (
          <span style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>
            Submitting with none selected will cancel this run.
          </span>
        )}
      </div>

      {resultMsg && <p className="feedback-msg" style={{ marginTop: '0.5rem' }}>{resultMsg}</p>}

      {showConfirm && (() => {
        const approved = run.candidates.filter(m => selected.has(m.match_id))
        const rejected = run.candidates.filter(m => !selected.has(m.match_id))
        return (
          <ConfirmationModal
            title="Confirm Review"
            confirmLabel="Submit Review"
            onConfirm={() => { setShowConfirm(false); handleSubmit() }}
            onCancel={() => setShowConfirm(false)}
            confirming={submitting}
          >
            <p style={{ marginBottom: '0.75rem' }}>
              <strong>Mentee:</strong> {run.mentee_name}
            </p>
            {approved.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: 'var(--accent)' }}>Approving ({approved.length}):</strong>
                <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                  {approved.map(m => (
                    <li key={m.match_id}>{m.mentor_name} — Rank #{m.rank}, {Math.round(m.final_score * 100)}%</li>
                  ))}
                </ul>
              </div>
            )}
            {rejected.length > 0 && (
              <div style={{ marginBottom: '0.75rem' }}>
                <strong style={{ color: 'var(--muted)' }}>Rejecting ({rejected.length}):</strong>
                <ul style={{ margin: '0.25rem 0 0 1.25rem', padding: 0 }}>
                  {rejected.map(m => (
                    <li key={m.match_id}>{m.mentor_name} — Rank #{m.rank}, {Math.round(m.final_score * 100)}%</li>
                  ))}
                </ul>
              </div>
            )}
            {approved.length === 0 && (
              <p style={{ color: 'var(--error)' }}>No candidates approved — this will cancel the run.</p>
            )}
            {approved.length === 1 && (
              <p style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>
                One candidate approved — match will auto-activate.
              </p>
            )}
          </ConfirmationModal>
        )
      })()}
    </div>
  )
}

// ── Profiles Tab ──────────────────────────────────────────────────

function ProfilesTab({ headers }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/applications', { headers })
        if (res.ok) {
          const data = await res.json()
          setProfiles(data.profiles)
        } else {
          setError('Failed to load profiles.')
        }
      } catch {
        setError('Could not reach the server.')
      }
      setLoading(false)
    })()
  }, [])

  if (loading) return <p className="placeholder-text">Loading profiles...</p>
  if (error) return <p className="form-error">{error}</p>
  if (profiles.length === 0) return <p className="placeholder-text">No profiles found.</p>

  const allPayloadKeys = new Set()
  for (const p of profiles) {
    if (p.payload) {
      for (const k of Object.keys(p.payload)) allPayloadKeys.add(k)
    }
  }
  const payloadCols = [...allPayloadKeys].sort()

  function formatCell(val) {
    if (val == null || val === '') return ''
    if (Array.isArray(val)) return val.join(', ')
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  function formatDate(d) {
    if (!d) return ''
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="admin-section admin-table-section">
      <h3>All Profiles ({profiles.length})</h3>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              {payloadCols.map(k => <th key={k}>{k}</th>)}
              <th>Embedding</th>
              <th>Created</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => (
              <tr key={p.email}>
                <td>{p.email}</td>
                <td>{p.name}</td>
                <td><span className="role-badge">{p.role}</span></td>
                <td><span className={`badge ${p.status === 'APPROVED' ? 'badge-done' : 'badge-next'}`}>{p.status}</span></td>
                {payloadCols.map(k => (
                  <td key={k} title={formatCell(p.payload?.[k])}>{formatCell(p.payload?.[k])}</td>
                ))}
                <td>{p.has_embedding ? '✓' : '—'}</td>
                <td>{formatDate(p.created_at)}</td>
                <td>{formatDate(p.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <button className="btn-secondary" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? 'Hide Submission' : 'View Submission'}
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
