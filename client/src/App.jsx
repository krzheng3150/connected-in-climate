import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth as useClerkAuth } from '@clerk/react'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import Landing from './pages/Landing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import MatchDetail from './pages/MatchDetail.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import About from './pages/About.jsx'
import NotFound from './pages/NotFound.jsx'

class ErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[app] React error:', error, info.componentStack)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <h2>Something went wrong</h2>
          <p>Please refresh the page or contact support.</p>
          <button className="btn-primary" onClick={() => window.location.reload()}>Refresh</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const { isSignedIn, isLoaded } = useClerkAuth()

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={!isLoaded ? null : isSignedIn ? <Navigate to="/dashboard" replace /> : <Landing />} />
        <Route path="/about" element={<About />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/matches/:matchId" element={<RequireAuth><MatchDetail /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminPanel /></RequireAdmin></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}
