import { motion } from 'framer-motion'
import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import { useInstall } from '../lib/install'
import { ThemeToggle } from './bits'
import { Press } from './Press'
import { Sheet } from './Sheet'

export function TopBar({ title, back, right, sub }: { title: ReactNode; back?: string | true; right?: ReactNode; sub?: ReactNode }) {
  const nav = useNavigate()
  return (
    <header className="topbar">
      {back && (
        <motion.button
          className="iconbtn"
          aria-label="Back"
          whileTap={{ x: 2, y: 2, boxShadow: '0 0 0 #000' }}
          onClick={() => {
            sfx.tap()
            if (back === true) {
              if (window.history.length > 1) nav(-1)
              else nav('/')
            } else nav(back)
          }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 4L7 12l8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </motion.button>
      )}
      <div className="topbar__title">
        <h1>{title}</h1>
        {sub && <div className="topbar__sub">{sub}</div>}
      </div>
      <div className="topbar__right">{right ?? <HelpButton />}</div>
    </header>
  )
}

const Icon = {
  home: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" fill="currentColor" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  feed: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" stroke="#000" strokeWidth="2" />
      <path d="M7 8h10M7 12h10M7 16h6" stroke="#000" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  dues: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="#000" strokeWidth="2" />
      <path d="M8.5 8h7M8.5 11h7M10.5 8c3 0 3 5.5-1.5 5.5l5 3" fill="none" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  me: (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
      <circle cx="12" cy="8" r="4.5" fill="currentColor" stroke="#000" strokeWidth="2" />
      <path d="M3.5 21c1-4.5 4.5-7 8.5-7s7.5 2.5 8.5 7z" fill="currentColor" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
}

/** "?" in the corner: the how-to and FAQ, one tap from anywhere. */
export function HelpButton() {
  const nav = useNavigate()
  const T = useT()
  return (
    <>
      <ThemeToggle />
      <motion.button
        className="themetog helpbtn"
        aria-label={T('Help', 'Madad')}
        whileTap={{ scale: 0.85, rotate: 10 }}
        onClick={() => {
          sfx.tap()
          nav('/help')
        }}
      >
        ?
      </motion.button>
    </>
  )
}

export function Dock({ onAdd }: { onAdd: () => void }) {
  const T = useT()
  const tab = (to: string, icon: ReactNode, label: string) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `dock__tab${isActive ? ' is-on' : ''}`}
      onClick={() => {
        sfx.tap()
        haptic(5)
      }}
    >
      {icon}
      <span>{label}</span>
    </NavLink>
  )
  return (
    <nav className="dock" aria-label="Main">
      {tab('/', Icon.home, T('Groups', 'Groups'))}
      {tab('/dues', Icon.dues, T('Dues', 'Hisaab'))}
      <motion.button
        className="dock__fab"
        aria-label={T('Add expense', 'Kharcha daal')}
        whileTap={{ scale: 0.9, rotate: -12 }}
        whileHover={{ rotate: 8 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        onClick={() => {
          sfx.pop()
          haptic([6, 30, 10])
          onAdd()
        }}
      >
        <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden>
          <path d="M12 4v16M4 12h16" stroke="#000" strokeWidth="3.6" strokeLinecap="round" />
        </svg>
      </motion.button>
      {tab('/activity', Icon.feed, T('Activity', 'Activity'))}
      {tab('/me', Icon.me, T('Me', 'Main'))}
    </nav>
  )
}

/** Small sticky nudge on home: get the PWA onto the home screen. */
export function InstallNudge() {
  const T = useT()
  const ins = useInstall()
  const [iosOpen, setIosOpen] = useState(false)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('bpd.install.hide') === '1'
    } catch {
      return false
    }
  })
  if (ins.standalone || hidden || (!ins.canPrompt && !ins.ios)) return null
  return (
    <>
      <motion.div className="install stk" initial={{ y: 20, opacity: 0, rotate: 2 }} animate={{ y: 0, opacity: 1, rotate: -1 }} transition={{ delay: 0.5, type: 'spring' }}>
        <span className="install__icon">
          <img src="/icons/icon-192.png" alt="" width={44} height={44} />
        </span>
        <div className="install__text">
          <b>{T('Put me on your home screen', 'Home screen pe chipka de')}</b>
          <span>{T('Opens like an app. No app store.', 'App jaisa khulega. App store ka jhanjhat nahi.')}</span>
        </div>
        <Press tone="ink" size="sm" onClick={() => (ins.canPrompt ? void ins.prompt() : setIosOpen(true))}>
          {T('Add', 'Add kar')}
        </Press>
        <button
          className="install__x"
          aria-label={T('Dismiss', 'Hata')}
          onClick={() => {
            sfx.unpop()
            setHidden(true)
            try {
              localStorage.setItem('bpd.install.hide', '1')
            } catch {
              // ignore
            }
          }}
        >
          ✕
        </button>
      </motion.div>
      <IosInstallSheet open={iosOpen} onClose={() => setIosOpen(false)} />
    </>
  )
}

export function IosInstallSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const T = useT()
  return (
    <Sheet open={open} onClose={onClose} title={T('Add to Home Screen', 'Home Screen pe add kar')}>
      <ol className="steps">
        <li>
          <span className="steps__n">1</span>
          <span>
            {T('Tap', 'Neeche')}{' '}
            <svg viewBox="0 0 24 24" width="22" height="22" className="inline-icon" aria-label="Share">
              <path d="M12 3v12M7 8l5-5 5 5" fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M5 11v9h14v-9" fill="none" stroke="#007AFF" strokeWidth="2.2" strokeLinejoin="round" />
            </svg>{' '}
            {T('Share in Safari', 'Share daba (Safari mein)')}
          </span>
        </li>
        <li>
          <span className="steps__n">2</span>
          <span>{T('Scroll and tap “Add to Home Screen”', '“Add to Home Screen” dhundh ke daba')}</span>
        </li>
        <li>
          <span className="steps__n">3</span>
          <span>
            {T(
              'Open it from your home screen. Already have an account in Safari? There: Me → Log in on another phone → Copy link. In the app: “I have the app on another phone” → paste it.',
              'Home screen se khol. Safari mein account hai? Wahan: Main → Doosre phone pe login → Link copy. App mein: “Doosre phone pe app hai” → paste kar.',
            )}
          </span>
        </li>
      </ol>
      <Press tone="sats" block onClick={onClose}>
        {T('Got it', 'Samajh gaya')}
      </Press>
    </Sheet>
  )
}
