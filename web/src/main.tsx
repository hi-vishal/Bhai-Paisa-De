import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource/kalam/latin-400.css'
import '@fontsource/kalam/latin-700.css'
import './styles/app.css'
import { App } from './App'
import { LangProvider } from './lib/i18n'
import { SessionProvider } from './lib/session'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './components/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
      <LangProvider>
        <SessionProvider>
          <ToastProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </SessionProvider>
      </LangProvider>
      </ThemeProvider>
    </MotionConfig>
  </StrictMode>,
)
