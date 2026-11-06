#!/usr/bin/env node
//
// Clean up Google Drive folders created by tests/demos.
//
// Usage:
//   node --env-file=.env scripts/cleanup-drive.js          # dry run (list only)
//   node --env-file=.env scripts/cleanup-drive.js --delete  # actually delete

import { google } from 'googleapis'

const OUTPUT_FOLDER_ID = process.env.RESOURCES_OUTPUT_FOLDER_ID || '18abmqQpxuEJdkYoHax2IZdLbVDYTVE__'
const doDelete = process.argv.includes('--delete')

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_OAUTH_CLIENT_ID,
  process.env.GOOGLE_OAUTH_CLIENT_SECRET,
)
auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN })

const drive = google.drive({ version: 'v3', auth })

const outputResult = await drive.files.list({
  q: `'${OUTPUT_FOLDER_ID}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
  fields: 'files(id,name,createdTime)',
  orderBy: 'createdTime desc',
})

const orphanResult = await drive.files.list({
  q: "name contains 'TEST_' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  fields: 'files(id,name,createdTime)',
  orderBy: 'createdTime desc',
})

const outputFolders = outputResult.data.files
const orphanFolders = orphanResult.data.files
const allFolders = [...outputFolders, ...orphanFolders]

if (allFolders.length === 0) {
  console.log('No test folders found.')
  process.exit(0)
}

if (outputFolders.length > 0) {
  console.log(`Match resource folders (${outputFolders.length}):\n`)
  for (const f of outputFolders) {
    console.log(`  ${f.name}  (${new Date(f.createdTime).toLocaleString()})  id=${f.id}`)
  }
}

if (orphanFolders.length > 0) {
  console.log(`\nOrphan test folders (${orphanFolders.length}):\n`)
  for (const f of orphanFolders) {
    console.log(`  ${f.name}  (${new Date(f.createdTime).toLocaleString()})  id=${f.id}`)
  }
}

if (!doDelete) {
  console.log(`\nTotal: ${allFolders.length} folder(s). Dry run — pass --delete to remove.`)
  process.exit(0)
}

const { cleanupDriveFolders } = await import('./cleanup-drive-lib.js')
const { deleted } = await cleanupDriveFolders()
console.log(`\nDeleted ${deleted} folder(s).`)
