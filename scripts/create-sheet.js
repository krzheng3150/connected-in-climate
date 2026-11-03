import { google } from 'googleapis'
import { getAuth } from './google-auth.js'
import { FIELDS } from '../server/field-registry.js'

const HEADERS = [
  'email', 'name', 'role', 'preferred_name', 'name_pronunciation', 'pronouns',
  'photo_url', 'location', 'locations_open_to', 'geo_match_preference',
  'geo_match_distance_km', 'career_level', 'education_level', 'years_experience',
  'years_climate_experience', 'employment_situation', 'management_experience',
  'business_experience', 'international_experience', 'nonprofit_board_experience',
  'certifications', 'interests_hobbies', 'fun_fact',
  'links_linkedin', 'links_phone', 'links_website', 'links_calendly',
  'career_areas', 'climate_areas', 'sectors',
  'top_strengths', 'general_topics', 'motivation', 'max_capacity',
  'top_topics', 'statement_of_intent', 'w_horiz', 'w_vert', 'w_sector',
]

const DROPDOWN_FIELDS = {
  role:                       { values: ['mentor', 'mentee', 'both'] },
  geo_match_preference:       { values: ['TRUE', 'FALSE'] },
  career_level:               { field: 'career_level' },
  education_level:            { field: 'education_level' },
  years_experience:           { field: 'years_experience' },
  years_climate_experience:   { field: 'years_climate_experience' },
  employment_situation:       { field: 'employment_situation' },
  management_experience:      { field: 'management_experience' },
  business_experience:        { field: 'business_experience' },
  international_experience:   { field: 'international_experience' },
  nonprofit_board_experience: { field: 'nonprofit_board_experience' },
}

const NOTES = {
  email:                'Required. Lowercase.',
  name:                 'Required. Full name.',
  role:                 'Required. mentor, mentee, or both.',
  locations_open_to:    'Pipe-separated. e.g. "Portland, OR|Remote"',
  career_areas:         'Labels or IDs from Reference tab. One per line, or separated by | or ;',
  climate_areas:        'Labels or IDs from Reference tab. One per line, or separated by | or ;',
  sectors:              'Labels or IDs from Reference tab. One per line, or separated by | or ;',
  top_strengths:        'Topic labels or IDs from Reference tab. Mentor only. One per line, or separated by | or ;',
  general_topics:       'Topic labels or IDs from Reference tab. Mentor only. One per line, or separated by | or ;',
  top_topics:           'Topic labels or IDs from Reference tab. Mentee only. One per line, or separated by | or ;',
  motivation:           'Free text. Required for mentors.',
  statement_of_intent:  'Free text. Required for mentees.',
  max_capacity:         'Integer. Mentor only. Max active mentees.',
  w_horiz:              'Integer 1-5. Mentee only.',
  w_vert:               'Integer 1-5. Mentee only.',
  w_sector:             'Integer 1-5. Mentee only.',
  certifications:       'Pipe-separated. Free text.',
  interests_hobbies:    'Pipe-separated. Free text.',
}

const SHEET_URL_RE = /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
const MAX_DATA_ROWS = 200

function usage() {
  console.error(`Usage: node scripts/create-sheet.js <google-sheet-url>

  Sets up an existing Google Sheet with headers, a Reference tab,
  dropdown validation, and header protection.

  The sheet must be shared with the service account email as Editor:
    ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '(set GOOGLE_SERVICE_ACCOUNT_EMAIL in .env)'}

  Steps:
    1. Create a blank Google Sheet
    2. Share it with the service account email above (Editor access)
    3. Run this script with the sheet URL`)
  process.exit(1)
}

