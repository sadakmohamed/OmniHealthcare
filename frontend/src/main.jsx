import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import VirtualCareApp from './virtualcare/VirtualCareApp.jsx'

const standalone = window.location.pathname.startsWith('/virtual-care')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {standalone ? <VirtualCareApp /> : <App />}
  </StrictMode>,
)
