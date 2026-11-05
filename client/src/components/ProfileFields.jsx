export const LABELS = {
  career_level: { entry: 'Associate / Entry', mid_level: 'Mid-Level', lead: 'Lead', managerial: 'Managerial', director: 'Director / Executive', c_suite: 'C-Suite' },
  education_level: { high_school: 'High School', associates: 'Associates', bachelors: "Bachelor's", masters: "Master's", doctorate: 'Doctorate' },
  years_experience: { '0_5': '0–5 years', '5_10': '5–10 years', '10_15': '10–15 years', '15_plus': '15+ years' },
  years_climate_experience: { '0_5': '0–5 years', '5_10': '5–10 years', '10_15': '10–15 years', '15_plus': '15+ years' },
  employment_situation: { pivoting: 'Employed, looking to pivot', growing: 'Employed, looking to grow', job_searching: 'Unemployed / job searching', freelance: 'Freelance / self-employed', career_break: 'Career break', student: 'Full-time student' },
  management_experience: { managed_5plus: 'Managed 5+ reports', managed_few: 'Managed <5 reports', project_managed: 'Project management only', none: 'Individual contributor' },
  business_experience: { started_own: 'Started own business', cofounded: 'Co-founded a business', none: 'No' },
  international_experience: { lived_abroad: 'Lived & worked abroad', multi_country: 'Multiple countries', none: 'No' },
  nonprofit_board_experience: { yes: 'Yes', none: 'No' },
  freelance_experience: { none: 'No', '0_3': '0–3 years', '4_10': '4–10 years', '10_plus': '10+ years' },
  sectors: { private: 'Private Sector', nonprofit: 'Nonprofit / INGO', project_based: 'Project-based', education: 'Education', government: 'Government' },
  climate_areas: { ai_climate: 'AI in Climate', adaptation: 'Adaptation & Resilience', built_environment: 'Built Environment', circular_economy: 'Circular Economy', climate_finance: 'Climate Finance', climate_justice: 'Climate Justice', climate_policy: 'Climate Policy', climate_tech: 'Climate Tech', corporate_sustainability: 'Corporate Sustainability', decarbonization: 'Decarbonization', energy: 'Energy', food_agriculture: 'Food & Agriculture', nature_carbon: 'Nature & Carbon Removal', ocean_water: 'Ocean & Water', transportation: 'Transportation', urban_planning: 'Urban Planning' },
  career_areas: { biz_dev: 'Business Dev', consulting: 'Consulting', operations: 'Operations', engineering: 'Engineering', finance: 'Finance', fundraising: 'Fundraising', it: 'IT', marketing: 'Marketing', nonprofit_mgmt: 'Nonprofit Management', program_mgmt: 'Program Management', project_mgmt: 'Project Management', research: 'R&D', strategy: 'Strategy', data_science: 'Data Science' },
  topics: { climate_literacy: 'Climate literacy', career_exploration: 'Career exploration', day_to_day: 'Day-to-day in job', narrowing_options: 'Narrowing career options', job_search: 'Job search strategy', resume_interview: 'Resume & interview', networking: 'Networking', schooling_credentials: 'Schooling & credentials', skills_needed: 'Skills needed in climate', long_term_plan: 'Long-term planning', career_transition: 'Career transition', international_work: 'International work', professional_challenges: 'Professional challenges', career_advancement: 'Career advancement', leadership_skills: 'Leadership & management', work_life_balance: 'Work/life balance', start_business: 'Starting a business', business_ideas: 'Business ideas', nonprofit_board: 'Nonprofit board service' },
}

const LABEL_LOOKUP = {
  top_strengths: 'topics',
  general_topics: 'topics',
  top_topics: 'topics',
}

export function lbl(field, id) {
  const lookupKey = LABEL_LOOKUP[field] || field
  return LABELS[lookupKey]?.[id] ?? id
}

