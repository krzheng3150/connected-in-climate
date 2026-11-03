import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { google } from 'googleapis'

export function getAuth(scopes) {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY env var is not set')

  let keyFile
  if (raw.trimStart().startsWith('{')) {
    keyFile = join(tmpdir(), 'cic-sa-key.json')
    writeFileSync(keyFile, raw)
  } else {
    keyFile = raw
  }

  return new google.auth.GoogleAuth({ keyFile, scopes })
}
