import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { google } from 'googleapis'

function getOAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  )
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN })
  return auth
}

let drive, docs, sheets
let templateFolderId, outputFolderId, createdFolderId

const cleanup = []

before(async () => {
  const auth = getOAuth()
  drive = google.drive({ version: 'v3', auth })
  docs = google.docs({ version: 'v1', auth })
  sheets = google.sheets({ version: 'v4', auth })

  // Create a test template folder
  const folder = await drive.files.create({
    requestBody: { name: 'TEST_TEMPLATE', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  })
  templateFolderId = folder.data.id
  cleanup.push(templateFolderId)

  // Create a test output folder
  const out = await drive.files.create({
    requestBody: { name: 'TEST_OUTPUT', mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  })
  outputFolderId = out.data.id
  cleanup.push(outputFolderId)

  // Create a subfolder
  const sub = await drive.files.create({
    requestBody: { name: 'Meeting Notes', mimeType: 'application/vnd.google-apps.folder', parents: [templateFolderId] },
    fields: 'id',
  })
  cleanup.push(sub.data.id)

  // Create a Google Doc with placeholders in the template folder
  const doc = await drive.files.create({
    requestBody: { name: 'Goals & Actions', mimeType: 'application/vnd.google-apps.document', parents: [templateFolderId] },
    fields: 'id',
  })
  cleanup.push(doc.data.id)
  await docs.documents.batchUpdate({
    documentId: doc.data.id,
    requestBody: {
      requests: [
        { insertText: { location: { index: 1 }, text: 'Mentorship: {{MENTOR_NAME}} & {{MENTEE_NAME}}\nDate: {{MATCH_DATE}}\nMentor email: {{MENTOR_EMAIL}}\nMentee email: {{MENTEE_EMAIL}}\n\nGoals:\n- \n\nAction Items:\n- \n' } },
      ],
    },
  })

  // Create a Google Sheet with placeholders in the subfolder
  const sheet = await drive.files.create({
    requestBody: { name: 'Session Log', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [sub.data.id] },
    fields: 'id',
  })
  cleanup.push(sheet.data.id)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheet.data.id,
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
})

after(async () => {
  for (const id of cleanup) {
    try { await drive.files.delete({ fileId: id }) } catch { /* best effort */ }
  }
  if (createdFolderId) {
    await deleteRecursive(createdFolderId)
  }
})

async function deleteRecursive(folderId) {
  try {
    const children = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'files(id,mimeType)',
    })
    for (const child of children.data.files) {
      if (child.mimeType === 'application/vnd.google-apps.folder') {
        await deleteRecursive(child.id)
      } else {
        await drive.files.delete({ fileId: child.id })
      }
    }
    await drive.files.delete({ fileId: folderId })
  } catch { /* best effort */ }
}

async function getDocText(docId) {
  const doc = await docs.documents.get({ documentId: docId })
  let text = ''
  for (const el of doc.data.body.content) {
    if (el.paragraph) {
      for (const e of el.paragraph.elements) {
        if (e.textRun) text += e.textRun.content
      }
    }
  }
  return text
}

async function getSheetValues(sheetId) {
  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1:C3',
  })
  return result.data.values
}

describe('resources: template copy with parameterization', () => {
  it('copies folder structure and replaces placeholders', async () => {
    process.env.RESOURCES_TEMPLATE_FOLDER_ID = templateFolderId
    process.env.RESOURCES_OUTPUT_FOLDER_ID = outputFolderId
    const { createMatchResources } = await import('./resources.js')

    const folderUrl = await createMatchResources({
      mentorEmail: 'test-mentor@example.com',
      mentorName: 'Alex Chen',
      menteeEmail: 'test-mentee@example.com',
      menteeName: 'Jane Doe',
      matchDate: 'November 5, 2026',
    })

    assert.ok(folderUrl, 'should return a folder URL')
    assert.ok(folderUrl.includes('drive.google.com'), 'should be a Drive URL')

    // Extract folder ID from URL
    const match = folderUrl.match(/\/folders\/([^/?]+)/)
    assert.ok(match, 'URL should contain folder ID')
    createdFolderId = match[1]

    // Verify folder structure: root should have "Goals & Actions" doc + "Meeting Notes" subfolder
    const rootChildren = await drive.files.list({
      q: `'${createdFolderId}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
      orderBy: 'name',
    })
    const rootNames = rootChildren.data.files.map(f => f.name).sort()
    assert.deepEqual(rootNames, ['Goals & Actions', 'Meeting Notes'])

    const docFile = rootChildren.data.files.find(f => f.name === 'Goals & Actions')
    const subFolder = rootChildren.data.files.find(f => f.name === 'Meeting Notes')
    assert.equal(docFile.mimeType, 'application/vnd.google-apps.document')
    assert.equal(subFolder.mimeType, 'application/vnd.google-apps.folder')

    // Verify doc content has replacements applied
    const docText = await getDocText(docFile.id)
    assert.ok(docText.includes('Alex Chen'), 'doc should contain mentor name')
    assert.ok(docText.includes('Jane Doe'), 'doc should contain mentee name')
    assert.ok(docText.includes('November 5, 2026'), 'doc should contain match date')
    assert.ok(docText.includes('test-mentor@example.com'), 'doc should contain mentor email')
    assert.ok(docText.includes('test-mentee@example.com'), 'doc should contain mentee email')
    assert.ok(!docText.includes('{{MENTOR_NAME}}'), 'doc should not contain unreplaced placeholders')
    assert.ok(!docText.includes('{{MENTEE_NAME}}'), 'doc should not contain unreplaced placeholders')

    // Verify static content is preserved
    assert.ok(docText.includes('Goals:'), 'doc should preserve static content')
    assert.ok(docText.includes('Action Items:'), 'doc should preserve static content')

    // Verify subfolder has the sheet
    const subChildren = await drive.files.list({
      q: `'${subFolder.id}' in parents and trashed = false`,
      fields: 'files(id,name,mimeType)',
    })
    assert.equal(subChildren.data.files.length, 1)
    const sheetFile = subChildren.data.files[0]
    assert.equal(sheetFile.name, 'Session Log')
    assert.equal(sheetFile.mimeType, 'application/vnd.google-apps.spreadsheet')

    // Verify sheet content has replacements applied
    const values = await getSheetValues(sheetFile.id)
    assert.ok(values[0][0].includes('Alex Chen'), 'sheet should contain mentor name')
    assert.ok(values[0][0].includes('Jane Doe'), 'sheet should contain mentee name')
    assert.equal(values[2][0], 'November 5, 2026', 'sheet should contain match date')
    assert.ok(!values[0][0].includes('{{'), 'sheet should not contain unreplaced placeholders')

    // Verify static content preserved
    assert.equal(values[1][0], 'Date')
    assert.equal(values[1][1], 'Notes')
    assert.equal(values[1][2], 'Action Items')
  })
})
