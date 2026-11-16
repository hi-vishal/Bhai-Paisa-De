import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { haptic, sfx } from '../lib/sound'

type Tone = 'get' | 'owe' | 'sats' | 'cash' | 'paper'
type Toast = { id: number; text: string; emoji?: string; tone: Tone; tilt: number }
type Ctx = (text: string, opts?: { emoji?: string; tone?: Tone; silent?: boolean }) => void

const ToastCtx = createContext<Ctx>(() => {})

/** Toasts get slapped on like stickers, slightly crooked. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const n = useRef(0)
  const push: Ctx = useCallback((text, opts = {}) => {
    const id = ++n.current
    const tone = opts.tone ?? 'paper'
    if (!opts.silent) {
      if (tone === 'owe') {
        sfx.error()
        haptic([20, 40, 20])
      } else sfx.pop()
    }
    setItems((xs) => [...xs.slice(-2), { id, text, emoji: opts.emoji, tone, tilt: (Math.random() - 0.5) * 5 }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), tone === 'owe' ? 4200 : 2800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              className={`toast toast--${t.tone}`}
              initial={{ y: -80, scale: 1.4, rotate: t.tilt * 4, opacity: 0 }}
              animate={{ y: 0, scale: 1, rotate: t.tilt, opacity: 1 }}
              exit={{ y: -40, opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 520, damping: 22 }}
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
            >
              {t.emoji && <span className="toast__emoji">{t.emoji}</span>}
              <span>{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
