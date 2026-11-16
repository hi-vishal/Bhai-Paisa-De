import { AnimatePresence, motion, useMotionValue, useTransform } from 'framer-motion'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { cleanUpi } from '@shared/upi'
import { blast, Emoji, LangToggle, ThemeToggle, Wordmark } from '../components/bits'
import { RestoreSheet } from '../components/WalletFlows'
import { Press } from '../components/Press'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { safeNext } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'

type Card = { emoji: string; tone: string; en: [string, string]; hi: [string, string] }

const CARDS: Card[] = [
  {
    emoji: '🫵',
    tone: 'sats',
    en: ['Only you need the app', 'Add friends by name. They get a link and pay from any phone. No signup for them.'],
    hi: ['App sirf tujhe chahiye', 'Dosto ko naam se add kar. Unko link milta hai, kisi bhi phone se pay. Unka signup nahi.'],
  },
  {
    emoji: '📲',
    tone: 'get',
    en: ['Paid back by UPI in one tap', 'The link opens GPay, PhonePe or Paytm with your UPI ID and the exact amount already filled in.'],
    hi: ['UPI se ek tap mein wapas', 'Link GPay, PhonePe ya Paytm kholta hai, teri UPI ID aur exact amount pehle se bhara.'],
  },
  {
    emoji: '✅',
    tone: 'cash',
    en: ['They pay, you tap “Got it”', 'Settled for everyone, with a receipt in the group chat. No more “bhej diya na?”'],
    hi: ['Woh dete hain, tu “Mil gaya” dabata hai', 'Sabke liye settle, group chat mein receipt. “Bhej diya na?” khatam.'],
  },
  {
    emoji: '💬',
    tone: 'owe',
    en: ['Chat, kitty, roasts', 'Every group gets a chat, a shared kitty for trips and rent, and a sarcasm dial for reminders.'],
    hi: ['Chat, kitty, roast', 'Har group mein chat, trip aur rent ke liye kitty, aur yaad dilane ke liye sarcasm dial.'],
  },
  {
    emoji: '🔐',
    tone: 'lav',
    en: ['No password, no OTP', 'Your account is a key that lives on your phone. Moving phones? Scan a QR from the old one.'],
    hi: ['Na password, na OTP', 'Tera account tere phone pe ek key hai. Phone badla? Purane se QR scan kar.'],
  },
]

function SwipeCard({ card, depth, onGone }: { card: Card; depth: number; onGone: (dir: number) => void }) {
  const { lang } = useLang()
  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-18, 18])
  const [title, body] = card[lang]
  const top = depth === 0
  return (
    <motion.div
      className={`swipe stk stk--${card.tone}`}
      style={{ x: top ? x : 0, rotate: top ? rotate : depth * (depth % 2 ? 4 : -4), zIndex: 10 - depth }}
      initial={{ scale: 0.9, y: 30, opacity: 0 }}
      animate={{ scale: 1 - depth * 0.05, y: depth * 12, opacity: depth > 2 ? 0 : 1 }}
      variants={{ gone: (dir: number) => ({ x: dir * 440, opacity: 0, rotate: dir * 30, transition: { duration: 0.32 } }) }}
      exit="gone"
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      drag={top ? 'x' : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) > 90 || Math.abs(info.velocity.x) > 500) {
          sfx.whoosh()
          haptic(10)
          onGone(info.offset.x < 0 ? -1 : 1)
        }
      }}
      onTap={() => {
        if (!top) return
        sfx.whoosh()
        onGone(1)
      }}
    >
      <Emoji char={card.emoji} size={72} />
      <h2>{title}</h2>
      <p>{body}</p>
    </motion.div>
  )
}

