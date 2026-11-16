import { useEffect, useState } from 'react'

// Chrome/Edge/Android hand us an install prompt; iOS needs Share → Add to Home Screen.
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: BIP | null = null
const subs = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BIP
    subs.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    subs.forEach((f) => f())
  })
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true)

export const isIOS = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    subs.add(f)
    return () => void subs.delete(f)
  }, [])
  return {
    standalone: isStandalone(),
    canPrompt: !!deferred,
    ios: isIOS(),
    async prompt() {
      if (!deferred) return false
      await deferred.prompt()
      const r = await deferred.userChoice
      deferred = null
      subs.forEach((f) => f())
      return r.outcome === 'accepted'
    },
  }
}
