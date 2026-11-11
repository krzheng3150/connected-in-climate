// ── Seed Data Generator ────────────────────────────────────────────
// Generates ~80 diverse profiles with systematic field coverage.
// Exported as parsed profile objects ready for embedding + upsert.

import { isMentor, isMentee } from '../server/roles.js'

// ── Name & location pools ──────────────────────────────────────────

const MENTOR_POOL = [
  { name: 'Alex Chen', pn: 'Ah-lex Chen', pronouns: 'he/him', city: 'San Francisco', country: 'US' },
  { name: 'Priya Sharma', pn: 'PREE-yah', pronouns: 'she/her', city: 'Washington', country: 'US' },
  { name: 'Jordan Lee', pn: null, pronouns: 'they/them', city: 'Austin', country: 'US' },
  { name: 'Amara Okafor', pn: 'Ah-MAH-rah', pronouns: 'she/her', city: 'Nairobi', country: 'KE' },
  { name: 'Wei Zhang', pn: 'Way', pronouns: 'he/him', city: 'Singapore', country: 'SG' },
  { name: 'Elena Vasquez', pn: 'Eh-LEH-nah', pronouns: 'she/her', city: 'London', country: 'GB' },
  { name: 'Raj Patel', pn: 'Rahj', pronouns: 'he/him', city: null, country: null },
  { name: 'Maria Santos', pn: 'Mah-REE-ah', pronouns: 'she/her', city: 'São Paulo', country: 'BR' },
  { name: 'David Okonkwo', pn: 'Oh-KOHN-kwoh', pronouns: 'he/him', city: 'Lagos', country: 'NG' },
  { name: 'Sophie Laurent', pn: 'So-FEE Loh-RAHN', pronouns: 'she/her', city: 'Paris', country: 'FR' },
  { name: 'Kenji Watanabe', pn: 'KEN-jee', pronouns: 'he/him', city: 'Tokyo', country: 'JP' },
  { name: 'Ana Petrova', pn: 'AH-nah', pronouns: 'she/her', city: 'Berlin', country: 'DE' },
  { name: 'Miguel Torres', pn: 'Mee-GEL', pronouns: 'he/him', city: 'Mexico City', country: 'MX' },
  { name: 'Ingrid Larsen', pn: 'ING-rid', pronouns: 'she/her', city: 'Amsterdam', country: 'NL' },
  { name: 'Kwame Asante', pn: 'KWAH-may', pronouns: 'he/him', city: 'Cape Town', country: 'ZA' },
  { name: 'Mei Lin', pn: 'May Lin', pronouns: 'she/her', city: 'Sydney', country: 'AU' },
  { name: 'Omar Hassan', pn: 'OH-mar', pronouns: 'he/him', city: 'Dubai', country: 'AE' },
  { name: 'Clara Hoffmann', pn: 'KLAH-rah', pronouns: 'she/her', city: 'Zurich', country: 'CH' },
  { name: 'Tomoko Ito', pn: 'Toh-MOH-koh', pronouns: 'she/her', city: 'Osaka', country: 'JP' },
  { name: 'Dimitri Volkov', pn: 'Dee-MEE-tree', pronouns: 'he/him', city: 'Toronto', country: 'CA' },
  { name: 'Lena Fischer', pn: 'LEH-nah', pronouns: 'she/her', city: 'Vienna', country: 'AT' },
  { name: 'Samuel Achebe', pn: 'Ah-CHEH-bay', pronouns: 'he/him', city: 'Accra', country: 'GH' },
  { name: 'Isabella Rossi', pn: 'Ee-zah-BEL-lah', pronouns: 'she/her', city: 'Milan', country: 'IT' },
  { name: 'Henrik Svensson', pn: 'HEN-rick', pronouns: 'he/him', city: 'Stockholm', country: 'SE' },
  { name: 'Yuki Tanaka', pn: 'YOO-kee', pronouns: 'she/her', city: 'Seoul', country: 'KR' },
]

