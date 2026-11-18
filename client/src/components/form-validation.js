function isFilled(v) {
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim().length > 0
  return v != null
}

export function stepComplete(step, form, { isSecondApp, isMentor, isMentee } = {}) {
  const required = {
    0: ['role'],
    1: isSecondApp
      ? ['career_level']
      : ['name', 'career_level', 'city', 'country'],
    2: ['climate_areas', 'career_areas'],
    3: isMentor
      ? ['motivation', 'commitment_name']
      : ['statement_of_intent', 'commitment_name'],
  }
  return (required[step] || []).every(k => isFilled(form[k]))
}
