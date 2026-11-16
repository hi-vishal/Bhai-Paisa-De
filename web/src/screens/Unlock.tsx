import { motion } from 'framer-motion'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { LangToggle, ThemeToggle, Wordmark } from '../components/bits'
import { PinPad } from '../components/PinPad'
import { Press } from '../components/Press'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { RestoreSheet } from '../components/WalletFlows'
import { safeNext } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { lastWho, useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import { VaultError } from '../lib/vault'

/** Signed out, but the account is still on this phone: one tap back in (or the PIN, if crypto is on). */
export function Unlock() {
  const { T, lang } = useLang()
  const { status, vault, unlockAndSignIn, forgetDevice } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [err, setErr] = useState(0)
  const [busy, setBusy] = useState(false)
  const [restore, setRestore] = useState(false)
  const [startOver, setStartOver] = useState(false)
  const who = lastWho()

  if (status === 'in') return <Navigate to={next} replace />
  if (status === 'out' || !vault) return <Navigate to={`/welcome?next=${encodeURIComponent(next)}`} replace />

  const go = async (secret?: string) => {
    setBusy(true)
    try {
      await unlockAndSignIn(secret)
      sfx.success()
      nav(next, { replace: true })
    } catch (e) {
      if (e instanceof VaultError && e.code === 'device_lost') {
        toast(T('This browser lost your key. Log in with your 12 words or from your other phone.', 'Browser ki key gayab. 12 words ya doosre phone se login kar.'), { tone: 'owe' })
        setRestore(true)
      } else if (e instanceof VaultError && e.code === 'cooldown') toast(T(`Too many wrong tries. Wait ${Math.ceil(e.waitMs / 1000)}s.`, `Bahut galat try. ${Math.ceil(e.waitMs / 1000)}s ruk.`), { tone: 'owe', silent: true })
      else if (e instanceof VaultError) setErr((n) => n + 1)
      else toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome unlock">
      <div className="welcome__top">
        <Wordmark />
        <div className="topbar__right">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>
      <motion.div className="unlock__who" initial={{ y: -10, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: -2 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}>
        <Avatar name={who?.name ?? '?'} src={who?.avatar} size={96} />
        <h1>{who ? T(`Welcome back, ${who.name.split(' ')[0]}`, `Wapas aa gaya ${who.name.split(' ')[0]}`) : T('Welcome back', 'Wapas aa gaya')}</h1>
      </motion.div>
      {vault.secret === 'device' ? (
        <Press tone="sats" size="lg" block loading={busy} onClick={() => go()}>
          {T('Continue', 'Aage chal')} →
        </Press>
      ) : (
        <PinPad
          title={vault.secret === 'pass' ? T('Enter your passphrase', 'Passphrase daal') : T('Enter your PIN', 'PIN daal')}
          kind={vault.secret}
          allowPass={false}
          error={err}
          busy={busy}
          onDone={(s) => void go(s.value)}
        />
      )}
      <div className="welcome__alt">
        {vault.secret !== 'device' && (
          <button type="button" className="linkish" onClick={() => setRestore(true)}>
            {T('Forgot PIN? Use my 12 words', 'PIN bhool gaya? 12 words se khol')}
          </button>
        )}
        <button type="button" className="linkish danger" onClick={() => setStartOver(true)}>
          {T('Not you? Use another account', 'Tu nahi hai? Doosra account')}
        </button>
      </div>
      <RestoreSheet open={restore} onClose={() => setRestore(false)} onDone={() => nav(next, { replace: true })} />
      <Sheet open={startOver} onClose={() => setStartOver(false)} title={T('Remove this account from this phone?', 'Is phone se ye account hatana hai?')}>
        <p>{T('The account stays safe if its 12 backup words are written down or it’s on another phone. Otherwise this can’t be undone.', 'Account tabhi safe hai jab 12 backup words likhe hon ya doosre phone pe ho. Warna ye wapas nahi hoga.')}</p>
        <div className="share-row">
          <Press
            tone="owe"
            onClick={async () => {
              sfx.sad()
              await forgetDevice()
              nav('/welcome', { replace: true })
            }}
          >
            {T('Remove it', 'Hata de')}
          </Press>
          <Press tone="paper" onClick={() => setStartOver(false)}>
            {T('Keep', 'Rehne de')}
          </Press>
        </div>
      </Sheet>
    </div>
  )
}
