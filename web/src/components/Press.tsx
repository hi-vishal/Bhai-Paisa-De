import { motion, type HTMLMotionProps } from 'framer-motion'
import { forwardRef } from 'react'
import { haptic, sfx } from '../lib/sound'

type Tone = 'sats' | 'owe' | 'get' | 'cash' | 'lav' | 'paper' | 'ink' | 'orange'
type Sound = 'press' | 'tap' | 'pop' | 'none'

export type PressProps = Omit<HTMLMotionProps<'button'>, 'ref'> & {
  tone?: Tone
  size?: 'sm' | 'md' | 'lg'
  block?: boolean
  sound?: Sound
  loading?: boolean
}

/**
 * Every button is a sticker you squish: it sinks into its own shadow on press,
 * thocks, and buzzes (where phones allow).
 */
export const Press = forwardRef<HTMLButtonElement, PressProps>(function Press(
  { tone = 'sats', size = 'md', block, sound = 'press', loading, className = '', children, onClick, disabled, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      className={`btn btn--${tone} btn--${size}${block ? ' btn--block' : ''}${loading ? ' is-loading' : ''} ${className}`}
      whileTap={disabled || loading ? undefined : { x: 3, y: 3, boxShadow: '1px 1px 0 #000', scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 700, damping: 26 }}
      disabled={disabled || loading}
      onClick={(e) => {
        if (sound !== 'none') sfx[sound]()
        haptic(sound === 'pop' ? [6, 30, 10] : 8)
        onClick?.(e)
      }}
      {...rest}
    >
      {loading ? <span className="btn__dots" aria-label="loading"><i /><i /><i /></span> : children}
    </motion.button>
  )
})
