import { useState } from 'react'

function shuffle(items) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Renders checkbox options in a random order, fixed for the lifetime of the mount
// (so the list doesn't reshuffle on every re-render/click).
// options: [{ id, label }]; checked: { [id]: boolean }; onToggle(id)
export default function ShuffledCheckboxList({ options, checked, onToggle }) {
  const [ordered] = useState(() => shuffle(options))
  return ordered.map(o => (
    <label key={o.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
      <input type="checkbox" checked={!!checked[o.id]} onChange={() => onToggle(o.id)} style={{ marginTop: '0.2rem' }} />
      <span>{o.label}</span>
    </label>
  ))
}
