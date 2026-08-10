import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import { SucursalProvider } from './lib/SucursalContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <SucursalProvider>
        <App />
      </SucursalProvider>
    </AuthProvider>
  </StrictMode>,
)
