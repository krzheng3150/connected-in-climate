export const SHARED_PAYLOAD_FIELDS = new Set([
  'preferred_name', 'name_pronunciation', 'pronouns', 'city', 'country', 'organization', 'timezone', 'fun_fact',
  'career_level', 'education_level', 'years_experience', 'years_climate_experience',
  'career_areas', 'climate_areas', 'sectors',
  'certifications', 'interests_hobbies', 'locations_open_to',
  'additional_info', 'links',
])

export const MENTOR_PAYLOAD_FIELDS = new Set([
  'motivation', 'eq_response', 'scheduling_link', 'commitment_name',
  'management_experience', 'business_experience', 'international_experience',
  'nonprofit_board_experience', 'freelance_experience',
  'top_strengths', 'general_topics', 'max_capacity',
])

export const MENTEE_PAYLOAD_FIELDS = new Set([
  'statement_of_intent', 'relevant_projects', 'commitment_name',
  'employment_situation', 'top_topics',
])

export const ORGANIZER_FIELDS = new Set([
  'w_horiz', 'w_vert', 'w_sector', 'locations_open_to',
])
