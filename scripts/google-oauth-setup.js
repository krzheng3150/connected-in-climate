#!/usr/bin/env node
//
// One-time setup: obtain a Google OAuth refresh token for the resources feature.
//
// Usage:
//   node scripts/google-oauth-setup.js <client_id> <client_secret>
//
// Opens a browser for you to log in with the dedicated resources Gmail account.
// Prints the refresh token to store as GOOGLE_OAUTH_REFRESH_TOKEN.

import { createServer } from 'node:http'
import { URL } from 'node:url'
import { exec } from 'node:child_process'

const clientId = process.argv[2]
const clientSecret = process.argv[3]

if (!clientId || !clientSecret) {
  console.error('Usage: node scripts/google-oauth-setup.js <client_id> <client_secret>')
  process.exit(1)
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ')

const REDIRECT_PORT = 3456
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
authUrl.searchParams.set('client_id', clientId)
authUrl.searchParams.set('redirect_uri', REDIRECT_URI)
authUrl.searchParams.set('response_type', 'code')
authUrl.searchParams.set('scope', SCOPES)
authUrl.searchParams.set('access_type', 'offline')
authUrl.searchParams.set('prompt', 'consent')

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${REDIRECT_PORT}`)
  if (!url.pathname.startsWith('/callback')) {
    res.writeHead(404)
    res.end()
    return
  }

  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(`<h2>Error: ${error}</h2><p>You can close this tab.</p>`)
    server.close()
    process.exit(1)
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
    res.end('<h2>No authorization code received.</h2>')
    return
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const data = await tokenRes.json()

    if (data.error) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<h2>Token error: ${data.error}</h2><p>${data.error_description || ''}</p>`)
      server.close()
      process.exit(1)
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2>Success!</h2><p>You can close this tab. Check your terminal for the refresh token.</p>')

    console.log('\n✅ OAuth setup complete!\n')
    console.log('Add these to your .env file and GitHub Actions secrets:\n')
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${clientId}`)
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${clientSecret}`)
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${data.refresh_token}`)
    console.log('')

    server.close()
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' })
    res.end(`<h2>Error exchanging code</h2><p>${err.message}</p>`)
    server.close()
    process.exit(1)
  }
})

server.listen(REDIRECT_PORT, () => {
  console.log(`\nOpening browser for Google OAuth consent...\n`)
  console.log(`If the browser doesn't open, visit:\n${authUrl.toString()}\n`)

  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${openCmd} "${authUrl.toString()}"`)
})
