import { google } from 'googleapis'

const OUTPUT_FOLDER_ID = process.env.RESOURCES_OUTPUT_FOLDER_ID || '18abmqQpxuEJdkYoHax2IZdLbVDYTVE__'

function getDrive() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth })
}

async function deleteRecursive(drive, folderId) {
  const children = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,mimeType)',
  })
  for (const child of children.data.files) {
    if (child.mimeType === 'application/vnd.google-apps.folder') {
      await deleteRecursive(drive, child.id)
    } else {
      await drive.files.delete({ fileId: child.id })
    }
  }
  await drive.files.delete({ fileId: folderId })
}

export async function cleanupDriveFolders({ silent = false } = {}) {
  const drive = getDrive()
  if (!drive) {
    if (!silent) console.log('[cleanup] Google OAuth not configured, skipping.')
    return { deleted: 0 }
  }

  const outputResult = await drive.files.list({
    q: `'${OUTPUT_FOLDER_ID}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
    fields: 'files(id,name,createdTime)',
  })

  const orphanResult = await drive.files.list({
    q: "name contains 'TEST_' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: 'files(id,name,createdTime)',
  })

  const allFolders = [...outputResult.data.files, ...orphanResult.data.files]
  if (allFolders.length === 0) return { deleted: 0 }

  let deleted = 0
  for (const f of allFolders) {
    try {
      await deleteRecursive(drive, f.id)
      deleted++
      if (!silent) console.log(`[cleanup] Deleted: ${f.name}`)
    } catch (err) {
      if (!silent) console.warn(`[cleanup] Failed to delete ${f.name}: ${err.message}`)
    }
  }
  return { deleted }
}
