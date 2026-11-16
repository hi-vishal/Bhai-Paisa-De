import { AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { Identity } from '@shared/keys'
import { useLang } from '../lib/i18n'
import { setUnlockPrompter } from '../lib/sign'
import { sfx } from '../lib/sound'
import { unlock, VaultError } from '../lib/vault'
import { PinPad } from './PinPad'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

/**
 * Lives once at the app root. Anything that needs keys (sending money, signing when the
 * device key is missing) awaits `requireUnlocked()`, which opens this sheet.
 */
export function UnlockHost() {
  const { T } = useLang()
  const toast = useToast()
  const [req, setReq] = useState<{ reason: 'sign' | 'spend'; resolve: (id: Identity) => void; reject: (e: Error) => void } | null>(null)
  const [err, setErr] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setUnlockPrompter((reason) => new Promise<Identity>((resolve, reject) => setReq({ reason, resolve, reject })))
    return () => setUnlockPrompter(null)
  }, [])

  return (
    <Sheet
      open={!!req}
      onClose={() => {
        req?.reject(new Error(T('Cancelled', 'Cancel kiya')))
        setReq(null)
      }}
    >
      <AnimatePresence>
        {req && (
          <PinPad
            title={req.reason === 'spend' ? T('PIN to approve this payment', 'Payment approve karne ke liye PIN') : T('PIN to sign this change', 'Ye change sign karne ke liye PIN')}
            sub={T('Your keys stay on this phone.', 'Teri keys isi phone pe rehti hain.')}
            error={err}
            busy={busy}
            allowPass={false}
            kind={undefined}
            onDone={async (s) => {
              setBusy(true)
              try {
                const id = await unlock(s.value)
                sfx.success()
                req.resolve(id)
                setReq(null)
              } catch (e) {
                setErr((n) => n + 1)
                const m = e instanceof VaultError && e.code === 'cooldown' ? T(`Too many wrong tries. Wait ${Math.ceil(e.waitMs / 1000)}s.`, `Bahut galat try. ${Math.ceil(e.waitMs / 1000)}s ruk.`) : null
                if (m) toast(m, { tone: 'owe', silent: true })
              } finally {
                setBusy(false)
              }
            }}
          />
        )}
      </AnimatePresence>
    </Sheet>
  )
}

