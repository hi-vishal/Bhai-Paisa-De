import confetti from 'canvas-confetti'
import { motion } from 'framer-motion'
import QRCode from 'qrcode'
import { useEffect, useState, type ReactNode } from 'react'
import { useLang } from '../lib/i18n'
import { sfx, haptic } from '../lib/sound'
import { useTheme, type ThemePref } from '../lib/theme'

/**
 * Animated emoji (CC BY 4.0, credited under Help → Licenses). Falls back to the system emoji
 * if the network says no, so nothing ever renders as a broken image.
 */
export function Emoji({ char, size = 64, className = '' }: { char: string; size?: number; className?: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading')
  const code = [...char]
    .map((c) => c.codePointAt(0)!.toString(16))
    .filter((c) => c !== 'fe0f')
    .join('_')
  // the phone's own emoji shows at once; the animated one fades in over it when it arrives
  return (
    <span className={`emoji ${className}`} style={{ width: size, height: size }} aria-hidden>
      {state !== 'ok' && (
        <span className="emoji-fallback" style={{ fontSize: size * 0.82 }}>
          {char}
        </span>
      )}
      {state !== 'failed' && (
        <img
          src={`https://fonts.gstatic.com/s/e/notoemoji/latest/${code}/512.webp`}
          width={size}
          height={size}
          alt=""
          decoding="async"
          className={state === 'ok' ? 'is-in' : ''}
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
        />
      )}
    </span>
  )
}

const shapes = (() => {
  try {
    return ['₹', '💸', '🤑'].map((text) => confetti.shapeFromText({ text, scalar: 2.2 }))
  } catch {
    return undefined
  }
})()

export function blast(kind: 'money' | 'party' = 'money') {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const colors = ['#FFC21A', '#FF3D8B', '#B8F25B', '#4FD6E8', '#B9A4FF', '#000000']
  confetti({ particleCount: 90, spread: 80, origin: { y: 0.65 }, colors, scalar: 1.1, ticks: 220 })
  if (kind === 'money' && shapes)
    setTimeout(() => confetti({ particleCount: 26, spread: 110, startVelocity: 38, origin: { y: 0.6 }, shapes, scalar: 2.2, ticks: 260, flat: true }), 140)
}

export function QR({ text, size = 240, dim }: { text: string; size?: number; dim?: boolean }) {
  const [svg, setSvg] = useState('')
  useEffect(() => {
    QRCode.toString(text.toUpperCase().startsWith('LN') ? text.toUpperCase() : text, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } })
      .then(setSvg)
      .catch(() => setSvg(''))
  }, [text])
  return <div className={`qr${dim ? ' qr--dim' : ''}`} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code" role="img" />
}

export function LogoMark({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden className="logo-mark">
      <path d="M27 14H73A15 15 0 0 1 88 29V57A15 15 0 0 1 73 72H46L24 90L29 72H27A15 15 0 0 1 12 57V29A15 15 0 0 1 27 14Z" transform="translate(4 4)" fill="#000" />
      <path d="M27 14H73A15 15 0 0 1 88 29V57A15 15 0 0 1 73 72H46L24 90L29 72H27A15 15 0 0 1 12 57V29A15 15 0 0 1 27 14Z" fill="#FFC21A" stroke="#000" strokeWidth="5" strokeLinejoin="round" />
      <g stroke="#000" strokeWidth="6.5" fill="none" strokeLinecap="square">
        <path d="M36 24.5H64" />
        <path d="M36 35.5H64" />
        <path d="M46.5 24.5C61 24.5 61 46.5 39 46.5" strokeLinecap="butt" />
      </g>
      <path d="M37 43H53.5L58 50.5L51.5 51L65 69L42 54.5L49 54Z" fill="#000" stroke="#000" strokeWidth="2.4" strokeLinejoin="round" />
    </svg>
  )
}

export const MAKER = 'Vishal'
export const MAKER_FULL = 'Vishal Gupta'

export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark size={40} />
      <span className="wordmark__text">
        bhai paise
        <br />
        de.
      </span>
    </span>
  )
}

export function LangToggle() {
  const { lang, setLang } = useLang()
  return (
    <button
      type="button"
      className="lang"
      onClick={() => {
        sfx.tap()
        setLang(lang === 'hi' ? 'en' : 'hi')
      }}
      aria-label={lang === 'hi' ? 'Switch to English' : 'Switch to Hinglish'}
    >
      <span className={lang === 'hi' ? 'on' : ''}>हिं</span>
      <span className={lang === 'en' ? 'on' : ''}>EN</span>
      <motion.i layout transition={{ type: 'spring', stiffness: 600, damping: 30 }} className={`lang__pill lang__pill--${lang}`} />
    </button>
  )
}

/** Sun ⇄ moon. Tap flips light/dark; the phone's own setting is in Me → Settings. */
export function ThemeToggle() {
  const { theme, setPref } = useTheme()
  const dark = theme === 'dark'
  return (
    <motion.button
      type="button"
      className="themetog"
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      whileTap={{ scale: 0.85, rotate: -30 }}
      onClick={() => {
        sfx.tap()
        haptic(6)
        setPref(dark ? 'light' : 'dark')
      }}
    >
      <motion.svg viewBox="0 0 24 24" width="20" height="20" aria-hidden animate={{ rotate: dark ? -40 : 0 }} transition={{ type: 'spring', stiffness: 300, damping: 15 }}>
        <mask id="moon-bite">
          <rect width="24" height="24" fill="#fff" />
          <motion.circle r="7" fill="#000" initial={false} cx={dark ? 17 : 30} cy={dark ? 7 : -6} animate={{ cx: dark ? 17 : 30, cy: dark ? 7 : -6 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }} />
        </mask>
        <motion.circle cx="12" cy="12" fill="currentColor" mask="url(#moon-bite)" initial={false} r={dark ? 9 : 5} animate={{ r: dark ? 9 : 5 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }} />
        <motion.g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.4 : 1 }} style={{ transformOrigin: '12px 12px' }}>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${a} 12 12)`} />
          ))}
        </motion.g>
      </motion.svg>
    </motion.button>
  )
}

/** Auto / Light / Dark, for settings. */
export function ThemePicker() {
  const { pref, setPref } = useTheme()
  const { T } = useLang()
  const opts: [ThemePref, string][] = [
    ['system', T('Auto', 'Auto')],
    ['light', T('Light', 'Light')],
    ['dark', T('Dark', 'Dark')],
  ]
  return (
    <div className="seg seg--3" role="radiogroup" aria-label={T('Theme', 'Theme')}>
      {opts.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={pref === k}
          className={`seg__btn${pref === k ? ' is-on' : ''}`}
          onClick={() => {
            sfx.tap()
            setPref(k)
          }}
        >
          {pref === k && <motion.i layoutId="theme-pill" className="seg__pill" transition={{ type: 'spring', stiffness: 500, damping: 32 }} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch${on ? ' switch--on' : ''}`}
      onClick={() => {
        on ? sfx.toggleOff() : sfx.toggleOn()
        onChange(!on)
      }}
    >
      <motion.span className="switch__knob" layout transition={{ type: 'spring', stiffness: 700, damping: 30 }}>
        {on ? '✓' : '✕'}
      </motion.span>
    </button>
  )
}

export function Empty({ emoji, title, body, action }: { emoji: string; title: string; body?: string; action?: ReactNode }) {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 14, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
      <Emoji char={emoji} size={96} />
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </motion.div>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__coin">₹</span>
      {label && <span>{label}</span>}
    </div>
  )
}
