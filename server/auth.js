import { getAuth, clerkClient } from '@clerk/express'

// true = all users must sign in via Clerk. false = only admins need Clerk; everyone else uses x-user-email header.
const AUTH_ENABLED = false

export async function getAuthEmail(req) {
  try {
    const { userId } = getAuth(req)
    if (userId) {
      const user = await clerkClient.users.getUser(userId)
      const primary = user.emailAddresses.find(
        e => e.id === user.primaryEmailAddressId,
      )
      return primary?.emailAddress || null
    }
  } catch (err) {
    console.error('[auth] Clerk lookup failed:', err.message || err)
  }
  if (!AUTH_ENABLED || process.env.NODE_ENV !== 'production') {
    const header = req.headers['x-user-email']
    if (header) {
      const email = header.toLowerCase().trim()
      if (process.env.NODE_ENV === 'production') {
        const adminEmails = new Set(
          (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
        )
        if (adminEmails.has(email)) return null
      }
      return email
    }
  }
  return null
}