const MENTEE_POOL = [
  { name: 'Jane Doe', pn: null, pronouns: 'she/her', city: 'San Francisco', country: 'US' },
  { name: 'Marcus Rivera', pn: 'MAR-koos', pronouns: 'he/him', city: 'Washington', country: 'US' },
  { name: 'Lily Nguyen', pn: 'LIH-lee', pronouns: 'she/her', city: 'London', country: 'GB' },
  { name: 'Carlos Mendez', pn: 'CAR-lohs', pronouns: 'he/him', city: null, country: null },
  { name: 'Fatima Al-Hassan', pn: 'FAH-tee-mah', pronouns: 'she/her', city: 'Nairobi', country: 'KE' },
  { name: 'Tomás Reyes', pn: 'Toh-MAHS', pronouns: 'he/him', city: 'Austin', country: 'US' },
  { name: 'Aisha Patel', pn: 'Eye-EE-shah', pronouns: 'she/her', city: 'San Francisco', country: 'US' },
  { name: 'Noah Kim', pn: 'NOH-ah', pronouns: 'he/him', city: 'Seattle', country: 'US' },
  { name: 'Zara Obi', pn: 'ZAH-rah', pronouns: 'she/her', city: 'Lagos', country: 'NG' },
  { name: 'Ethan Brooks', pn: null, pronouns: 'he/him', city: 'Denver', country: 'US' },
  { name: 'Priyanka Mehta', pn: 'Pree-YAHN-kah', pronouns: 'she/her', city: 'Mumbai', country: 'IN' },
  { name: 'Lucas Ferreira', pn: 'LOO-kahs', pronouns: 'he/him', city: 'São Paulo', country: 'BR' },
  { name: 'Chloe Martin', pn: null, pronouns: 'she/her', city: 'Paris', country: 'FR' },
  { name: 'Hassan Ahmed', pn: 'Hah-SAHN', pronouns: 'he/him', city: 'Cairo', country: 'EG' },
  { name: 'Nina Johansson', pn: 'NEE-nah', pronouns: 'she/her', city: 'Stockholm', country: 'SE' },
  { name: 'Ravi Krishnan', pn: 'RAH-vee', pronouns: 'he/him', city: 'Bangalore', country: 'IN' },
  { name: 'Aaliyah Thompson', pn: 'Ah-LEE-yah', pronouns: 'she/her', city: 'Atlanta', country: 'US' },
  { name: 'Mateo García', pn: 'Mah-TAY-oh', pronouns: 'he/him', city: 'Buenos Aires', country: 'AR' },
  { name: 'Emma Lindqvist', pn: null, pronouns: 'she/her', city: 'Helsinki', country: 'FI' },
  { name: 'James Chen-Ramirez', pn: null, pronouns: 'he/him', city: 'Los Angeles', country: 'US' },
  { name: 'Amina Diallo', pn: 'Ah-MEE-nah', pronouns: 'she/her', city: 'Dakar', country: 'SN' },
  { name: 'Sebastian Müller', pn: 'Zeh-BAS-tee-ahn', pronouns: 'he/him', city: 'Berlin', country: 'DE' },
  { name: 'Yara Costa', pn: 'YAH-rah', pronouns: 'she/her', city: 'Lisbon', country: 'PT' },
  { name: 'Daniel Park', pn: null, pronouns: 'he/him', city: 'Chicago', country: 'US' },
  { name: 'Leila Mahmoud', pn: 'LAY-lah', pronouns: 'she/her', city: 'Amman', country: 'JO' },
  { name: 'Kofi Mensah', pn: 'KOH-fee', pronouns: 'he/him', city: 'Kumasi', country: 'GH' },
  { name: 'Sofia Andersson', pn: 'So-FEE-ah', pronouns: 'she/her', city: 'Copenhagen', country: 'DK' },
  { name: 'Tariq Bashir', pn: 'Tah-REEK', pronouns: 'he/him', city: 'Karachi', country: 'PK' },
  { name: 'Maya Williams', pn: null, pronouns: 'she/her', city: 'Portland', country: 'US' },
  { name: 'Diego Morales', pn: 'Dee-AY-go', pronouns: 'he/him', city: 'Bogotá', country: 'CO' },
  { name: 'Lin Zhang', pn: 'Lin Jahng', pronouns: 'she/her', city: 'Shanghai', country: 'CN' },
  { name: 'Alex Rivera', pn: null, pronouns: 'they/them', city: 'Boston', country: 'US' },
  { name: 'Rachel Nakamura', pn: null, pronouns: 'she/her', city: 'Honolulu', country: 'US' },
  { name: 'Pierre Dubois', pn: 'Pee-AIR', pronouns: 'he/him', city: 'Montreal', country: 'CA' },
  { name: 'Grace Adeyemi', pn: null, pronouns: 'she/her', city: 'Abuja', country: 'NG' },
]

