// What a match partner may see of someone's profile.
//
// These fields are collected for the organizers (screening, matching, commitment
// sign-off) or are internal matching settings. They are never sent to the other
// person in a match. Everything else in the payload is shared with the partner.
export const PRIVATE_PARTNER_FIELDS = new Set([
  'commitment_name',   // typed signature confirming the time commitment
  'additional_info',   // "anything else we should know" note to the organizers
  'eq_response',       // screening answer
  'max_capacity',
  'w_horiz', 'w_vert', 'w_sector',
])

export function partnerView(payload) {
  const out = {}
  for (const [key, value] of Object.entries(payload ?? {})) {
    if (!PRIVATE_PARTNER_FIELDS.has(key)) out[key] = value
  }
  return out
}
