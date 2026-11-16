import { motion, useAnimationControls } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import { Press } from './Press'

export type Secret = { value: string; kind: 'pin' | 'pass' }

/**
 * Six fat keys and six dots that fill like coins. A wrong PIN shakes the dots.
 * "Use a passphrase" swaps in a text field for people who want more than 6 digits.
 */
export function PinPad({
  title,
  sub,
  onDone,
  error,
  busy,
  allowPass = true,
  kind: kindProp,
}: {
  title: string
  sub?: string
  onDone: (s: Secret) => void
  /** bump this (any new value) to shake and clear */
  error?: number
  busy?: boolean
  allowPass?: boolean
  /** lock the input type, e.g. when confirming a passphrase */
  kind?: 'pin' | 'pass'
}) {
  const T = useT()
  const [pin, setPin] = useState('')
  const [kind, setKind] = useState<'pin' | 'pass'>(kindProp ?? 'pin')
  const [pass, setPass] = useState('')
  const dots = useAnimationControls()

  useEffect(() => {
    if (!error) return
    sfx.error()
    haptic([30, 40, 30])
    void dots.start({ x: [0, -14, 12, -9, 6, 0], transition: { duration: 0.42 } })
    pinRef.current = ''
    setPin('')
    setPass('')
  }, [error, dots])

  useEffect(() => {
    if (kindProp) setKind(kindProp)
  }, [kindProp])

  // a ref, not the render's copy of `pin`, so fast typing (or a hardware keyboard) never drops a digit
  const pinRef = useRef('')
  const put = (v: string) => {
    pinRef.current = v
    setPin(v)
  }
  const press = (k: string) => {
    if (busy) return
    const p = pinRef.current
    if (k === '⌫') {
      sfx.backspace()
      return put(p.slice(0, -1))
    }
    if (p.length >= 6) return
    sfx.key(p.length)
    haptic(5)
    put(p + k)
  }

  const doneRef = useRef(onDone)
  doneRef.current = onDone
  useEffect(() => {
    if (pin.length !== 6) return
    const t = setTimeout(() => doneRef.current({ value: pin, kind: 'pin' }), 140)
    return () => clearTimeout(t)
  }, [pin])

  const pressRef = useRef(press)
  pressRef.current = press
  useEffect(() => {
    if (kind !== 'pin') return
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) pressRef.current(e.key)
      else if (e.key === 'Backspace') pressRef.current('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind])

  return (
    <div className="pin">
      <h3 className="pin__title">{title}</h3>
      {sub && <p className="pin__sub">{sub}</p>}
      {kind === 'pin' ? (
        <>
          <motion.div className="pin__dots" animate={dots} aria-label={`${pin.length} of 6`}>
            {Array.from({ length: 6 }, (_, i) => (
              <motion.i key={i} className={i < pin.length ? 'on' : ''} animate={i < pin.length ? { scale: [1, 1.35, 1], rotate: [0, -12, 0] } : { scale: 1 }} transition={{ duration: 0.22 }} />
            ))}
          </motion.div>
          <div className="keypad__grid pin__grid">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) =>
              k ? (
                <motion.button
                  key={k}
                  type="button"
                  className={`key${k === '⌫' ? ' key--del' : ''}`}
                  whileTap={{ y: 3, x: 3, boxShadow: '0 0 0 #000', scale: 0.96 }}
                  onClick={() => press(k)}
                  aria-label={k === '⌫' ? T('Delete', 'Mita') : k}
                  disabled={busy}
                >
                  {k}
                </motion.button>
              ) : (
                <span key={`b${i}`} />
              ),
            )}
          </div>
        </>
      ) : (
        <form
          className="pin__pass"
          onSubmit={(e) => {
            e.preventDefault()
            if (pass.length >= 8) onDone({ value: pass, kind: 'pass' })
          }}
        >
          <motion.div animate={dots}>
            <input className="field field--big" type="password" autoFocus autoComplete="new-password" value={pass} minLength={8} placeholder={T('at least 8 characters', 'kam se kam 8 characters')} onChange={(e) => setPass(e.target.value)} />
          </motion.div>
          <Press tone="ink" block type="submit" loading={busy} disabled={pass.length < 8} onClick={() => {}}>
            {T('Continue', 'Aage')}
          </Press>
        </form>
      )}
      {allowPass && !kindProp && (
        <button
          type="button"
          className="linkish center"
          onClick={() => {
            sfx.tap()
            setKind(kind === 'pin' ? 'pass' : 'pin')
            pinRef.current = ''
            setPin('')
            setPass('')
          }}
        >
          {kind === 'pin' ? T('Use a passphrase instead', 'PIN ki jagah passphrase') : T('Use a 6-digit PIN', '6-digit PIN use kar')}
        </button>
      )}
      {busy && <p className="fine center">{T('Stretching your PIN into a key…', 'PIN ko key mein badal rahe hain…')}</p>}
    </div>
  )
}
