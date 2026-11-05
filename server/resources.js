import { google } from 'googleapis'

const MAX_DEPTH = 5

const SUPPORTED_TYPES = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
])
const FOLDER_TYPE = 'application/vnd.google-apps.folder'

const TEMPLATE_FOLDER_ID = '1-H8jxZtsVjiSUY9xTdIoVdMD6O3pGJM8'
const OUTPUT_FOLDER_ID = '18abmqQpxuEJdkYoHax2IZdLbVDYTVE__'

let _drive = null
let _docs = null
let _sheets = null

function getClients() {
  if (!_drive) {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN are required')
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret)
    auth.setCredentials({ refresh_token: refreshToken })

    _drive = google.drive({ version: 'v3', auth })
    _docs = google.docs({ version: 'v1', auth })
    _sheets = google.sheets({ version: 'v4', auth })
  }
  return { drive: _drive, docs: _docs, sheets: _sheets }
}

const PLACEHOLDERS = [
  { token: '{{MENTOR_NAME}}', key: 'mentorName' },
  { token: '{{MENTEE_NAME}}', key: 'menteeName' },
  { token: '{{MENTOR_EMAIL}}', key: 'mentorEmail' },
  { token: '{{MENTEE_EMAIL}}', key: 'menteeEmail' },
  { token: '{{MATCH_DATE}}', key: 'matchDate' },
]

async function applyReplacements(fileId, mimeType, vars) {
  const { docs, sheets } = getClients()
  const requests = PLACEHOLDERS
    .filter(p => vars[p.key])
    .map(p => ({ replaceAllText: { containsText: { text: p.token, matchCase: true }, replaceText: vars[p.key] } }))

  if (requests.length === 0) return

  if (mimeType === 'application/vnd.google-apps.document') {
    await docs.documents.batchUpdate({ documentId: fileId, requestBody: { requests } })
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    const sheetRequests = PLACEHOLDERS
      .filter(p => vars[p.key])
      .map(p => ({
        findReplace: { find: p.token, replacement: vars[p.key], matchCase: true, allSheets: true },
      }))
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: fileId, requestBody: { requests: sheetRequests } })
  }
}

async function copyFolder(sourceFolderId, parentFolderId, name, vars, depth = 0) {
  if (depth >= MAX_DEPTH) return null
  const { drive } = getClients()

  const folder = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_TYPE, parents: [parentFolderId] },
    fields: 'id,webViewLink',
  })

  const children = await drive.files.list({
    q: `'${sourceFolderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType)',
    orderBy: 'name',
  })

  for (const child of children.data.files) {
    if (child.mimeType === FOLDER_TYPE) {
      await copyFolder(child.id, folder.data.id, child.name, vars, depth + 1)
    } else if (SUPPORTED_TYPES.has(child.mimeType)) {
      const copy = await drive.files.copy({
        fileId: child.id,
        requestBody: { name: child.name, parents: [folder.data.id] },
        fields: 'id',
      })
      await applyReplacements(copy.data.id, child.mimeType, vars)
    }
  }

  return folder.data
}

export async function createMatchResources({ mentorEmail, mentorName, menteeEmail, menteeName, matchDate }) {
  const templateId = process.env.RESOURCES_TEMPLATE_FOLDER_ID || TEMPLATE_FOLDER_ID
  const outputId = process.env.RESOURCES_OUTPUT_FOLDER_ID || OUTPUT_FOLDER_ID

  const { drive } = getClients()
  const vars = { mentorName, menteeName, mentorEmail, menteeEmail, matchDate }
  const folderName = `${menteeName} : ${mentorName}`

  const folder = await copyFolder(templateId, outputId, folderName, vars)
  if (!folder) return null

  // Enable writers (mentor/mentee) to manage sharing themselves
  await drive.files.update({
    fileId: folder.id,
    requestBody: { writersCanShare: true },
  })

  for (const email of [mentorEmail, menteeEmail]) {
    try {
      await drive.permissions.create({
        fileId: folder.id,
        requestBody: { type: 'user', role: 'writer', emailAddress: email },
        sendNotificationEmail: false,
      })
    } catch (err) {
      console.warn(`[resources] could not share with ${email}: ${err.message}`)
    }
  }

  console.log(`[resources] created folder: ${folderName} id=${folder.id}`)
  return folder.webViewLink
}

export function ping() {
  try {
    const { drive } = getClients()
    return drive.files.list({ pageSize: 1 }).then(() => {
      console.log('[resources] token keep-alive OK')
    })
  } catch {
    return Promise.resolve()
  }
}

