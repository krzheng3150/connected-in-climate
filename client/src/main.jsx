import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ClerkProvider } from '@clerk/react'
import { AuthProvider } from './context/AuthContext.jsx'
import App from './App.jsx'
import './index.css'

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

import { AUTH_ENABLED } from './config.js'

if (!AUTH_ENABLED) {
  const originalFetch = window.fetch
  window.fetch = function (url, opts = {}) {
    if (typeof url === 'string' && url.startsWith('/api/')) {
      let email
      try { email = sessionStorage.getItem('test_email') } catch {}
      if (email) {
        opts = { ...opts, headers: { ...opts.headers, 'x-user-email': email } }
      }
    }
    return originalFetch.call(this, url, opts)
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPubKey}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ClerkProvider>
  </StrictMode>,
)
