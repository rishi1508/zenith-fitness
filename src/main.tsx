import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth/AuthContext'
import { GymProvider } from './gym/GymContext'
import { ToastProvider, ConfirmProvider } from './ui'
import { PremiumProvider } from './premium'
import { ErrorBoundary } from './components/ErrorBoundary'

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
    <ErrorBoundary>
    <AuthProvider>
      <GymProvider>
        <PremiumProvider>
          <ToastProvider>
            <ConfirmProvider>
              <App />
            </ConfirmProvider>
          </ToastProvider>
        </PremiumProvider>
      </GymProvider>
    </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
