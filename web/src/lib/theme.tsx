import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type ThemePref = 'system' | 'light' | 'dark'
const KEY = 'bpd.theme'
const COLORS = { light: '#EFE9FF', dark: '#14101D' }

const read = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    // ignore
  }
  return 'system'
}

const media = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null)

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && !!media()?.matches)
  const theme = dark ? 'dark' : 'light'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLORS[theme])
  return theme
}

type Ctx = { pref: ThemePref; theme: 'light' | 'dark'; setPref: (p: ThemePref) => void }
const ThemeCtx = createContext<Ctx>({ pref: 'system', theme: 'light', setPref: () => {} })

/** Light, dark, or follow the phone. Stored per device. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, set] = useState<ThemePref>(read)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    setTheme(apply(pref))
    if (pref !== 'system') return
    const m = media()
    const on = () => setTheme(apply('system'))
    m?.addEventListener('change', on)
    return () => m?.removeEventListener('change', on)
  }, [pref])

  const setPref = useCallback((p: ThemePref) => {
    set(p)
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      // ignore
    }
  }, [])

  return <ThemeCtx.Provider value={{ pref, theme, setPref }}>{children}</ThemeCtx.Provider>
}

export const useTheme = () => useContext(ThemeCtx)
