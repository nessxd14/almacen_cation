import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import WmsUI from './WmsUI.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <WmsUI />
  </StrictMode>,
)