const BOTH_POOL = [
  { name: 'Suki Tanaka', pn: 'SOO-kee', pronouns: 'she/her', city: 'Austin', country: 'US' },
  { name: 'Nia Washington', pn: 'NEE-ah', pronouns: 'she/her', city: 'San Francisco', country: 'US' },
  { name: 'Taylor Kim', pn: null, pronouns: 'they/them', city: 'New York', country: 'US' },
  { name: 'Rohan Gupta', pn: 'ROH-hahn', pronouns: 'he/him', city: 'Delhi', country: 'IN' },
  { name: 'Camille Dubois', pn: 'Kah-MEEL', pronouns: 'she/her', city: 'Brussels', country: 'BE' },
  { name: 'Jesse Moreno', pn: null, pronouns: 'they/them', city: 'Miami', country: 'US' },
  { name: 'Hana Park', pn: 'HAH-nah', pronouns: 'she/her', city: 'Seoul', country: 'KR' },
  { name: 'Chris Okafor', pn: null, pronouns: 'he/him', city: 'London', country: 'GB' },
]

// ── Field value pools ──────────────────────────────────────────────

const CAREER_AREAS = [
  'biz_dev', 'consulting', 'operations', 'engineering', 'finance',
  'fundraising', 'it', 'marketing', 'nonprofit_mgmt', 'program_mgmt',
  'project_mgmt', 'research', 'strategy', 'data_science',
]

const CLIMATE_AREAS = [
  'ai_climate', 'adaptation', 'built_environment', 'circular_economy',
  'climate_finance', 'climate_justice', 'climate_policy', 'climate_tech',
  'corporate_sustainability', 'decarbonization', 'energy',
  'food_agriculture', 'nature_carbon', 'ocean_water', 'transportation',
  'urban_planning',
]

const SECTORS = ['private', 'nonprofit', 'project_based', 'education', 'government']

const TOPICS = [
  'climate_literacy', 'career_exploration', 'day_to_day', 'narrowing_options',
  'job_search', 'resume_interview', 'networking', 'schooling_credentials',
  'skills_needed', 'long_term_plan', 'career_transition', 'international_work',
  'professional_challenges', 'career_advancement', 'leadership_skills',
  'work_life_balance', 'start_business', 'business_ideas', 'nonprofit_board',
]

const CAREER_LEVELS = ['entry', 'mid_level', 'lead', 'managerial', 'director', 'c_suite']
const EDUCATION = ['high_school', 'associates', 'bachelors', 'masters', 'doctorate']
const YEARS_EXP = ['0_5', '5_10', '10_15', '15_plus']
const EMPLOYMENT = ['pivoting', 'growing', 'job_searching', 'freelance', 'career_break', 'student']
const MANAGEMENT = ['managed_5plus', 'managed_few', 'project_managed', 'none']
const BUSINESS = ['started_own', 'cofounded', 'none']
const INTERNATIONAL = ['lived_abroad', 'multi_country', 'study_abroad', 'none']
const NONPROFIT_BOARD = ['yes', 'none']
const FREELANCE = ['none', '0_3', '4_10', '10_plus']

