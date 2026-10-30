import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { migrate, pool } from './db.js'
import matchRouter from './match-api.js'
import actionRouter from './action-api.js'
import feedbackRouter from './feedback-api.js'
import adminRouter from './admin-api.js'
import { isMentor, isMentee } from './roles.js'

const app = express()
const port = process.env.PORT || 3000
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
})

function getAdminEmails() {
  return new Set(
    (process.env.ADMIN_EMAILS || '').split(',').map(e => e.toLowerCase().trim()).filter(Boolean),
  )
}

app.get('/api/profiles/me', async (req, res, next) => {
  try {
    const { email } = req.query
    if (!email) return res.status(400).json({ error: 'email query param is required' })
    const normalEmail = email.toLowerCase().trim()
    const result = await pool.query(
      'SELECT email, name, role, payload FROM user_profiles WHERE email = $1',
      [normalEmail],
    )
    const isAdmin = getAdminEmails().has(normalEmail)
    if (result.rows.length === 0) {
      if (!isAdmin) return res.status(404).json({ error: 'profile not found' })
      return res.json({
        email: normalEmail,
        name: normalEmail.split('@')[0],
        role: null,
        is_mentor: false,
        is_mentee: false,
        preferred_name: null,
        is_admin: true,
      })
    }
    const row = result.rows[0]
    res.json({
      email: row.email,
      name: row.name,
      role: row.role,
      is_mentor: isMentor(row.role),
      is_mentee: isMentee(row.role),
      preferred_name: row.payload?.preferred_name || null,
      is_admin: isAdmin,
    })
  } catch (err) {
    next(err)
  }
})

app.use('/api/matches', matchRouter)
app.use('/api/actions', actionRouter)
app.use('/api/feedback', feedbackRouter)
app.use('/api/admin', adminRouter)

app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

// In production the built React app is served by this same server.
app.use(express.static(clientDist))
app.use((_req, res) => res.sendFile(path.join(clientDist, 'index.html')))

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'internal error' })
})

await migrate()
app.listen(port, () => console.log(`listening on :${port}`))
