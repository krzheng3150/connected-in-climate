import { getAuth, clerkClient } from '@clerk/express'

/**
 * Extract verified email from Clerk session, or fall back to x-user-email
 * header in non-production (for tests).
 */
export async function getAuthEmail(req) {
  try {
    const auth = getAuth(req)
    const { userId } = auth
    console.log('[auth] getAuth result:', { userId, sessionId: auth.sessionId })
    if (userId) {
      const user = await clerkClient.users.getUser(userId)
      const primary = user.emailAddresses.find(
        e => e.id === user.primaryEmailAddressId,
      )
      console.log('[auth] resolved email:', primary?.emailAddress)
      return primary?.emailAddress || null
    }
  } catch (err) {
    console.log('[auth] Clerk error, falling through:', err.message)
  }
  if (process.env.NODE_ENV !== 'production') {
    const header = req.headers['x-user-email']
    if (header) return header.toLowerCase().trim()
  }
  return null
}
