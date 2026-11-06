#!/usr/bin/env node
//
// Clean up Google Drive folders created by tests/demos.
// Finds folders in the output directory AND orphaned TEST_ folders.
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

async function deleteRecursive(folderId) {
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
}

// 1. Folders in the output directory (match resource folders from tests/demos)
const outputResult = await drive.files.list({
  q: `'${OUTPUT_FOLDER_ID}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
  fields: 'files(id,name,createdTime)',
  orderBy: 'createdTime desc',
})

// 2. Orphaned TEST_ folders from integration tests (template/output folders at root)
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

console.log(`\nDeleting ${allFolders.length} folder(s)...`)
for (const f of allFolders) {
  try {
    await deleteRecursive(f.id)
    console.log(`  Deleted: ${f.name}`)
  } catch (err) {
    console.error(`  Failed to delete ${f.name}: ${err.message}`)
  }
}
console.log('Done.')
