#!/usr/bin/env node
// One-time script to set up the production template folder with:
//   - Goals & Actions (Google Doc with placeholders)
//   - Meeting Notes/ (subfolder)
//     - Session Log (Google Sheet with placeholders)

import { google } from 'googleapis'

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
)
auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN })

const drive = google.drive({ version: 'v3', auth })
const docs = google.docs({ version: 'v1', auth })
const sheets = google.sheets({ version: 'v4', auth })

const TEMPLATE_ID = process.env.RESOURCES_TEMPLATE_FOLDER_ID || '1-H8jxZtsVjiSUY9xTdIoVdMD6O3pGJM8'

// Check current contents
const existing = await drive.files.list({
  q: `'${TEMPLATE_ID}' in parents and trashed = false`,
  fields: 'files(id,name,mimeType)',
  orderBy: 'name',
})

console.log('Current template folder contents:')
for (const f of existing.data.files) {
  console.log(`  ${f.name} (${f.mimeType})`)
}

// Find or create the Goals & Actions doc
let docId
const existingDoc = existing.data.files.find(f => f.mimeType === 'application/vnd.google-apps.document')
if (existingDoc) {
  docId = existingDoc.id
  await drive.files.update({ fileId: docId, requestBody: { name: 'Goals & Actions' } })
  // Clear and rewrite content
  const docContent = await docs.documents.get({ documentId: docId })
  const endIndex = docContent.data.body.content.at(-1)?.endIndex || 1
  if (endIndex > 2) {
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } }] },
    })
  }
  console.log('\nUpdated existing doc → "Goals & Actions"')
} else {
  const newDoc = await drive.files.create({
    requestBody: { name: 'Goals & Actions', mimeType: 'application/vnd.google-apps.document', parents: [TEMPLATE_ID] },
    fields: 'id',
  })
  docId = newDoc.data.id
  console.log('\nCreated "Goals & Actions" doc')
}

await docs.documents.batchUpdate({
  documentId: docId,
  requestBody: {
    requests: [{
      insertText: {
        location: { index: 1 },
        text: 'Mentorship: {{MENTOR_NAME}} & {{MENTEE_NAME}}\nDate: {{MATCH_DATE}}\nMentor email: {{MENTOR_EMAIL}}\nMentee email: {{MENTEE_EMAIL}}\n\nGoals:\n- \n\nAction Items:\n- \n',
      },
    }],
  },
})
console.log('  Added placeholder content to doc')

// Find or create the Meeting Notes subfolder
let subFolderId
const existingSub = existing.data.files.find(f => f.mimeType === 'application/vnd.google-apps.folder' && f.name === 'Meeting Notes')
if (existingSub) {
  subFolderId = existingSub.id
  console.log('\n"Meeting Notes" subfolder already exists')
} else {
  const sub = await drive.files.create({
    requestBody: { name: 'Meeting Notes', mimeType: 'application/vnd.google-apps.folder', parents: [TEMPLATE_ID] },
    fields: 'id',
  })
  subFolderId = sub.data.id
  console.log('\nCreated "Meeting Notes" subfolder')
}

// Check if Session Log already exists in subfolder
const subChildren = await drive.files.list({
  q: `'${subFolderId}' in parents and trashed = false`,
  fields: 'files(id,name,mimeType)',
})
const existingSheet = subChildren.data.files.find(f => f.mimeType === 'application/vnd.google-apps.spreadsheet')

let sheetId
if (existingSheet) {
  sheetId = existingSheet.id
  console.log('"Session Log" sheet already exists, updating content...')
} else {
  const sheet = await drive.files.create({
    requestBody: { name: 'Session Log', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [subFolderId] },
    fields: 'id',
  })
  sheetId = sheet.data.id
  console.log('Created "Session Log" sheet')
}

await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: 'Sheet1!A1:C3',
  valueInputOption: 'RAW',
  requestBody: {
    values: [
      ['Session Log: {{MENTOR_NAME}} & {{MENTEE_NAME}}', '', ''],
      ['Date', 'Notes', 'Action Items'],
      ['{{MATCH_DATE}}', '', ''],
    ],
  },
})
console.log('  Added placeholder content to sheet')

// Final verification
console.log('\n✓ Template folder ready:')
const verify = await drive.files.list({
  q: `'${TEMPLATE_ID}' in parents and trashed = false`,
  fields: 'files(id,name,mimeType)',
  orderBy: 'name',
})
for (const f of verify.data.files) {
  console.log(`  ${f.name} (${f.mimeType})`)
  if (f.mimeType === 'application/vnd.google-apps.folder') {
    const children = await drive.files.list({
      q: `'${f.id}' in parents and trashed = false`,
      fields: 'files(name,mimeType)',
    })
    for (const c of children.data.files) {
      console.log(`    ${c.name} (${c.mimeType})`)
    }
  }
}
