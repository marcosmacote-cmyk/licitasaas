import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initSentry, SentryErrorBoundary } from './lib/sentry'
import './index.css'
import App from './App.tsx'

// Initialize Sentry BEFORE rendering (no-ops if DSN not set)
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>
      <h2>Algo deu errado</h2>
      <p>O erro foi reportado automaticamente. Tente recarregar a página.</p>
      <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', cursor: 'pointer' }}>
        Recarregar
      </button>
    </div>}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
)