export function Welcome() {
  const { lang, T } = useLang()
  const { createAccount, signInWithKey, user, status } = useSession()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const toast = useToast()
  const [deck, setDeck] = useState(CARDS.map((_, i) => i))
  const [dir, setDir] = useState(1)
  const [name, setName] = useState('')
  const [upi, setUpi] = useState('')
  const [busy, setBusy] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [more, setMore] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [key, setKey] = useState('')

  if (status === 'locked') return <Navigate to={`/unlock?next=${encodeURIComponent(next)}`} replace />
  if (user) return <Navigate to={next} replace />

  const upiOk = !upi.trim() || !!cleanUpi(upi)

  const start = async () => {
    if (!name.trim()) {
      sfx.error()
      toast(T('Type your name first', 'Pehle naam toh likh'), { tone: 'owe', emoji: '✍️', silent: true })
      return
    }
    if (!upiOk) {
      sfx.error()
      toast(T('That UPI ID looks off. It’s like name@okaxis', 'UPI ID galat lag rahi hai. Aisi hoti hai: name@okaxis'), { tone: 'owe', emoji: '🏦', silent: true })
      return
    }
    setBusy(true)
    try {
      const u = await createAccount(name.trim(), cleanUpi(upi) ?? undefined)
      sfx.success()
      blast('party')
      toast(T(`You’re in, ${u.name.split(' ')[0]}!`, `Aa gaya ${u.name.split(' ')[0]}!`), { tone: 'get', emoji: '🎉', silent: true })
      nav(next, { replace: true })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const restoreLegacy = async () => {
    setBusy(true)
    try {
      const u = await signInWithKey(key)
      sfx.success()
      toast(T(`Welcome back, ${u.name}`, `Wapas aa gaya ${u.name}!`), { tone: 'get', emoji: '🔑' })
      nav(next, { replace: true })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome__top">
        <Wordmark />
        <div className="topbar__right">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>

      <motion.p className="welcome__lede" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        {T('Split bills with friends. Get paid back by UPI in a tap.', 'Dosto ke saath bill split kar. UPI se ek tap mein paise wapas.')}
      </motion.p>

      <div className="deck" aria-label={T('How it works', 'Kaise kaam karta hai')}>
        <AnimatePresence initial={false} custom={dir}>
          {deck.slice(0, 3).map((idx, depth) => (
            <SwipeCard
              key={idx}
              card={CARDS[idx]}
              depth={depth}
              onGone={(d) => {
                setDir(d)
                setDeck((xs) => [...xs.slice(1), xs[0]])
              }}
            />
          ))}
        </AnimatePresence>
      </div>
      <p className="deck__hint">{T('swipe the stickers →', 'stickers ko swipe kar →')}</p>

      <form
        className="welcome__form"
        onSubmit={(e) => {
          e.preventDefault()
          void start()
        }}
      >
        <label htmlFor="name" className="label">
          {T('What do your friends call you?', 'Dost tujhe kya bulaate hain?')}
        </label>
        <input
          id="name"
          className="field field--big"
          value={name}
          maxLength={32}
          autoComplete="given-name"
          enterKeyHint="next"
          placeholder={T('e.g. Ria', 'jaise Ria')}
          onChange={(e) => {
            setName(e.target.value)
            sfx.key(e.target.value.length)
          }}
        />
        <label htmlFor="upi" className="label">
          {T('Your UPI ID, so friends can pay you back', 'Teri UPI ID, taaki dost paise lauta sakein')} <small className="muted">({T('optional', 'zaroori nahi')})</small>
        </label>
        <input
          id="upi"
          className={`field${upiOk ? '' : ' field--bad'}`}
          value={upi}
          maxLength={80}
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="ria@okaxis"
          onChange={(e) => setUpi(e.target.value)}
        />
        <Press tone="ink" size="lg" block type="submit" loading={busy} onClick={() => {}}>
          {T('Get started', 'Shuru kar')} →
        </Press>
        <p className="fine center">{T('Free. No email, no phone number, no password.', 'Free. Na email, na phone number, na password.')}</p>
        <div className="welcome__alt">
          <button type="button" className="linkish" onClick={() => nav('/link')}>
            📲 {T('I have the app on another phone', 'Doosre phone pe app hai')}
          </button>
          <button type="button" className="linkish" onClick={() => setRestoring(true)}>
            🔑 {T('Log in with my 12 backup words', '12 backup words se login')}
          </button>
          {more ? (
            <button type="button" className="linkish" onClick={() => setKeyOpen(true)}>
              {T('I have an old device key', 'Mere paas purani device key hai')}
            </button>
          ) : (
            <button type="button" className="linkish muted" onClick={() => setMore(true)}>
              {T('More ways', 'Aur tareeke')}
            </button>
          )}
        </div>
      </form>

      <RestoreSheet open={restoring} onClose={() => setRestoring(false)} onDone={() => nav(next, { replace: true })} />

      <Sheet open={keyOpen} onClose={() => setKeyOpen(false)} title={T('Paste your device key', 'Device key paste kar')}>
        <p className="muted">{T('Very old accounts used a device key. Copy it from Me on your other browser or phone.', 'Bahut purane accounts mein device key thi. Doosre browser/phone mein Main se copy kar.')}</p>
        <textarea className="field mono" rows={3} value={key} onChange={(e) => setKey(e.target.value)} placeholder="xY3k…" />
        <Press tone="sats" block loading={busy} disabled={key.trim().length < 20} onClick={restoreLegacy}>
          {T('Use this key', 'Is key se khol')}
        </Press>
      </Sheet>
    </div>
  )
}
