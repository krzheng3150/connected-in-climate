// ── Field Registry ─────────────────────────────────────────────────
// Single source of truth for every selectable option in the
// mentor/mentee applications. IDs are stable; display labels can
// change without breaking matching or storage.

export const FIELDS = {
  // ── Shared single-select ────────────────────────────────────────
  education_level: {
    high_school: 'High school',
    associates: 'Associates',
    bachelors: 'Bachelors',
    masters: 'Masters',
    doctorate: 'Doctorate',
  },
  years_experience: {
    '0_5': '0-5',
    '5_10': '5-10',
    '10_15': '10-15',
    '15_plus': '15+',
  },
  years_climate_experience: {
    '0_5': '0-5',
    '5_10': '5-10',
    '10_15': '10-15',
    '15_plus': '15+',
  },
  career_level: {
    entry: 'Associate / Entry',
    lead: 'Lead',
    managerial: 'Managerial',
    director: 'Director / Executive',
    c_suite: 'C-Suite',
  },

  // ── Shared multi-select ─────────────────────────────────────────
  sectors: {
    private: 'Private sector',
    nonprofit: 'Nonprofit / INGO / Social Sector',
    project_based: 'Project-based work',
    education: 'Education',
    government: 'Government (includes local, state, national, multilateral / bilateral institutions)',
  },
  climate_areas: {
    ai_climate: 'AI in Climate',
    adaptation: 'Adaptation & Resilience',
    built_environment: 'Built Environment & Real Estate',
    circular_economy: 'Circular Economy & Waste Management',
    climate_finance: 'Climate Finance & Carbon Markets',
    climate_justice: 'Climate Justice',
    climate_policy: 'Climate Policy',
    climate_tech: 'Climate Tech',
    corporate_sustainability: 'Corporate Sustainability',
    decarbonization: 'Decarbonization',
    energy: 'Energy',
    food_agriculture: 'Food & Agriculture, Forestry, Land Use (AFOLU)',
    nature_carbon: 'Nature & Carbon Removal',
    ocean_water: 'Ocean & Water',
    transportation: 'Transportation & Mobility',
    urban_planning: 'Urban Planning',
  },
  career_areas: {
    biz_dev: 'Business Development',
    consulting: 'Consulting',
    operations: 'Operations',
    engineering: 'Engineering',
    finance: 'Finance',
    fundraising: 'Fundraising',
    it: 'IT',
    marketing: 'Marketing & Communications',
    nonprofit_mgmt: 'Nonprofit Management',
    program_mgmt: 'Program Management',
    project_mgmt: 'Project Management',
    research: 'Research & Development',
    strategy: 'Strategy',
    data_science: 'Data Science',
  },
  topics: {
    climate_literacy: 'Climate literacy and translating non-climate experience.',
    career_exploration: 'General career exploration in climate; discussing different career trajectories.',
    day_to_day: 'Learning about the day to day in my job.',
    narrowing_options: 'Narrowing down career options and learning about new opportunities.',
    job_search: 'Job search / search strategy',
    resume_interview: 'Improving resume and interview skills',
    networking: 'Networking - helping my mentee to build a professional network in climate.',
    schooling_credentials: 'Discuss additional schooling / credentialing',
    skills_needed: 'Discuss what specific skills are needed / desired in the climate space',
    long_term_plan: 'Developing a long-term career plan',
    career_transition: 'Navigating career transition',
    international_work: 'Learning about / getting into international work',
    professional_challenges: 'Navigating professional challenges at work.',
    career_advancement: 'Career advancement and how to advance in a current role',
    leadership_skills: 'Developing leadership or management skills',
    work_life_balance: 'Discussing work/life balance',
    start_business: 'Advising on starting or expanding a business',
    business_ideas: 'Serving as a sounding board for new business ideas',
    nonprofit_board: 'Serving on a nonprofit board',
  },

  // ── Mentor single-select ────────────────────────────────────────
  management_experience: {
    managed_5plus: 'I have managed teams (5+) of direct reports.',
    managed_few: 'I have had a few (<5) direct reports.',
    project_managed: 'I have not had direct reports, but managed people in projects.',
    none: 'None - I have mostly been in individual contributor roles.',
  },
  business_experience: {
    started_own: 'Yes, I have started my own business.',
    cofounded: 'Yes, I have worked with others to start a business.',
    none: 'No.',
  },
  international_experience: {
    lived_abroad: 'Yes, I have lived and worked in a country that is not my home country.',
    multi_country: 'Yes, I have worked in multiple countries.',
    none: 'No, I do not have experience working in other countries.',
  },
  nonprofit_board_experience: {
    yes: 'Yes.',
    none: 'No.',
  },

  // ── Mentee single-select ────────────────────────────────────────
  employment_situation: {
    pivoting: 'Currently employed, but looking to pivot.',
    growing: 'Employed and looking to stay and grow at my current organization.',
    job_searching: 'Unemployed and job searching or looking to start my own venture.',
    student: 'Full time student.',
  },
}

// ── Reverse index: display label → id ─────────────────────────────
// Built once at import time. Case-insensitive, trimmed.

const reverseCache = new Map()

function getReverseIndex(fieldName) {
  if (reverseCache.has(fieldName)) return reverseCache.get(fieldName)
  const entries = FIELDS[fieldName]
  if (!entries) return null
  const reverse = new Map()
  for (const [id, label] of Object.entries(entries)) {
    reverse.set(label.toLowerCase().trim(), id)
  }
  reverseCache.set(fieldName, reverse)
  return reverse
}

export function normalize(fieldName, rawValue) {
  if (!rawValue) return null
  const reverse = getReverseIndex(fieldName)
  if (!reverse) return rawValue

  const key = String(rawValue).toLowerCase().trim()

  // Direct match
  if (reverse.has(key)) return reverse.get(key)

  // Already an ID?
  const entries = FIELDS[fieldName]
  if (entries[rawValue]) return rawValue

  return { unknown: true, field: fieldName, value: rawValue }
}

export function normalizeArray(fieldName, values) {
  if (!values || !values.length) return []
  const results = []
  const warnings = []
  for (const v of values) {
    const result = normalize(fieldName, v)
    if (result && typeof result === 'object' && result.unknown) {
      warnings.push(result)
    } else if (result) {
      results.push(result)
    }
  }
  return { values: results, warnings }
}

export function label(fieldName, id) {
  return FIELDS[fieldName]?.[id] ?? id
}

export function hasExperience(value) {
  return value != null && value !== 'none' && value !== 'no'
}
