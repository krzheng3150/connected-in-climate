import { useState } from 'react'
import ConfirmationModal from './ConfirmationModal.jsx'
import ShuffledCheckboxList from './ShuffledCheckboxList.jsx'
import { SUPPORT_EMAIL, TECH_SUPPORT_EMAIL } from '../config.js'

const MIN_REASON_LENGTH = 50

// `required` boxes must be checked; the `trap` box must be left unchecked.
const CHECKS = [
  { id: 'profiles', required: true, label: 'I have read each mentor\'s full profile, not just the summary card.' },
  { id: 'calls', required: true, label: 'I have booked or attempted an intro call with the mentors offered, or have a specific reason I could not.' },
  { id: 'effort', required: true, label: 'I understand a reset takes volunteer time and is not guaranteed to produce better matches.' },
  { id: 'review', required: true, label: 'I understand the team will review my reason and may follow up before resetting.' },
  { id: 'trap', required: false, label: 'I\'m not paying attention and just randomly clicking buttons.' },
]

export function buildMailto({ user, run, reason }) {
  const mentors = (run?.matches || []).map(m => `- ${m.mentor_name}`).join('\n')
  const subject = `Match reset request from ${user.name || user.email}`
  const body = [
    'Hello,',
    '',
    'I would like to request a reset of my mentor matches.',
    '',
    `Mentee email: ${user.email}`,
    `Match run ID: ${run?.run_id ?? 'unknown'}`,
    'Mentors offered:',
    mentors || '(none listed)',
    '',
    'Why none of these matches work for me:',
    reason.trim(),
  ].join('\n')
  return `mailto:${SUPPORT_EMAIL}?cc=${encodeURIComponent(TECH_SUPPORT_EMAIL)}`
    + `&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function ResetMatchesModal({ user, run, onClose }) {
  const [step, setStep] = useState(1)
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState({})

  const reasonLength = reason.trim().length
  const reasonOk = reasonLength >= MIN_REASON_LENGTH
  const checksOk = CHECKS.every(c => !!checked[c.id] === c.required)

  function toggle(id) {
    setChecked(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleConfirm() {
    window.location.href = buildMailto({ user, run, reason })
    onClose()
  }

  if (step === 1) {
    return (
      <ConfirmationModal
        title="Before you ask for a reset"
        confirmLabel="Continue"
        onConfirm={() => setStep(2)}
        onCancel={onClose}
        confirmDisabled={!reasonOk}
      >
        <p style={{ marginBottom: '0.75rem' }}>
          We understand it can be disappointing when the mentors you were offered don't feel right,
          and we want you to find a mentor who truly fits.
        </p>
        <p style={{ marginBottom: '0.75rem' }}>
          That said, every reset costs our volunteers real time, so we only do them when there is a
          genuine, well-considered reason. Please tell us specifically what is missing or mismatched,
          and what you did to evaluate these mentors (profiles, intro calls).
        </p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={6}
          placeholder="What made these matches a poor fit for you?"
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>
          {reasonOk ? 'Thank you.' : `At least ${MIN_REASON_LENGTH} characters (${reasonLength}/${MIN_REASON_LENGTH}).`}
        </div>
      </ConfirmationModal>
    )
  }

  return (
    <ConfirmationModal
      title="Please confirm"
      confirmLabel="Open email to support"
      onConfirm={handleConfirm}
      onCancel={onClose}
      cancelLabel="Cancel"
      confirmDisabled={!checksOk}
    >
      <p style={{ marginBottom: '0.75rem' }}>
        Thank you for bearing with us. We genuinely want you to find the right mentor.
        Because each reset takes real time from us, please read the below statements and acknowledge accordingly.
      </p>
      <p style={{ marginBottom: '0.75rem', fontSize: '0.875rem', color: 'var(--muted)' }}>
        Confirming will open your email app with a pre-filled message to our team.
      </p>
      <ShuffledCheckboxList options={CHECKS} checked={checked} onToggle={toggle} />
      <button className="btn-link" onClick={() => setStep(1)} style={{ marginTop: '0.5rem' }}>Back to edit my reason</button>
    </ConfirmationModal>
  )
}