async function main() {
  const url = process.argv[2]
  if (!url) usage()

  const match = url.match(SHEET_URL_RE)
  if (!match) { console.error('Invalid Google Sheet URL'); process.exit(1) }
  const spreadsheetId = match[1]

  const auth = getAuth([
    'https://www.googleapis.com/auth/spreadsheets',
  ])
  const sheets = google.sheets({ version: 'v4', auth })

  // Verify access
  console.log('Connecting to sheet...')
  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  console.log(`  Title: ${meta.data.properties.title}`)

  const existingSheets = meta.data.sheets.map(s => s.properties)

  // ── Ensure Profiles sheet exists (use first sheet or rename) ───
  const firstSheet = existingSheets[0]
  const requests = []

  if (firstSheet.title !== 'Profiles') {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: firstSheet.sheetId, title: 'Profiles', gridProperties: { frozenRowCount: 1 } },
        fields: 'title,gridProperties.frozenRowCount',
      },
    })
  } else {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: firstSheet.sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    })
  }
  const profilesSheetId = firstSheet.sheetId

  // ── Ensure Reference sheet exists ──────────────────────────────
  let refSheet = existingSheets.find(s => s.title === 'Reference')
  let refSheetId
  if (refSheet) {
    refSheetId = refSheet.sheetId
  } else {
    refSheetId = 99
    requests.push({
      addSheet: {
        properties: { sheetId: refSheetId, title: 'Reference', gridProperties: { frozenRowCount: 1 } },
      },
    })
  }

  // Apply structural changes first
  if (requests.length) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } })
  }

  // ── Build Reference tab data ───────────────────────────────────
  const refGroups = [
    { header: 'career_areas', field: 'career_areas' },
    { header: 'climate_areas', field: 'climate_areas' },
    { header: 'sectors', field: 'sectors' },
    { header: 'topics (strengths/general/top)', field: 'topics' },
    { header: 'career_level', field: 'career_level' },
    { header: 'education_level', field: 'education_level' },
    { header: 'years_experience', field: 'years_experience' },
    { header: 'years_climate_experience', field: 'years_climate_experience' },
    { header: 'employment_situation', field: 'employment_situation' },
    { header: 'management_experience', field: 'management_experience' },
    { header: 'business_experience', field: 'business_experience' },
    { header: 'international_experience', field: 'international_experience' },
    { header: 'nonprofit_board_experience', field: 'nonprofit_board_experience' },
  ]

  const maxRefRows = Math.max(...refGroups.map(g => Object.keys(FIELDS[g.field]).length))
  const refHeaders = refGroups.map(g => g.header)
  const refLabelHeaders = refGroups.map(g => g.header + ' (label)')
  const refData = [refHeaders.flatMap((h, i) => [h, refLabelHeaders[i]])]
  for (let i = 0; i < maxRefRows; i++) {
    const row = refGroups.flatMap(g => {
      const entries = Object.entries(FIELDS[g.field])
      return entries[i] ? [entries[i][0], entries[i][1]] : ['', '']
    })
    refData.push(row)
  }

  console.log('Writing Reference tab...')
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Reference!A1',
    valueInputOption: 'RAW',
    requestBody: { values: refData },
  })

  // ── Write Profiles headers ─────────────────────────────────────
  console.log('Writing Profiles headers...')
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Profiles!A1',
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] },
  })

  // ── Apply validation, formatting, notes ────────────────────────
  console.log('Applying data validation and formatting...')
  const batchRequests = []

  // Bold + background on Profiles header
  batchRequests.push({
    repeatCell: {
      range: { sheetId: profilesSheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  })

  // Protect Profiles header
  batchRequests.push({
    addProtectedRange: {
      protectedRange: {
        range: { sheetId: profilesSheetId, startRowIndex: 0, endRowIndex: 1 },
        description: 'Header row — do not edit',
        warningOnly: true,
      },
    },
  })

  // Bold + background on Reference header
  batchRequests.push({
    repeatCell: {
      range: { sheetId: refSheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: {
        userEnteredFormat: {
          textFormat: { bold: true },
          backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 },
        },
      },
      fields: 'userEnteredFormat(textFormat,backgroundColor)',
    },
  })

  // Dropdown validation for single-select columns (labels where possible)
  for (const [header, config] of Object.entries(DROPDOWN_FIELDS)) {
    const colIndex = HEADERS.indexOf(header)
    if (colIndex === -1) continue

    const values = config.values ?? Object.values(FIELDS[config.field])
    batchRequests.push({
      setDataValidation: {
        range: {
          sheetId: profilesSheetId,
          startRowIndex: 1,
          endRowIndex: MAX_DATA_ROWS + 1,
          startColumnIndex: colIndex,
          endColumnIndex: colIndex + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: values.map(v => ({ userEnteredValue: v })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    })
  }

  // Header notes
  for (const [header, note] of Object.entries(NOTES)) {
    const colIndex = HEADERS.indexOf(header)
    if (colIndex === -1) continue
    batchRequests.push({
      updateCells: {
        range: { sheetId: profilesSheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
        rows: [{ values: [{ note }] }],
        fields: 'note',
      },
    })
  }

  // Auto-resize columns
  batchRequests.push({
    autoResizeDimensions: {
      dimensions: { sheetId: profilesSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: HEADERS.length },
    },
  })
  batchRequests.push({
    autoResizeDimensions: {
      dimensions: { sheetId: refSheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: refGroups.length * 2 },
    },
  })

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: batchRequests },
  })

  console.log(`\nDone! Sheet configured:`)
  console.log(`  ${url}`)
  console.log(`\nThe "Profiles" tab has:`)
  console.log(`  - ${HEADERS.length} column headers with hover notes`)
  console.log(`  - Dropdown validation on ${Object.keys(DROPDOWN_FIELDS).length} columns`)
  console.log(`  - Protected header row`)
  console.log(`\nThe "Reference" tab lists all valid IDs and labels.`)
  console.log(`\nTo import: npm run import -- ${url}`)
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
