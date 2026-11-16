import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { blast, Emoji, LangToggle, ThemeToggle, Wordmark } from '../components/bits'
import { Press } from '../components/Press'
import { QrScanner } from '../components/QrScanner'
import { useToast } from '../components/Toast'
import { errText, useLang } from '../lib/i18n'
import { openLinkCode, parseLinkCode } from '../lib/linkcode'
import { markBackedUp } from '../lib/vault'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'

/**
 * The new phone's side of "log in on another phone". Opened from the QR (the code is in the URL
 * fragment) or from Welcome → "I have the app on another phone", where it scans the QR itself.
 */
export function Link() {
  const { T, lang } = useLang()
  const { restoreAccount, user } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [code, setCode] = useState(() => parseLinkCode(window.location.hash))
  const [scan, setScan] = useState(false)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // the key must not linger in history or get bookmarked
    if (window.location.hash) history.replaceState(null, '', '/link')
  }, [])

  const go = async () => {
    if (!code) return
    setBusy(true)
    try {
      const { m } = await openLinkCode(code)
      const r = await restoreAccount(m)
      if (r === 'needs_name') throw new Error(T('That account doesn’t exist any more.', 'Woh account ab nahi hai.'))
      // the other phone still has it, so it counts as backed up
      markBackedUp()
      sfx.success()
      blast('party')
      toast(T(`You’re in, ${r.name}`, `Aa gaya ${r.name}!`), { tone: 'get', emoji: '📲' })
      nav('/', { replace: true })
    } catch (e) {
      setCode(null)
      toast(e instanceof Error && !('code' in e) ? e.message : errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome link">
      <div className="welcome__top">
        <Wordmark />
        <div className="topbar__right">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>
      <motion.div className="link__hero" initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <Emoji char="📲" size={86} />
        <h1>{code ? T('Log in on this phone?', 'Is phone pe login karein?') : T('Scan from your other phone', 'Doosre phone se scan kar')}</h1>
        <p className="muted">
          {code
            ? T('Your account comes over from your other phone. It keeps working there too.', 'Tera account doosre phone se aa jaayega. Wahan bhi chalta rahega.')
            : T('On the phone that has the app: Me → Log in on another phone. Then scan the QR it shows.', 'Jis phone pe app hai: Main → Doosre phone pe login. Phir jo QR dikhe usse scan kar.')}
        </p>
      </motion.div>

      {user ? (
        <p className="callout">
          {T(
            `You’re logged in as ${user.name} on this phone. To use a different account here, first remove this one: Me → Remove from this phone.`,
            `Is phone pe ${user.name} login hai. Doosra account chahiye toh pehle ise hata: Main → Is phone se hata.`,
          )}
        </p>
      ) : code ? (
        <Press tone="sats" size="lg" block loading={busy} onClick={go}>
          {T('Yes, log me in', 'Haan, login kar')}
        </Press>
      ) : scan ? (
        <QrScanner
          onCode={(text) => {
            const c = parseLinkCode(text)
            if (!c) {
              toast(T('That isn’t a login QR from this app', 'Ye is app ka login QR nahi hai'), { tone: 'owe' })
              setScan(false)
              return
            }
            sfx.pop()
            setScan(false)
            setCode(c)
          }}
        />
      ) : (
        <Press tone="ink" size="lg" block onClick={() => setScan(true)}>
          📷 {T('Open camera', 'Camera khol')}
        </Press>
      )}

      {!code && !user && (
        <details className="howto">
          <summary>{T('Can’t scan? Paste the link', 'Scan nahi ho raha? Link paste kar')}</summary>
          <div className="addrow">
            <input className="field mono" value={paste} placeholder="https://…/link#…" onChange={(e) => setPaste(e.target.value)} />
            <Press tone="ink" onClick={() => setCode(parseLinkCode(paste))} disabled={!parseLinkCode(paste)}>
              {T('Go', 'Chal')}
            </Press>
          </div>
        </details>
      )}
      <button type="button" className="linkish center" onClick={() => nav(user ? '/' : '/welcome')}>
        {T('Back', 'Wapas')}
      </button>
    </div>
  )
}
