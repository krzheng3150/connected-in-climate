import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { migrate, pool } from './db.js'
import matchRouter from './match-api.js'
import actionRouter from './action-api.js'
import feedbackRouter from './feedback-api.js'
import adminRouter from './admin-api.js'

const app = express()
const port = process.env.PORT || 3000
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
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
