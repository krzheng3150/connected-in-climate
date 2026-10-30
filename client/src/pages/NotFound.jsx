import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="landing">
      <h1>Page not found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link to="/" className="back-link">Back to home</Link>
    </div>
  )
}
