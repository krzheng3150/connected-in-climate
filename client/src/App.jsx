import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth as useClerkAuth } from '@clerk/react'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import Landing from './pages/Landing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import MatchDetail from './pages/MatchDetail.jsx'
import AdminPanel from './pages/AdminPanel.jsx'
import NotFound from './pages/NotFound.jsx'

export default function App() {
  const { isSignedIn, isLoaded } = useClerkAuth()

  return (
    <Routes>
      <Route path="/" element={!isLoaded ? null : isSignedIn ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/matches/:matchId" element={<RequireAuth><MatchDetail /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminPanel /></RequireAdmin></RequireAuth>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
