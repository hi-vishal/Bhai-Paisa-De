import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cleanUpi } from '@shared/upi'
import { LinkPhoneSheet, ShareCardSheet, TipSheet } from '../components/AccountSheets'
import { Avatar } from '../components/Avatar'
import { Emoji, LangToggle, Switch, ThemePicker } from '../components/bits'
import { IosInstallSheet, TopBar } from '../components/Chrome'
import { PhotoSheet } from '../components/PhotoSheet'
import { Press } from '../components/Press'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { BackupSheet, CryptoSheet, UpgradeSheet } from '../components/WalletFlows'
import { api, tokenStore } from '../lib/api'
import { ago, copyText } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useInstall } from '../lib/install'
import { disablePush, enablePush, pushState, type PushState } from '../lib/push'
import { serverInfo } from '../lib/server'
import { useSession } from '../lib/session'
import { haptic, sfx, sound } from '../lib/sound'
import type { ServerInfo, User } from '../lib/types'
import { isUnlocked, lock, onVaultChange } from '../lib/vault'

type Session = { id: string; label: string | null; createdAt: number; lastSeen: number; current: boolean }

export function Me() {
  const { T, lang } = useLang()
  const { user, vault, setUser, signOut, forgetDevice, disableCrypto } = useSession()
  const toast = useToast()
  const nav = useNavigate()
  const install = useInstall()
  const [name, setName] = useState(user?.name ?? '')
  const [upi, setUpi] = useState(user?.upi ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [sOn, setSOn] = useState(sound.on)
  const [sheet, setSheet] = useState<null | 'photo' | 'card' | 'link' | 'backup' | 'crypto' | 'upgrade' | 'tip' | 'ios' | 'key' | 'out' | 'wipe'>(null)
  const [revealed, setRevealed] = useState(false)
  const [devices, setDevices] = useState<Session[] | null>(null)
  const [push, setPush] = useState<PushState | null>(null)
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [unlockedNow, setUnlockedNow] = useState(isUnlocked)
  const upiRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const off = onVaultChange(() => setUnlockedNow(isUnlocked()))
    return () => {
      off()
    }
  }, [])
  useEffect(() => {
    void pushState().then(setPush)
    void serverInfo().then(setServer).catch(() => {})
    api<{ sessions: Session[] }>('/me/sessions')
      .then((r) => setDevices(r.sessions))
      .catch(() => setDevices([]))
    // from the checklist: "/me#upi" jumps straight to the UPI field
    if (window.location.hash === '#upi') setTimeout(() => upiRef.current?.focus(), 400)
  }, [])

  if (!user) return null
  const cryptoOn = !!user.solAddress
  const upiClean = cleanUpi(upi)
  const upiDirty = (upiClean ?? '') !== (user.upi ?? '') && (upiClean !== null || upi.trim() === '')

  const save = async (label: string, body: Record<string, unknown>, ok: string) => {
    setBusy(label)
    try {
      const r = await api<{ user: User }>('/me', { method: 'PATCH', body })
      setUser(r.user)
      toast(ok, { tone: 'get', emoji: '✅', silent: true })
      sfx.pop()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  const togglePush = async (on: boolean) => {
    try {
      const st = on ? await enablePush() : await disablePush()
      setPush(st)
      if (st === 'on') {
        sfx.chaching()
        toast(T('You’ll get a ping for payments, bills and chats', 'Payments, bills aur chat ka ping aayega'), { tone: 'get', emoji: '🔔', silent: true })
      } else if (st === 'denied') toast(T('Notifications are blocked in your browser settings', 'Browser settings mein notifications band hain'), { tone: 'owe' })
      else if (st === 'unsupported') toast(T('Add the app to your home screen first (iPhone), or use the installed app', 'Pehle app home screen pe daal (iPhone)'), { tone: 'owe' })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  return (
    <div className="screen">
      <TopBar title={T('Me', 'Main')} />

      <section className="me-card stk stk--lav">
        <button type="button" className="me-card__photo" onClick={() => (sfx.tap(), setSheet('photo'))} aria-label={T('Change photo', 'Photo badal')}>
          <Avatar name={user.name} src={user.avatar} size={84} />
          <span className="me-card__cam" aria-hidden>
            📷
          </span>
        </button>
        <div className="me-card__name">
          <input
            className="field field--inline"
            value={name}
            maxLength={32}
            aria-label={T('Your name', 'Tera naam')}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== user.name && save('name', { name }, T('Name updated', 'Naam badal gaya'))}
          />
          <small>{T('New groups use this name', 'Naye groups mein ye naam')}</small>
          <Press tone="paper" size="sm" onClick={() => setSheet('card')}>
            🪪 {T('Share my card', 'Mera card share kar')}
          </Press>
        </div>
      </section>

      {!vault && (
        <motion.button className="nag stk stk--sats" initial={{ rotate: -2 }} animate={{ rotate: -0.5 }} onClick={() => setSheet('upgrade')}>
          <Emoji char="🔐" size={44} />
          <span>
            <b>{T('Secure your account', 'Account secure kar')}</b>
            <small>{T('Right now it’s a single device key. Lose it and it’s gone.', 'Abhi ye ek device key hai. Woh gayi toh account gaya.')}</small>
          </span>
          <span className="nag__go">→</span>
        </motion.button>
      )}
      {vault && !vault.backedUp && (
        <motion.button className="nag stk stk--owe" initial={{ rotate: 1.5 }} animate={{ rotate: 0.5 }} onClick={() => setSheet('backup')}>
          <Emoji char="📝" size={44} />
          <span>
            <b>{T('Save your 12 backup words', 'Apne 12 backup words save kar')}</b>
            <small>{T('If you lose this phone, they get your account back. Takes a minute.', 'Phone kho gaya toh inse account wapas. Ek minute lagega.')}</small>
          </span>
          <span className="nag__go">→</span>
        </motion.button>
      )}

      <h2 className="section-title" id="upi">
        {T('Getting paid', 'Paise lena')}
      </h2>
      <section className="upi-set stk">
        <label className="label" htmlFor="myupi">
          {T('Your UPI ID', 'Teri UPI ID')}
        </label>
        <div className="addrow">
          <input
            id="myupi"
            ref={upiRef}
            className={`field mono${upi.trim() && !upiClean ? ' field--bad' : ''}`}
            value={upi}
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="name@okaxis"
            onChange={(e) => setUpi(e.target.value)}
          />
          <Press tone="ink" loading={busy === 'upi'} disabled={!upiDirty} onClick={() => save('upi', { upi: upiClean ?? null }, upiClean ? T('UPI ID saved', 'UPI ID save ho gayi') : T('UPI ID removed', 'UPI ID hata di'))}>
            {T('Save', 'Save')}
          </Press>
        </div>
        <p className="fine">
          {user.upi
            ? T('Pay links open your friends’ UPI app with this ID and the exact amount filled in.', 'Pay links dosto ka UPI app is ID aur exact amount ke saath kholte hain.')
            : T('Find it in GPay, PhonePe or Paytm under your profile. Looks like name@okaxis.', 'GPay, PhonePe ya Paytm mein profile mein milegi. Aisi dikhti hai: name@okaxis.')}
        </p>
      </section>

      {server?.solana.enabled && (
        <ul className="settings stk">
          <li>
            <span>
              {T('Crypto payments (USDT, SOL)', 'Crypto payments (USDT, SOL)')}
              <small>{cryptoOn ? T('On. Friends can also pay you in crypto.', 'On. Dost crypto mein bhi de sakte hain.') : T('Off. Optional, for people who use crypto.', 'Off. Sirf crypto wale logon ke liye.')}</small>
            </span>
            <Switch
              on={cryptoOn}
              label={T('Crypto payments', 'Crypto payments')}
              onChange={async (v) => {
                if (v) setSheet('crypto')
                else
                  try {
                    await disableCrypto()
                  } catch (e) {
                    toast(errText(e, lang), { tone: 'owe' })
                  }
              }}
            />
          </li>
          {cryptoOn && (
            <li>
              <span>
                {T('Crypto wallet', 'Crypto wallet')}
                <small>{unlockedNow ? T('Unlocked; locks itself after 5 idle minutes', 'Unlocked; 5 minute baad khud lock') : T('Locked. Sending asks for your PIN', 'Locked. Bhejne pe PIN maangega')}</small>
              </span>
              <span className="share-row">
                {unlockedNow && (
                  <Press tone="paper" size="sm" onClick={() => (lock(), sfx.unpop(), haptic(10))}>
                    🔒
                  </Press>
                )}
                <Press tone="sats" size="sm" onClick={() => nav('/wallet')}>
                  {T('Open', 'Khol')}
                </Press>
              </span>
            </li>
          )}
        </ul>
      )}

      <h2 className="section-title">{T('Account & phones', 'Account & phones')}</h2>
      <ul className="settings stk">
        <li>
          <span>
            {T('Log in on another phone', 'Doosre phone pe login')}
            <small>{T('Show a QR, scan it on the new phone. Done.', 'QR dikha, naye phone se scan kar. Ho gaya.')}</small>
          </span>
          <Press tone="sats" size="sm" disabled={!vault} onClick={() => setSheet('link')}>
            📲 {T('Show QR', 'QR dikha')}
          </Press>
        </li>
        {vault ? (
          <li>
            <span>
              {T('12 backup words', '12 backup words')}
              <small>{vault.backedUp ? T('Saved ✓', 'Save ho gaye ✓') : T('Not saved yet', 'Abhi save nahi')}</small>
            </span>
            <Press tone={vault.backedUp ? 'paper' : 'owe'} size="sm" onClick={() => setSheet('backup')}>
              📝 {T('Show', 'Dikha')}
            </Press>
          </li>
        ) : (
          <li>
            <span>{T('Device key', 'Device key')}</span>
            <Press tone="paper" size="sm" onClick={() => (setRevealed(false), setSheet('key'))}>
              🔑 {T('Show', 'Dikha')}
            </Press>
          </li>
        )}
      </ul>
      {devices && devices.length > 1 && (
        <ul className="devices">
          {devices.map((d) => (
            <li key={d.id} className="device">
              <span className="device__icon">{/iPhone|iPad|Android/.test(d.label ?? '') ? '📱' : '💻'}</span>
              <span className="device__mid">
                <b>
                  {d.label ?? T('Unknown device', 'Anjaan device')} {d.current && <i className="device__this">{T('this one', 'yahi')}</i>}
                </b>
                <small>{T(`active ${ago(d.lastSeen, lang)}`, `active ${ago(d.lastSeen, lang)}`)}</small>
              </span>
              {!d.current && (
                <button
                  type="button"
                  className="linkish danger"
                  onClick={async () => {
                    await api(`/me/sessions/${d.id}`, { method: 'DELETE' })
                    sfx.unpop()
                    setDevices((xs) => xs?.filter((x) => x.id !== d.id) ?? null)
                  }}
                >
                  {T('Sign out', 'Nikaal')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <h2 className="section-title">{T('Settings', 'Settings')}</h2>
      <ul className="settings stk">
        <li className="settings__col">
          <span>{T('Theme', 'Theme')}</span>
          <ThemePicker />
        </li>
        <li>
          <span>{T('Language', 'Bhasha')}</span>
          <LangToggle />
        </li>
        <li>
          <span>{T('Sounds & buzzes', 'Awaaz & vibration')}</span>
          <Switch
            on={sOn}
            label="Sound"
            onChange={(v) => {
              sound.set(v)
              setSOn(v)
              if (v) setTimeout(() => sfx.chaching(), 120)
            }}
          />
        </li>
        {push && push !== 'unsupported' && (
          <li>
            <span>
              {T('Notifications', 'Notifications')}
              <small>{push === 'denied' ? T('Blocked in browser settings', 'Browser settings mein band') : T('Payments, new bills, nudges and chats', 'Payments, naye bills, nudges aur chat')}</small>
            </span>
            <Switch on={push === 'on'} label="Notifications" onChange={(v) => void togglePush(v)} />
          </li>
        )}
        {!install.standalone && (install.canPrompt || install.ios) && (
          <li>
            <span>{T('Add to home screen', 'Home screen pe daal')}</span>
            <Press tone="sats" size="sm" onClick={() => (install.canPrompt ? void install.prompt() : setSheet('ios'))}>
              {T('Install', 'Install')}
            </Press>
          </li>
        )}
      </ul>

      <nav className="linklist">
        <Link to="/help" className="stk">
          <span>❓</span>
          {T('Help & how it works', 'Madad & kaise kaam karta hai')}
        </Link>
        <Link to="/activity" className="stk">
          <span>📜</span>
          {T('All activity', 'Saari activity')}
        </Link>
        {server?.tip && (
          <button type="button" className="stk" onClick={() => setSheet('tip')}>
            <span>☕</span>
            {T(`Support ${server.tip.name}`, `${server.tip.name} ko support kar`)}
          </button>
        )}
      </nav>

      <div className="me-bye">
        <button className="linkish" onClick={() => setSheet('out')}>
          {T('Sign out', 'Sign out')}
        </button>
        <button className="linkish danger" onClick={() => setSheet('wipe')}>
          {T('Remove from this phone', 'Is phone se hata')}
        </button>
      </div>

      <PhotoSheet open={sheet === 'photo'} onClose={() => setSheet(null)} />
      <ShareCardSheet open={sheet === 'card'} onClose={() => setSheet(null)} />
      <LinkPhoneSheet open={sheet === 'link'} onClose={() => setSheet(null)} />
      <BackupSheet open={sheet === 'backup'} onClose={() => setSheet(null)} />
      <CryptoSheet open={sheet === 'crypto'} onClose={(on) => (setSheet(null), on && toast(T('Crypto payments on', 'Crypto payments on'), { tone: 'get', emoji: '₮', silent: true }))} />
      <UpgradeSheet open={sheet === 'upgrade'} onClose={(done) => setSheet(done ? 'backup' : null)} />
      <TipSheet open={sheet === 'tip'} onClose={() => setSheet(null)} />
      <IosInstallSheet open={sheet === 'ios'} onClose={() => setSheet(null)} />

      <Sheet open={sheet === 'key'} onClose={() => setSheet(null)} title={T('Your device key', 'Teri device key')}>
        <div className="callout callout--owe">{T('Anyone with this key is you. Better: secure your account, which gives you backup words.', 'Jiske paas ye key, woh tu hai. Behtar: account secure kar, backup words milenge.')}</div>
        <button className={`keybox mono${revealed ? '' : ' is-blur'}`} onClick={() => setRevealed(true)}>
          {tokenStore.get()}
        </button>
        <Press
          tone="sats"
          block
          onClick={async () => {
            await copyText(tokenStore.get() ?? '')
            toast(T('Key copied. Keep it secret.', 'Key copy ho gayi. Chhupa ke rakh.'), { emoji: '🤫', tone: 'get', silent: true })
          }}
        >
          {T('Copy key', 'Key copy kar')}
        </Press>
      </Sheet>

      <Sheet open={sheet === 'out' || sheet === 'wipe'} onClose={() => setSheet(null)} title={sheet === 'out' ? T('Sign out?', 'Sign out karna hai?') : T('Remove your account from this phone?', 'Is phone se account hatana hai?')}>
        <p>
          {sheet === 'out'
            ? vault
              ? T('Your account stays on this phone. One tap brings you back in.', 'Account isi phone pe rahega. Ek tap mein wapas.')
              : T('Without your device key copied somewhere, you won’t get back in.', 'Device key kahin copy nahi ki toh wapas nahi aa paayega.')
            : vault?.backedUp
              ? T('Your 12 backup words (or another logged-in phone) get you back in. You saved them, right?', '12 backup words (ya doosra logged-in phone) se wapas aayega. Save kiye hain na?')
              : T('You haven’t saved your 12 backup words. Unless you’re logged in on another phone, removing it now loses the account. Save them first.', 'Tune 12 backup words save nahi kiye. Doosre phone pe login nahi hai toh account chala jaayega. Pehle save kar.')}
        </p>
        <div className="share-row">
          <Press
            tone="owe"
            onClick={async () => {
              const out = sheet === 'out'
              sfx.sad()
              if (out) await signOut()
              else await forgetDevice()
              nav(out && vault ? '/unlock' : '/welcome', { replace: true })
            }}
          >
            {sheet === 'out' ? T('Sign out', 'Sign out') : T('Remove it', 'Hata de')}
          </Press>
          {sheet === 'wipe' && vault && !vault.backedUp && (
            <Press tone="sats" onClick={() => setSheet('backup')}>
              {T('Save words', 'Words save kar')}
            </Press>
          )}
          <Press tone="paper" onClick={() => setSheet(null)}>
            {T('Keep', 'Rehne de')}
          </Press>
        </div>
      </Sheet>
    </div>
  )
}