const LOCATIONS_OPEN = [
  'Remote', 'San Francisco', 'New York', 'Washington',
  'London', 'Singapore', 'Berlin', 'Toronto',
  'Sydney', 'Nairobi', 'São Paulo',
]

const MOTIVATIONS = [
  'Passionate about mentoring the next generation of climate leaders. I bring {years} years of experience in {area} and want to help professionals navigate career transitions.',
  'Built my career at the intersection of {area} and climate. Ready to share hard-won lessons about what works and what does not in this space.',
  'Having successfully transitioned into climate from {area}, I understand the challenges firsthand and want to help others make the same leap.',
  'Led teams across {area} for {years} years. I believe mentorship is the fastest way to build the climate workforce we need.',
  'My experience spanning {area} has taught me that diverse perspectives strengthen climate solutions. I want to help mentees find their unique contribution.',
]

const STATEMENTS = [
  'Looking to pivot from {area} into climate work. I have {years} years of transferable skills and want guidance on where I can have the most impact.',
  'Currently working in {area} but want to specialize in climate-focused roles. Seeking a mentor who can help me navigate this transition.',
  'Recent graduate passionate about {area} and climate. Want mentorship on breaking into the field and building a meaningful career.',
  'Mid-career professional exploring how my {area} background can contribute to climate solutions. Looking for strategic career guidance.',
  'Experienced in {area} and ready to go deeper into climate. Need help identifying the right opportunities and building my network.',
]

const FUN_FACTS = [
  'Once hiked a volcano to install a weather monitoring station',
  'Has a collection of seeds from every continent except Antarctica',
  'Built a rainwater harvesting system for the entire neighborhood',
  'Convinced a Fortune 500 company to go carbon neutral during an elevator pitch',
  'Has read every IPCC report cover to cover',
  'Speaks four languages and learned the last one specifically for climate negotiations',
  'Cycled across three countries powered entirely by solar-charged e-bike',
  'Grew up on a farm and can identify 200 plant species by leaf shape',
  'Holds a patent for a biodegradable packaging material',
  'Organized the largest beach cleanup in their city with 2000 volunteers',
  'Built a DIY air quality sensor network for their neighborhood',
  'Published a children\'s book about renewable energy',
  'Completed a zero-waste challenge for an entire year',
  'Runs a community composting program serving 500 households',
  'Helped design the sustainability curriculum at their university',
  'Sailed across the Pacific on a research vessel studying microplastics',
  'Created a viral TikTok series explaining carbon markets',
  'Trained as a wildland firefighter before pivoting to fire ecology research',
  'Won a national debate championship arguing for carbon pricing',
  'Volunteers as a climate science translator for immigrant communities',
]

const HOBBIES = [
  'Rock climbing', 'Hiking', 'Trail running', 'Cycling', 'Sailing',
  'Scuba diving', 'Surfing', 'Kayaking', 'Birdwatching', 'Gardening',
  'Photography', 'Watercolor painting', 'Pottery', 'Woodworking', 'Cooking',
  'Reading sci-fi', 'Board games', 'Chess', 'Jazz piano', 'Guitar',
  'Karaoke', 'Dance', 'Yoga', 'Meditation', 'Creative writing',
  'Podcasting', 'Open source', '3D printing', 'Urban sketching', 'Improv comedy',
  'Documentary filmmaking', 'Sustainable fashion', 'Sourdough baking', 'Beekeeping',
  'Foraging', 'Stargazing', 'Marathon running', 'CrossFit', 'Skateboarding',
]

