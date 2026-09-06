import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { GymProvider } from './gym/GymContext'
import { ToastProvider } from './ui'

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Service worker registration failed, app still works
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <GymProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </GymProvider>
    </AuthProvider>
  </StrictMode>,
)
