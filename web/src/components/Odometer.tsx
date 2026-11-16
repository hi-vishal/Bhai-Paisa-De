import { motion, useReducedMotion } from 'framer-motion'

/**
 * Amounts roll like a petrol-pump meter. Each digit is a 0–9 reel; non-digits sit still.
 * Positions are keyed from the right so ₹999 → ₹1,000 grows a new reel on the left.
 */
export function Odometer({ value, className = '' }: { value: string; className?: string }) {
  const reduce = useReducedMotion()
  const chars = [...value]
  return (
    <span className={`odo ${className}`} aria-label={value} role="text">
      {chars.map((ch, i) => {
        const key = chars.length - i
        if (!/\d/.test(ch) || reduce)
          return (
            <span key={`s${key}-${ch}`} className="odo__ch" aria-hidden>
              {ch}
            </span>
          )
        const d = Number(ch)
        return (
          <span key={`d${key}`} className="odo__reel" aria-hidden>
            <motion.span
              className="odo__strip"
              initial={false}
              animate={{ y: `${-d * 10}%` }}
              transition={{ type: 'spring', stiffness: 260, damping: 26, mass: 0.6 + (key % 3) * 0.15 }}
            >
              {'0123456789'.split('').map((n) => (
                <span key={n}>{n}</span>
              ))}
            </motion.span>
          </span>
        )
      })}
    </span>
  )
}
