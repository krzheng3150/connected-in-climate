export function isMentor(role) {
  return role === 'mentor' || role === 'both'
}

export function isMentee(role) {
  return role === 'mentee' || role === 'both'
}

export function deriveRole(hasMentorApp, hasMenteeApp) {
  if (hasMentorApp && hasMenteeApp) return 'both'
  if (hasMentorApp) return 'mentor'
  if (hasMenteeApp) return 'mentee'
  return null
}
