import { useEffect, useState } from 'react'

export default function App() {
  const [greetings, setGreetings] = useState([])
  const [error, setError] = useState('')

  async function load() {
    const res = await fetch('/api/greetings')
    if (!res.ok) throw new Error('failed to load')
    setGreetings(await res.json())
  }

  useEffect(() => {
    load().catch(() => setError('Could not reach the server.'))
  }, [])

  async function onSubmit(e) {
    e.preventDefault()
    const form = e.target
    const res = await fetch('/api/greetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form))),
    })
    if (!res.ok) return setError('Could not save your greeting.')
    setError('')
    form.reset()
    await load()
  }

  return (
    <main style={{ maxWidth: 560, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui' }}>
      <h1>Connected in Climate</h1>
      <p>Hello world: this page, the API and Postgres are all talking to each other.</p>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.5rem' }}>
        <input name="name" placeholder="Your name" required maxLength={100} />
        <input name="message" placeholder="Say hello" required maxLength={500} />
        <button type="submit">Post</button>
      </form>
      {error && <p role="alert">{error}</p>}
      <ul>
        {greetings.map((g) => (
          <li key={g.id}>
            <strong>{g.name}</strong>: {g.message}
          </li>
        ))}
      </ul>
    </main>
  )
}
