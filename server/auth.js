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
  } catch {
    // clerkMiddleware not applied (e.g., tests) — fall through to header
  }
  if (process.env.NODE_ENV !== 'production') {
    const header = req.headers['x-user-email']
    if (header) return header.toLowerCase().trim()
  }
  return null
}
