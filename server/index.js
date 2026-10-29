import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { migrate, pool } from './db.js'

const app = express()
const port = process.env.PORT || 3000
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist')

app.use(express.json())

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ ok: true })
})

app.get('/api/greetings', async (_req, res) => {
  const { rows } = await pool.query('SELECT id, name, message, created_at FROM greetings ORDER BY id DESC LIMIT 50')
  res.json(rows)
})

app.post('/api/greetings', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 100)
  const message = String(req.body?.message ?? '').trim().slice(0, 500)
  if (!name || !message) return res.status(400).json({ error: 'name and message are required' })
  const { rows } = await pool.query(
    'INSERT INTO greetings (name, message) VALUES ($1, $2) RETURNING id, name, message, created_at',
    [name, message],
  )
  res.status(201).json(rows[0])
})

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
