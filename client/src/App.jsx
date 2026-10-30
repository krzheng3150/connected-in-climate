import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import RequireAuth from './components/RequireAuth.jsx'
import RequireAdmin from './components/RequireAdmin.jsx'
import Landing from './pages/Landing.jsx'
import Dashboard from './pages/Dashboard.jsx'
import NotFound from './pages/NotFound.jsx'

export default function App() {
  const { user } = useAuth()

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <Landing />} />
      <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/matches/:matchId" element={<RequireAuth><Placeholder title="Match Detail" /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><RequireAdmin><Placeholder title="Admin Panel" /></RequireAdmin></RequireAuth>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function Placeholder({ title }) {
  return (
    <div className="page">
      <main className="page-body">
        <h2>{title}</h2>
        <p className="placeholder-text">Coming soon.</p>
      </main>
    </div>
  )
}
