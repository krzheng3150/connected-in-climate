// ── Feature Flags ──────────────────────────────────────────────────
// Flip these to control application and matching behavior.
// Domain patterns in REQUIRE_REVIEW_DOMAINS still go through manual review.

// Auth: false = non-admin users type their email, admins use Clerk.
export const AUTH_ENABLED = false

// Auto-approve new applications (skip admin approval of profiles).
export const AUTO_APPROVE_MENTOR = true
export const AUTO_APPROVE_MENTEE = true

// Auto-approve top 3 match candidates (skip admin review of match runs).
// Run lands at AWAITING_MENTEE immediately — mentee still picks.
export const AUTO_APPROVE_MATCHES = true
export const AUTO_APPROVE_MATCH_COUNT = 3

// Mentorship duration in days. Computed at activation time so existing
// mentorships stay intact if this value changes.
export const MENTORSHIP_DURATION_DAYS = 30

// Domains that always require manual review (both applications and matches).
export const REQUIRE_REVIEW_DOMAINS = new Set([
  'review.com',
  'test.com',
])

export function requiresReview(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  return REQUIRE_REVIEW_DOMAINS.has(domain)
}
