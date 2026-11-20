#!/usr/bin/env node
// Send a test email locally.
// Usage: SEND_EMAIL=1 node --env-file=.env scripts/test-email.js <template> <to> [--note "..."]
//
// Templates:
//   matches-ready   — mentee gets N approved mentors (notifyMenteeMatchesReady)
//   match-active    — single mentor auto-activated (notifyMatchActive)
//   app-approved    — application approved (notifyApplicantApproved)
//   new-application — admin notified of new application (notifyAdminsNewApplication)
//   new-run         — admin notified of new match run (notifyAdminsNewRun)
//
// Examples:
//   SEND_EMAIL=1 node --env-file=.env scripts/test-email.js matches-ready you@example.com
//   SEND_EMAIL=1 node --env-file=.env scripts/test-email.js match-active you@example.com --note "Great fit"

import {
  notifyMenteeMatchesReady,
  notifyMatchActive,
  notifyApplicantApproved,
  notifyAdminsNewApplication,
  notifyAdminsNewRun,
} from '../server/email.js'

const args = process.argv.slice(2)
const template = args[0]
const to = args[1]
const noteIdx = args.indexOf('--note')
const note = noteIdx !== -1 ? args[noteIdx + 1] : undefined

if (!template || !to) {
  console.error('Usage: SEND_EMAIL=1 node --env-file=.env scripts/test-email.js <template> <to> [--note "..."]')
  console.error('Templates: matches-ready, match-active, app-approved, new-application, new-run')
  process.exit(1)
}

const MENTOR = 'Test Mentor'
const MENTEE = 'Test Mentee'

switch (template) {
  case 'matches-ready':
    notifyMenteeMatchesReady(to, MENTEE, 3, { note })
    console.log(`Sent matches-ready to ${to}${note ? ` with note: "${note}"` : ''}`)
    break
  case 'match-active':
    notifyMatchActive(to, MENTOR, to, MENTEE, { note })
    console.log(`Sent match-active to ${to}${note ? ` with note: "${note}"` : ''}`)
    break
  case 'app-approved':
    notifyApplicantApproved(to, MENTEE)
    console.log(`Sent app-approved to ${to}`)
    break
  case 'new-application':
    notifyAdminsNewApplication([to], MENTEE, 'applicant@example.com', 'mentee')
    console.log(`Sent new-application to ${to}`)
    break
  case 'new-run':
    notifyAdminsNewRun([to], MENTEE, 'mentee@example.com')
    console.log(`Sent new-run to ${to}`)
    break
  default:
    console.error(`Unknown template: ${template}`)
    console.error('Templates: matches-ready, match-active, app-approved, new-application, new-run')
    process.exit(1)
}