const CERTS = [
  'PMP', 'CFA', 'LEED AP', 'AWS Solutions Architect', 'PRINCE2',
  'Six Sigma Black Belt', 'CDP Accredited', 'GRI Certified',
  'WELL AP', 'Certified B Corp Consultant', 'ISSP Sustainability Associate',
  'CEM (Certified Energy Manager)', 'FRM', 'CPA', 'PE (Professional Engineer)',
  null, null, null, null, null, null, null, // weighted toward no cert
]

// ── Helpers ────────────────────────────────────────────────────────

function pick(arr, seed) { return arr[seed % arr.length] }
function pickN(arr, n, seed) {
  const shuffled = [...arr].sort((a, b) => hash(a + seed) - hash(b + seed))
  return shuffled.slice(0, Math.min(n, arr.length))
}
function hash(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function fillTemplate(template, area, years) {
  return template.replace('{area}', area).replace('{years}', years)
}

// ── Profile generators ─────────────────────────────────────────────

function buildMentorPayload(idx) {
  const s = idx * 7 + 13
  const careerLevel = pick(CAREER_LEVELS, s)
  const seniorLevels = ['lead', 'managerial', 'director', 'c_suite']
  const isSenior = seniorLevels.includes(careerLevel)

  const careerAreas = pickN(CAREER_AREAS, 2 + (s % 2), s)
  const climateAreas = pickN(CLIMATE_AREAS, 2 + (s % 3), s + 1)
  const sectors = pickN(SECTORS, 1 + (s % 2), s + 2)
  const strengths = pickN(TOPICS, 3, s + 3)
  const general = pickN(TOPICS.filter(t => !strengths.includes(t)), 2 + (s % 2), s + 4)

  const yearsExp = isSenior ? pick(['10_15', '15_plus'], s) : pick(YEARS_EXP, s)
  const yearsClimate = pick(YEARS_EXP, s + 5)
  const education = isSenior ? pick(['masters', 'doctorate'], s) : pick(EDUCATION, s + 6)

  const areaLabel = careerAreas[0].replace(/_/g, ' ')
  const motivation = fillTemplate(pick(MOTIVATIONS, s + 7), areaLabel, yearsExp.replace('_', '-').replace('plus', '+'))

  const payload = {
    career_level: careerLevel,
    education_level: education,
    years_experience: yearsExp,
    years_climate_experience: yearsClimate,
    career_areas: careerAreas,
    climate_areas: climateAreas,
    sectors: sectors,
    top_strengths: strengths,
    general_topics: general,
    motivation,
    max_capacity: 1 + (s % 4),
    management_experience: pick(MANAGEMENT, s + 8),
    business_experience: pick(BUSINESS, s + 9),
    international_experience: pick(INTERNATIONAL, s + 10),
    nonprofit_board_experience: pick(NONPROFIT_BOARD, s + 11),
    geo_match_preference: s % 3 !== 0,
    interests_hobbies: pickN(HOBBIES, 2 + (s % 2), s + 12),
    fun_fact: pick(FUN_FACTS, s + 13),
  }

  const freelance = pick(FREELANCE, s + 14)
  if (freelance !== 'none') payload.freelance_experience = freelance

  const cert = pick(CERTS, s + 15)
  if (cert) payload.certifications = [cert]

  return payload
}

function buildMenteePayload(idx) {
  const s = idx * 11 + 17
  const careerLevel = pick(CAREER_LEVELS, s)

  const careerAreas = pickN(CAREER_AREAS, 1 + (s % 3), s)
  const climateAreas = pickN(CLIMATE_AREAS, 2 + (s % 3), s + 1)
  const sectors = pickN(SECTORS, 1 + (s % 2), s + 2)
  const topTopics = pickN(TOPICS, 3 + (s % 2), s + 3)

  const yearsExp = pick(YEARS_EXP, s + 4)
  const yearsClimate = pick(['0_5', '0_5', '0_5', '5_10'], s + 5)
  const education = pick(EDUCATION, s + 6)
  const employment = pick(EMPLOYMENT, s + 7)

  const areaLabel = careerAreas[0].replace(/_/g, ' ')
  const statement = fillTemplate(pick(STATEMENTS, s + 8), areaLabel, yearsExp.replace('_', '-').replace('plus', '+'))

  const wH = 1 + (s % 5)
  const wV = 1 + ((s + 1) % 5)
  const wS = 1 + ((s + 2) % 5)

  const payload = {
    career_level: careerLevel,
    education_level: education,
    years_experience: yearsExp,
    years_climate_experience: yearsClimate,
    employment_situation: employment,
    career_areas: careerAreas,
    climate_areas: climateAreas,
    sectors: sectors,
    top_topics: topTopics,
    statement_of_intent: statement,
    w_horiz: wH,
    w_vert: wV,
    w_sector: wS,
    geo_match_preference: s % 4 !== 0,
    interests_hobbies: pickN(HOBBIES, 2, s + 9),
    fun_fact: pick(FUN_FACTS, s + 10),
  }

  return payload
}

function buildBothPayload(idx) {
  const mentorPart = buildMentorPayload(idx + 100)
  const menteePart = buildMenteePayload(idx + 100)
  return {
    ...mentorPart,
    ...menteePart,
    motivation: mentorPart.motivation,
    statement_of_intent: menteePart.statement_of_intent,
    top_strengths: mentorPart.top_strengths,
    general_topics: mentorPart.general_topics,
    top_topics: menteePart.top_topics,
    max_capacity: mentorPart.max_capacity,
  }
}

const CITY_TZ = {
  'San Francisco': 'America/Los_Angeles', 'Los Angeles': 'America/Los_Angeles',
  'Washington': 'America/New_York', 'Atlanta': 'America/New_York',
  'Austin': 'America/Chicago', 'Chicago': 'America/Chicago', 'Denver': 'America/Denver',
  'Seattle': 'America/Los_Angeles',
  'London': 'Europe/London', 'Paris': 'Europe/Paris', 'Berlin': 'Europe/Berlin',
  'Amsterdam': 'Europe/Amsterdam', 'Zurich': 'Europe/Zurich', 'Vienna': 'Europe/Vienna',
  'Milan': 'Europe/Rome', 'Stockholm': 'Europe/Stockholm', 'Copenhagen': 'Europe/Copenhagen',
  'Helsinki': 'Europe/Helsinki', 'Lisbon': 'Europe/Lisbon',
  'Nairobi': 'Africa/Nairobi', 'Lagos': 'Africa/Lagos', 'Cape Town': 'Africa/Johannesburg',
  'Accra': 'Africa/Accra', 'Kumasi': 'Africa/Accra', 'Cairo': 'Africa/Cairo',
  'Dakar': 'Africa/Dakar',
  'Tokyo': 'Asia/Tokyo', 'Osaka': 'Asia/Tokyo', 'Seoul': 'Asia/Seoul',
  'Singapore': 'Asia/Singapore', 'Mumbai': 'Asia/Kolkata', 'Bangalore': 'Asia/Kolkata',
  'Dubai': 'Asia/Dubai', 'Amman': 'Asia/Amman', 'Karachi': 'Asia/Karachi',
  'Sydney': 'Australia/Sydney',
  'São Paulo': 'America/Sao_Paulo', 'Buenos Aires': 'America/Argentina/Buenos_Aires',
  'Mexico City': 'America/Mexico_City', 'Toronto': 'America/Toronto',
  'Portland': 'America/Los_Angeles', 'Boston': 'America/New_York',
  'New York': 'America/New_York', 'Miami': 'America/New_York',
  'Honolulu': 'Pacific/Honolulu', 'Montreal': 'America/Toronto',
  'Bogotá': 'America/Bogota', 'Shanghai': 'Asia/Shanghai', 'Delhi': 'Asia/Kolkata',
  'Brussels': 'Europe/Brussels', 'Abuja': 'Africa/Lagos',
}

function addLocations(payload, city, country, idx) {
  if (city) payload.city = city
  if (country) payload.country = country
  if (city && CITY_TZ[city]) payload.timezone = CITY_TZ[city]
  const cityLabel = city || 'Remote'
  const open = [cityLabel]
  if (idx % 3 === 0) open.push('Remote')
  const extra = pick(LOCATIONS_OPEN.filter(l => l !== cityLabel), idx + 50)
  if (idx % 4 === 0) open.push(extra)
  payload.locations_open_to = open
  if (payload.geo_match_preference) {
    payload.geo_match_distance_km = pick([50, 80, 100, 150, 200, 300], idx)
  }
}

function addLinks(payload, name, idx) {
  const slug = name.toLowerCase().replace(/[^a-z]/g, '')
  payload.links = { linkedin: `https://linkedin.com/in/${slug}` }
  if (idx % 3 === 0) payload.links.website = `https://${slug}.dev`
  if (idx % 2 === 0) payload.scheduling_link = `https://calendly.com/obviously-fake-link-${slug}/15min`
}

// ── Generate all profiles ──────────────────────────────────────────

export function generateProfiles() {
  const profiles = []

  // ── Mentors ──────────────────────────────────────────────────────
  for (let i = 0; i < MENTOR_POOL.length; i++) {
    const { name, pn, pronouns, city, country } = MENTOR_POOL[i]
    const email = `mentor.${i + 1}@example.com`
    const payload = buildMentorPayload(i)
    addLocations(payload, city, country, i)
    addLinks(payload, name, i)
    if (pn) payload.name_pronunciation = pn
    payload.pronouns = pronouns
    payload.preferred_name = name.split(' ')[0]

    profiles.push({
      email, name, role: 'mentor', payload,
      embeddingText: payload.motivation,
    })
  }

  // ── Mentees ──────────────────────────────────────────────────────
  for (let i = 0; i < MENTEE_POOL.length; i++) {
    const { name, pn, pronouns, city, country } = MENTEE_POOL[i]
    const payload = buildMenteePayload(i)
    addLocations(payload, city, country, i)
    addLinks(payload, name, i)
    if (pn) payload.name_pronunciation = pn
    payload.pronouns = pronouns
    payload.preferred_name = name.split(' ')[0]

    // Email prefix assigned by LIFECYCLE_PLAN below
    profiles.push({
      _pool_idx: i, name, role: 'mentee', payload,
      embeddingText: payload.statement_of_intent,
      pronouns, pn,
    })
  }

  // ── Both ─────────────────────────────────────────────────────────
  for (let i = 0; i < BOTH_POOL.length; i++) {
    const { name, pn, pronouns, city, country } = BOTH_POOL[i]
    const payload = buildBothPayload(i)
    addLocations(payload, city, country, i)
    addLinks(payload, name, i)
    if (pn) payload.name_pronunciation = pn
    payload.pronouns = pronouns
    payload.preferred_name = name.split(' ')[0]

    profiles.push({
      _pool_idx: i + 100, name, role: 'both', payload,
      embeddingText: payload.motivation,
      pronouns, pn,
    })
  }

  // ── Assign emails based on lifecycle plan ─────────────────────────
  // Mentors are already assigned. Now assign mentee/both emails.

  const mentees = profiles.filter(p => p.role === 'mentee')
  const boths = profiles.filter(p => p.role === 'both')

  // finished: 5, active: 10, awaiting: 3, review: 5, pending: rest
  let finishedN = 0, activeN = 0, awaitingN = 0, reviewN = 0, pendingN = 0

  for (let i = 0; i < mentees.length; i++) {
    let prefix
    if (finishedN < 5) { prefix = `finished.${++finishedN}`; }
    else if (activeN < 10) { prefix = `active.${++activeN}`; }
    else if (awaitingN < 3) { prefix = `awaiting.${++awaitingN}`; }
    else if (reviewN < 5) { prefix = `review.${++reviewN}`; }
    else { prefix = `pending.${++pendingN}`; }
    mentees[i].email = `${prefix}@example.com`
    delete mentees[i]._pool_idx
  }

  // Both: first 3 active, rest pending
  for (let i = 0; i < boths.length; i++) {
    let prefix
    if (i < 3) { prefix = `active.${++activeN}`; }
    else { prefix = `pending.${++pendingN}`; }
    boths[i].email = `${prefix}@example.com`
    delete boths[i]._pool_idx
  }

  return profiles
}

// ── Lifecycle & config ─────────────────────────────────────────────

export function getLifecyclePlan(profiles) {
  const mentees = profiles.filter(p => isMentee(p.role))
  const plan = []

  for (const p of mentees) {
    const prefix = p.email.split('.')[0]
    const num = parseInt(p.email.split('.')[1])

    if (prefix === 'finished') {
      plan.push({ email: p.email, state: 'FINISHED', daysAgo: 60 - num * 8 })
    } else if (prefix === 'active') {
      plan.push({ email: p.email, state: 'ACTIVE', daysAgo: 30 - num * 2 })
    } else if (prefix === 'awaiting') {
      plan.push({ email: p.email, state: 'AWAITING_MENTEE', daysAgo: num })
    } else if (prefix === 'review') {
      plan.push({ email: p.email, state: 'PENDING_REVIEW', daysAgo: 0 })
    }
    // pending.* profiles stay as pending applications — no match run
  }

  // Sort: finished first, then active, awaiting, review
  const ORDER = { FINISHED: 0, ACTIVE: 1, AWAITING_MENTEE: 2, PENDING_REVIEW: 3 }
  plan.sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || (b.daysAgo - a.daysAgo))

  return plan
}

