import { getAuth, clerkClient } from '@clerk/express'

/**
 * Extract verified email from Clerk session, or fall back to x-user-email
 * header in non-production (for tests).
 */
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
  if (process.env.NODE_ENV !== 'production') {
    const header = req.headers['x-user-email']
    if (header) {
      const email = header.toLowerCase().trim()
      const adminList = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase())
      if (adminList.includes(email)) return null
      return email
    }
  }
  return null
}
