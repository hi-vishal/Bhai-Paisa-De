import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { upiUrl } from '@shared/upi'
import { api } from '../lib/api'
import { copyText } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { makeLinkCode } from '../lib/linkcode'
import { serverInfo } from '../lib/server'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import type { ServerInfo } from '../lib/types'
import { needsPin, revealPhrase, VaultError } from '../lib/vault'
import { Avatar } from './Avatar'
import { blast, Emoji, MAKER, QR } from './bits'
import { PinPad } from './PinPad'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { isIOS, isMobile } from '../lib/platform'

export const cardUrl = (userId: string) => `${window.location.origin}/u/${userId}`

/** Your card: a link and QR friends use to pay you or start a group with you. */
export function ShareCardSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  if (!user) return null
  const url = cardUrl(user.id)
  const text = lang === 'hi' ? `Mujhe pay kar ya saath mein bills split kar, Bhai Paise De pe: ${url}` : `Pay me or split bills with me on Bhai Paise De: ${url}`
  return (
    <Sheet open={open} onClose={onClose} title={T('Your card', 'Tera card')}>
      <div className="mycard stk stk--lav">
        <Avatar name={user.name} src={user.avatar} size={72} />
        <b>{user.name}</b>
        {user.upi ? <span className="mono">{user.upi}</span> : <small>{T('Add a UPI ID so people can pay you from your card', 'UPI ID daal taaki log card se pay kar sakein')}</small>}
        <div className="mycard__qr">
          <QR text={url} size={170} />
        </div>
        <small>{T('Friends scan this to pay you or split with you', 'Dost ise scan karke pay ya split kar sakte hain')}</small>
      </div>
      <div className="share-row">
        <Press tone="ink" onClick={() => (sfx.send(), window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener'))}>
          WhatsApp
        </Press>
        {'share' in navigator && (
          <Press tone="paper" onClick={() => navigator.share({ title: user.name, text }).catch(() => {})}>
            {T('Share', 'Share')}
          </Press>
        )}
        <Press
          tone="paper"
          onClick={async () => {
            await copyText(url)
            toast(T('Card link copied', 'Card link copy ho gaya'), { emoji: '🪪', tone: 'get', silent: true })
          }}
        >
          {T('Copy', 'Copy')}
        </Press>
      </div>
    </Sheet>
  )
}

/** Old phone side of "log in on another phone": a QR that works once, for ten minutes. */
export function LinkPhoneSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [step, setStep] = useState<'pin' | 'making' | 'show' | 'done' | 'expired'>('making')
  const [code, setCode] = useState<{ id: string; url: string; expiresAt: number } | null>(null)
  const [err, setErr] = useState(0)
  const [now, setNow] = useState(Date.now())

  const make = async (secret?: string) => {
    setStep('making')
    try {
      const words = await revealPhrase(secret)
      const c = await makeLinkCode(words, user!.name)
      setCode(c)
      setStep('show')
      sfx.pop()
    } catch (e) {
      if (e instanceof VaultError && e.code === 'wrong_pin') {
        setErr((n) => n + 1)
        setStep('pin')
      } else {
        toast(e instanceof VaultError ? e.message : errText(e, lang), { tone: 'owe' })
        onClose()
      }
    }
  }

  useEffect(() => {
    if (!open) {
      setCode(null)
      return
    }
    if (needsPin()) setStep('pin')
    else void make()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // wait for the new phone to pick it up
  useEffect(() => {
    if (step !== 'show' || !code) return
    const t = setInterval(async () => {
      setNow(Date.now())
      try {
        const r = await api<{ used: boolean; expired: boolean }>(`/devices/link/${code.id}`)
        if (r.used) {
          setStep('done')
          sfx.success()
          haptic([10, 40, 10])
          blast('party')
        } else if (r.expired) setStep('expired')
      } catch {
        // keep waiting
      }
    }, 2000)
    return () => clearInterval(t)
  }, [step, code])

  const close = () => {
    if (code && step === 'show') void api(`/devices/link/${code.id}`, { method: 'DELETE' }).catch(() => {})
    onClose()
  }
  const left = code ? Math.max(0, Math.ceil((code.expiresAt - now) / 1000)) : 0

  return (
    <Sheet open={open} onClose={close} title={step === 'done' ? undefined : T('Log in on another phone', 'Doosre phone pe login')}>
      {step === 'pin' ? (
        <PinPad title={T('Enter your PIN', 'PIN daal')} error={err} allowPass={false} onDone={(s) => void make(s.value)} />
      ) : step === 'making' ? (
        <div className="minting">
          <Emoji char="🔐" size={80} />
          <h3>{T('Sealing your account…', 'Account seal ho raha hai…')}</h3>
        </div>
      ) : step === 'show' && code ? (
        <div className="linkqr">
          <ol className="steps">
            <li>
              <span className="steps__n">1</span>
              <span>{T('Open this app on the new phone', 'Naye phone pe ye app khol')}</span>
            </li>
            <li>
              <span className="steps__n">2</span>
              <span>{T('Tap “I have the app on another phone”, or just scan with the camera', '“Doosre phone pe app hai” daba, ya camera se scan kar')}</span>
            </li>
          </ol>
          <motion.div className="linkqr__code" initial={{ scale: 0.9, rotate: -2 }} animate={{ scale: 1, rotate: 0 }}>
            <QR text={code.url} size={220} />
          </motion.div>
          <p className="fine center">
            {T(`Works once, for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more. Only scan it on your own phone.`, `Ek baar chalega, ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} aur. Sirf apne phone pe scan kar.`)}
          </p>
          <button
            type="button"
            className="linkish center"
            onClick={async () => {
              await copyText(code.url)
              toast(T('Link copied. Paste it in the app on the other screen.', 'Link copy. Doosri screen pe app mein paste kar.'), { tone: 'get', emoji: '📋', silent: true })
            }}
          >
            {T('Same phone, home-screen app? Copy the link instead', 'Isi phone pe home-screen app? Link copy kar')}
          </button>
        </div>
      ) : step === 'done' ? (
        <div className="minting">
          <Emoji char="🎉" size={96} />
          <h3>{T('Done. You’re logged in on the other phone.', 'Ho gaya. Doosre phone pe login ho gaya.')}</h3>
          <Press tone="ink" block onClick={onClose}>
            {T('Close', 'Band kar')}
          </Press>
        </div>
      ) : (
        <div className="minting">
          <Emoji char="⌛" size={80} />
          <h3>{T('That code ran out', 'Code expire ho gaya')}</h3>
          <Press tone="sats" block onClick={() => void make()}>
            {T('Make a new one', 'Naya bana')}
          </Press>
        </div>
      )}
    </Sheet>
  )
}

const TIPS = [2900, 4900, 9900, 19900]

/** "Support Vishal": a UPI tip, straight to the maker. Shown only when the server has a tip UPI ID. */
export function TipSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T } = useLang()
  const toast = useToast()
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [amt, setAmt] = useState(4900)
  useEffect(() => {
    if (open) void serverInfo().then(setInfo).catch(() => {})
  }, [open])
  const tip = info?.tip
  const url = tip ? upiUrl({ pa: tip.upi, pn: tip.name, am: amt, tn: 'Thanks for Bhai Paise De' }) : ''
  return (
    <Sheet open={open} onClose={onClose} title={T(`Support ${MAKER}`, `${MAKER} ko support kar`)}>
      <p className="muted">{T(`Bhai Paise De is free, with no ads. If it saved you an awkward conversation, buy ${MAKER} a chai.`, `Bhai Paise De free hai, koi ads nahi. Agar isne ek awkward baat bachayi, toh ${MAKER} ko chai pila de.`)}</p>
      {!tip ? (
        <p className="callout">{T('Tips aren’t set up on this server yet.', 'Is server pe abhi tips setup nahi hain.')}</p>
      ) : (
        <>
          <div className="chips tipchips">
            {TIPS.map((t) => (
              <button key={t} type="button" className={`chip${amt === t ? ' chip--on' : ''}`} onClick={() => (sfx.tap(), setAmt(t))}>
                {t === 2900 ? '☕' : t === 4900 ? '☕☕' : t === 9900 ? '🍕' : '🎉'} ₹{t / 100}
              </button>
            ))}
          </div>
          {isMobile() ? (
            <a className="btn btn--ink btn--lg btn--block" href={isIOS() ? url.replace('upi://pay', 'gpay://upi/pay') : url} onClick={() => sfx.zap()}>
              {T(`Pay ₹${amt / 100} with UPI`, `UPI se ₹${amt / 100} de`)}
            </a>
          ) : (
            <div className="upipay__qr stk">
              <QR text={url} size={170} />
              <p className="fine center">{T('Scan with any UPI app', 'Kisi bhi UPI app se scan kar')}</p>
            </div>
          )}
          <button
            type="button"
            className="upipay__id"
            onClick={async () => {
              await copyText(tip.upi)
              toast(T('UPI ID copied', 'UPI ID copy ho gayi'), { emoji: '📋', tone: 'get', silent: true })
            }}
          >
            <span>
              <small>UPI</small>
              <b className="mono">{tip.upi}</b>
            </span>
            <i aria-hidden>⧉</i>
          </button>
          <p className="fine center">{T('Thank you. Truly. ♥', 'Shukriya. Dil se. ♥')}</p>
        </>
      )}
    </Sheet>
  )
}