export function getPendingEmails(profiles) {
  return new Set(
    profiles.filter(p => p.email.startsWith('pending.')).map(p => p.email),
  )
}

export function getBlockList() {
  return [
    { mentor: 'mentor.3@example.com', mentee: 'pending.2@example.com', reason: 'Mentee requested a different mentor focus area' },
    { mentor: 'mentor.7@example.com', mentee: 'pending.5@example.com', reason: 'Scheduling conflict — different time zones' },
    { mentor: 'mentor.12@example.com', mentee: 'review.3@example.com', reason: 'Mentor flagged as not a good fit for mentee goals' },
  ]
}

export function getFeedback() {
  return {
    'finished.1@example.com': [
      { from: 'mentee', rating: 5, text: 'Incredibly helpful with navigating international climate finance. The COP negotiation experience gave me a perspective I could not have gotten anywhere else.' },
      { from: 'mentor', rating: 4, text: 'Driven and prepared. Came to every session with thoughtful questions. Will go far in this space.' },
    ],
    'finished.2@example.com': [
      { from: 'mentee', rating: 5, text: 'Helped me completely rethink my approach to job searching in climate tech. The networking introductions were invaluable.' },
      { from: 'mentor', rating: 5, text: 'One of the most engaged mentees I have worked with. Already making an impact in the sector.' },
    ],
    'finished.3@example.com': [
      { from: 'mentee', rating: 4, text: 'Great guidance on transitioning from academia to policy work. Wish we had more time to explore the international angle.' },
    ],
    'finished.4@example.com': [
      { from: 'mentee', rating: 3, text: 'Good conversations but I was hoping for more specific tactical advice on breaking into the private sector.' },
      { from: 'mentor', rating: 4, text: 'Enthusiastic mentee with a lot of potential. Needs to narrow focus to make faster progress.' },
    ],
    'finished.5@example.com': [
      { from: 'mentee', rating: 5, text: 'Life-changing mentorship. Helped me land my dream role in climate adaptation. Cannot recommend enough.' },
      { from: 'mentor', rating: 5, text: 'Watching this mentee grow from uncertain to confident was the highlight of my year. They are doing incredible work now.' },
    ],
  }
}