const FIELD_NAMES = {
  preferred_name: 'Preferred Name',
  pronouns: 'Pronouns',
  location: 'Location',
  career_level: 'Career Level',
  education_level: 'Education',
  years_experience: 'Years Experience',
  years_climate_experience: 'Climate Experience',
  employment_situation: 'Employment',
  management_experience: 'Management',
  business_experience: 'Business',
  international_experience: 'International',
  nonprofit_board_experience: 'Nonprofit Board',
  freelance_experience: 'Freelance Experience',
  timezone: 'Timezone',
  career_areas: 'Career Areas',
  climate_areas: 'Climate Areas',
  sectors: 'Sectors',
  top_strengths: 'Top Strengths',
  general_topics: 'Also Comfortable With',
  top_topics: 'Topics of Interest',
  certifications: 'Certifications',
  interests_hobbies: 'Interests & Hobbies',
  motivation: 'About',
  statement_of_intent: 'Statement of Intent',
  fun_fact: 'Fun Fact',
  links: 'Contact',
}

function humanize(key) {
  return key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function fieldName(key) {
  return FIELD_NAMES[key] || humanize(key)
}

function tagClass(key) {
  if (key === 'climate_areas') return 'tag-climate'
  if (key === 'top_strengths' || key === 'general_topics' || key === 'top_topics') return 'tag-topic'
  return ''
}

const FIELD_ORDER = [
  'preferred_name', 'pronouns', 'location',
  'career_level', 'education_level', 'years_experience', 'years_climate_experience',
  'employment_situation',
  'management_experience', 'business_experience', 'international_experience', 'nonprofit_board_experience', 'freelance_experience',
  'timezone',
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'top_topics',
  'certifications', 'interests_hobbies',
  'motivation', 'statement_of_intent', 'fun_fact',
  'links',
]

export function ProfileDetail({ payload, exclude = [] }) {
  if (!payload) return null
  const excludeSet = new Set(exclude)

  const allKeys = Object.keys(payload)
  const ordered = []
  const seen = new Set()
  for (const key of FIELD_ORDER) {
    if (allKeys.includes(key) && !excludeSet.has(key)) { ordered.push(key); seen.add(key) }
  }
  for (const key of allKeys.sort()) {
    if (!seen.has(key) && !excludeSet.has(key)) ordered.push(key)
  }

  const gridFields = []
  const sectionFields = []

  for (const key of ordered) {
    const value = payload[key]
    if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) continue
    if (typeof value === 'object' || (typeof value === 'string' && value.length > 80)) {
      sectionFields.push([key, value])
    } else {
      gridFields.push([key, value])
    }
  }

  return (
    <>
      {gridFields.length > 0 && (
        <div className="admin-profile-grid">
          {gridFields.map(([key, value]) => (
            <div key={key} className="admin-profile-field">
              <span className="admin-profile-label">{fieldName(key)}</span>
              <span>{lbl(key, value)}</span>
            </div>
          ))}
        </div>
      )}
      {sectionFields.map(([key, value]) => {
        if (Array.isArray(value)) {
          const hasLabels = LABELS[LABEL_LOOKUP[key] || key] != null
          if (value.every(v => typeof v === 'string')) {
            return hasLabels ? (
              <div key={key} className="partner-section">
                <h3>{fieldName(key)}</h3>
                <div className="partner-tags">
                  {value.map((item, i) => (
                    <span key={i} className={`tag ${tagClass(key)}`}>{lbl(key, item)}</span>
                  ))}
                </div>
              </div>
            ) : (
              <div key={key} className="partner-section">
                <h3>{fieldName(key)}</h3>
                <p>{value.join(', ')}</p>
              </div>
            )
          }
          return (
            <div key={key} className="partner-section">
              <h3>{fieldName(key)}</h3>
              <pre className="admin-json">{JSON.stringify(value, null, 2)}</pre>
            </div>
          )
        }
        if (typeof value === 'object' && value !== null) {
          return (
            <div key={key} className="partner-section">
              <h3>{fieldName(key)}</h3>
              <div className="partner-tags">
                {Object.entries(value).map(([k, v]) => (
                  <span key={k} className="tag">{humanize(k)}: {String(v)}</span>
                ))}
              </div>
            </div>
          )
        }
        return (
          <div key={key} className="partner-section">
            <h3>{fieldName(key)}</h3>
            <p>{String(value)}</p>
          </div>
        )
      })}
    </>
  )
}
