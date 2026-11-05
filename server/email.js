import { Resend } from 'resend'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null
const SEND_EMAIL = process.env.SEND_EMAIL === '1' || process.env.SEND_EMAIL === 'true'
const FROM = process.env.EMAIL_FROM || 'Connected in Climate <noreply@climateactionforge.com>'
const APP_URL = process.env.APP_URL || 'https://connected-in-climate-n42zu.ondigitalocean.app'

const sent = []
export function _testGetSent() { return sent }
export function _testClear() { sent.length = 0 }

async function send(to, subject, html) {
  sent.push({ to, subject })
  if (!resend || !SEND_EMAIL) {
    console.log(`[email] skipped (sending disabled): to=${to} subject="${subject}"`)
    return
  }
  try {
    await resend.emails.send({ from: FROM, to, subject, html })
    console.log(`[email] sent: to=${to} subject="${subject}"`)
  } catch (err) {
    console.error(`[email] failed: to=${to} subject="${subject}"`, err.message || err)
  }
}

function wrap(body) {
  return `
    <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="color: #2d6a4f;">Connected in Climate</h2>
      ${body}
      <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 24px 0;" />
      <p style="font-size: 13px; color: #888;">
        You're receiving this because you're part of the Connected in Climate program.
      </p>
    </div>
  `
}

export function notifyAdminsNewRun(adminEmails, menteeName, menteeEmail) {
  const subject = `New match run: ${menteeName} is pending review`
  const html = wrap(`
    <p><strong>${menteeName}</strong> (${menteeEmail}) has submitted a match request and is waiting for admin review.</p>
    <p><a href="${APP_URL}/admin" style="color: #2d6a4f;">Review pending matches →</a></p>
  `)
  for (const email of adminEmails) {
    send(email, subject, html)
  }
}

export function notifyMatchActive(mentorEmail, mentorName, menteeEmail, menteeName) {
  send(
    mentorEmail,
    `You've been matched with ${menteeName}!`,
    wrap(`
      <p>Great news! You've been matched with <strong>${menteeName}</strong> as their mentor.</p>
      <p><a href="${APP_URL}/dashboard" style="color: #2d6a4f;">View your match →</a></p>
    `),
  )
  send(
    menteeEmail,
    `Your match with ${mentorName} is confirmed!`,
    wrap(`
      <p>Great news! You've been matched with <strong>${mentorName}</strong> as your mentor.</p>
      <p><a href="${APP_URL}/dashboard" style="color: #2d6a4f;">View your match →</a></p>
    `),
  )
}

export function notifyMenteeMatchesReady(menteeEmail, menteeName, approvedCount) {
  send(
    menteeEmail,
    `Your mentor matches are ready — pick your favorite!`,
    wrap(`
      <p>Hi ${menteeName},</p>
      <p>The admin team has approved <strong>${approvedCount} mentor${approvedCount > 1 ? 's' : ''}</strong> for you. Log in to review them and pick the one you'd like to work with.</p>
      <p><a href="${APP_URL}/dashboard" style="color: #2d6a4f;">Choose your mentor →</a></p>
    `),
  )
}
