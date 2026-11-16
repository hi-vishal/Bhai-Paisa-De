import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { isMnemonic, normalizeMnemonic, WORDLIST } from '@shared/keys'
import { copyText } from '../lib/format'
import { errText, useLang, useT } from '../lib/i18n'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import { markBackedUp, needsPin, revealPhrase, VaultError } from '../lib/vault'
import { blast, Emoji } from './bits'
import { PinPad, type Secret } from './PinPad'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

const vaultErr = (e: unknown, T: (en: string, hi: string) => string) =>
  e instanceof VaultError && e.code === 'cooldown'
    ? T(`Too many wrong tries. Wait ${Math.ceil(e.waitMs / 1000)}s.`, `Bahut galat try. ${Math.ceil(e.waitMs / 1000)}s ruk.`)
    : e instanceof VaultError && e.code === 'device_lost'
      ? T('This browser lost its key. Use your 12 words or log in from your other phone.', 'Is browser ki key gayab. 12 words ya doosre phone se login kar.')
      : e instanceof VaultError
        ? T('Wrong PIN', 'Galat PIN')
        : null

/** Set a PIN twice. Calls back with the secret once both match. */
export function SetSecret({ onSet, busy, title }: { onSet: (s: Secret) => void; busy?: boolean; title?: string }) {
  const T = useT()
  const [first, setFirst] = useState<Secret | null>(null)
  const [err, setErr] = useState(0)
  return first ? (
    <PinPad
      key="confirm"
      kind={first.kind}
      title={T('Once more, to be sure', 'Ek baar aur, pakka karne ke liye')}
      error={err}
      busy={busy}
      onDone={(s) => {
        if (s.value !== first.value) {
          setErr((n) => n + 1)
          setTimeout(() => setFirst(null), 450)
          return
        }
        onSet(s)
      }}
    />
  ) : (
    <PinPad
      key="set"
      title={title ?? T('Pick a PIN', 'PIN rakh')}
      sub={T('It locks your wallet on this phone. Nobody, including us, can reset it. Your 12 words can.', 'Ye is phone pe wallet lock karta hai. Koi reset nahi kar sakta, hum bhi nahi. 12 words kar sakte hain.')}
      onDone={setFirst}
    />
  )
}

/** Account back from its 12 words: words → (a name, if the words are new here) → in. */
export function RestoreSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { T, lang } = useLang()
  const { restoreAccount } = useSession()
  const toast = useToast()
  const [words, setWords] = useState('')
  const [step, setStep] = useState<'words' | 'name' | 'busy'>('words')
  const [name, setName] = useState('')
  const list = normalizeMnemonic(words).split(' ').filter(Boolean)
  const valid = isMnemonic(words)
  const unknown = list.filter((w) => !WORDLIST.includes(w))

  useEffect(() => {
    if (!open) {
      setStep('words')
      setWords('')
      setName('')
    }
  }, [open])

  const go = async (n?: string) => {
    setStep('busy')
    try {
      const r = await restoreAccount(words, n)
      if (r === 'needs_name') return setStep('name')
      // they just typed all 12 words, so the phrase is clearly written down somewhere
      markBackedUp()
      sfx.success()
      toast(T(`Welcome back, ${r.name}`, `Wapas aa gaya ${r.name}!`), { tone: 'get', emoji: '🔑' })
      onDone()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
      setStep('words')
    }
  }

  return (
    <Sheet open={open} onClose={() => step !== 'busy' && onClose()} title={step === 'words' ? T('Your 12 backup words', 'Tere 12 backup words') : undefined}>
      {step === 'words' && (
        <>
          <p className="muted">{T('Type or paste them in order, separated by spaces.', 'Order mein likh ya paste kar, space se alag.')}</p>
          <textarea
            className="field mono"
            rows={4}
            value={words}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="pill tomorrow foster begin walnut…"
            onChange={(e) => setWords(e.target.value)}
          />
          <p className={`fine${unknown.length ? ' neg' : ''}`}>
            {unknown.length
              ? T(`Not a backup word: ${unknown.slice(0, 3).join(', ')}`, `Ye backup word nahi: ${unknown.slice(0, 3).join(', ')}`)
              : list.length && !valid
                ? T(`${list.length} of 12 words${list.length >= 12 ? ', but they don’t check out. Check the order.' : ''}`, `${list.length}/12 words${list.length >= 12 ? ', par match nahi. Order check kar.' : ''}`)
                : valid
                  ? T('Looks right ✓', 'Sahi lag raha ✓')
                  : ' '}
          </p>
          <Press tone="sats" block disabled={!valid} onClick={() => go()}>
            {T('Log in', 'Login kar')}
          </Press>
        </>
      )}
      {step === 'busy' && <Minting />}
      {step === 'name' && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) void go(name.trim())
          }}
        >
          <p>{T('These words are new here. What should friends call you?', 'Ye words yahan naye hain. Dost tujhe kya bulaate hain?')}</p>
          <input className="field field--big" value={name} maxLength={32} autoFocus onChange={(e) => setName(e.target.value)} />
          <Press tone="ink" block type="submit" disabled={!name.trim()} onClick={() => {}}>
            {T("Let's go", 'Chal')}
          </Press>
        </form>
      )}
    </Sheet>
  )
}

function Minting() {
  const T = useT()
  return (
    <div className="minting">
      <motion.div animate={{ rotate: [0, 18, -14, 360] }} transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}>
        <Emoji char="🔑" size={88} />
      </motion.div>
      <h3>{T('Opening your account…', 'Account khul raha hai…')}</h3>
    </div>
  )
}

/** Show the 12 words (PIN first, if there is one), then check 3 of them. Passing marks the account backed up. */
export function BackupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T } = useLang()
  const toast = useToast()
  const [mnemonic, setMnemonic] = useState<string | null>(null)
  const [err, setErr] = useState(0)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'show' | 'quiz' | 'done'>('show')
  const [shown, setShown] = useState(false)
  const words = mnemonic?.split(' ') ?? []
  const quiz = useMemo(() => {
    if (!mnemonic) return []
    const idx = [...Array(12).keys()].sort(() => Math.random() - 0.5).slice(0, 3).sort((a, b) => a - b)
    return idx.map((i) => {
      const decoys = WORDLIST.filter((w) => w !== words[i]).sort(() => Math.random() - 0.5).slice(0, 3)
      return { i, options: [words[i], ...decoys].sort(() => Math.random() - 0.5) }
    })
  }, [mnemonic]) // eslint-disable-line react-hooks/exhaustive-deps
  const [answers, setAnswers] = useState<Record<number, string>>({})

  useEffect(() => {
    if (open) {
      setStep('show')
      setShown(false)
      setAnswers({})
      if (!needsPin())
        revealPhrase()
          .then(setMnemonic)
          .catch((e) => toast(vaultErr(e, T) ?? String(e), { tone: 'owe' }))
    } else setMnemonic(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const allRight = quiz.length > 0 && quiz.every((qz) => answers[qz.i] === words[qz.i])

  return (
    <Sheet open={open} onClose={onClose} title={mnemonic ? (step === 'quiz' ? T('Quick check', 'Chhota sa test') : T('Your 12 backup words', 'Tere 12 backup words')) : undefined}>
      {!mnemonic ? (
        needsPin() ? (
          <PinPad
            title={T('Enter your PIN to see your words', 'Words dekhne ke liye PIN daal')}
            error={err}
            busy={busy}
            onDone={async (s) => {
              setBusy(true)
              try {
                setMnemonic(await revealPhrase(s.value))
              } catch (e) {
                setErr((n) => n + 1)
                const m = vaultErr(e, T)
                if (m) toast(m, { tone: 'owe', silent: true })
              } finally {
                setBusy(false)
              }
            }}
          />
        ) : (
          <Minting />
        )
      ) : step === 'show' ? (
        <>
          <div className="callout callout--owe">
            <b>{T('These 12 words are your account.', 'Ye 12 words hi tera account hain.')}</b>{' '}
            {T('Write them on paper, in order. They get you back in if you lose this phone. Anyone who has them can log in as you, so no screenshots and no chats.', 'Kaagaz pe order mein likh. Phone kho gaya toh inse wapas aayega. Jiske paas ye, woh tu ban sakta hai, toh screenshot nahi, chat nahi.')}
          </div>
          <button type="button" className={`seedgrid${shown ? '' : ' is-blur'}`} onClick={() => (sfx.pop(), setShown(true))} aria-label={T('Tap to reveal', 'Dekhne ke liye tap kar')}>
            {words.map((w, i) => (
              <motion.span key={i} className="seedword" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                <small>{i + 1}</small>
                {w}
              </motion.span>
            ))}
            {!shown && <span className="seedgrid__veil">👀 {T('Tap to reveal. Check nobody is looking', 'Tap kar. Dekh koi jhaank toh nahi raha')}</span>}
          </button>
          <div className="share-row">
            <Press
              tone="paper"
              onClick={async () => {
                await copyText(mnemonic)
                toast(T('Copied. Paste it somewhere safe, then clear your clipboard.', 'Copy ho gaya. Safe jagah paste kar, phir clipboard saaf kar.'), { tone: 'owe', emoji: '⚠️', silent: true })
              }}
            >
              {T('Copy', 'Copy')}
            </Press>
            <Press tone="sats" disabled={!shown} onClick={() => setStep('quiz')}>
              {T('I wrote it down', 'Likh liya')}
            </Press>
          </div>
        </>
      ) : step === 'quiz' ? (
        <>
          <p className="muted">{T('Tap the right word for each number.', 'Har number ke liye sahi word tap kar.')}</p>
          {quiz.map((qz) => (
            <div key={qz.i} className="quiz">
              <b className="quiz__n">#{qz.i + 1}</b>
              <div className="chips">
                {qz.options.map((o) => (
                  <motion.button
                    key={o}
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    className={`chip${answers[qz.i] === o ? (o === words[qz.i] ? ' chip--on' : ' chip--bad') : ''}`}
                    onClick={() => {
                      if (o === words[qz.i]) sfx.pop()
                      else (sfx.error(), haptic([20, 30, 20]))
                      setAnswers((a) => ({ ...a, [qz.i]: o }))
                    }}
                  >
                    {o}
                  </motion.button>
                ))}
              </div>
            </div>
          ))}
          <Press
            tone="get"
            block
            disabled={!allRight}
            onClick={() => {
              markBackedUp()
              sfx.success()
              blast('party')
              setStep('done')
            }}
          >
            {T('Done, it’s safe', 'Ho gaya, safe hai')}
          </Press>
          <button type="button" className="linkish center" onClick={() => setStep('show')}>
            {T('Show the words again', 'Words phir se dikha')}
          </button>
        </>
      ) : (
        <div className="minting">
          <Emoji char="🔐" size={96} />
          <h3>{T('Backed up. Sleep easy.', 'Backup ho gaya. Chain ki neend so.')}</h3>
          <Press tone="ink" block onClick={onClose}>
            {T('Close', 'Band kar')}
          </Press>
        </div>
      )}
    </Sheet>
  )
}

/** Accounts from before keys: make one now and keep the same account and groups. */
export function UpgradeSheet({ open, onClose }: { open: boolean; onClose: (done?: boolean) => void }) {
  const { T, lang } = useLang()
  const { upgradeLegacy } = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={T('Secure your account', 'Account secure kar')}>
      <p className="muted">
        {T(
          'Your account becomes a key on this phone with 12 backup words you can restore anywhere, and every change you make gets signed by you. Same account, same groups.',
          'Tera account is phone pe ek key ban jaayega, saath mein 12 backup words jo kahin bhi restore ho. Har change tere sign se. Wahi account, wahi groups.',
        )}
      </p>
      <Press
        tone="sats"
        size="lg"
        block
        loading={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await upgradeLegacy()
            sfx.success()
            blast('party')
            onClose(true)
          } catch (e) {
            toast(errText(e, lang), { tone: 'owe' })
          } finally {
            setBusy(false)
          }
        }}
      >
        🔐 {T('Secure it', 'Secure kar')}
      </Press>
    </Sheet>
  )
}

/**
 * Turn on USDT and SOL. Your account key moves under a PIN, because from here on it can move money.
 * If there's already a PIN, it just asks for it.
 */
export function CryptoSheet({ open, onClose }: { open: boolean; onClose: (on?: boolean) => void }) {
  const { T, lang } = useLang()
  const { enableCrypto } = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<'intro' | 'pin'>('intro')
  useEffect(() => {
    if (open) setStep('intro')
  }, [open])

  const turnOn = async (s: Secret | null) => {
    setBusy(true)
    try {
      await enableCrypto(s?.value ?? null, s?.kind ?? 'pin')
      sfx.chaching()
      blast('money')
      onClose(true)
    } catch (e) {
      toast(vaultErr(e, T) ?? errText(e, lang), { tone: 'owe' })
      setStep('intro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={step === 'intro' ? T('Crypto payments', 'Crypto payments') : undefined}>
      {step === 'intro' ? (
        <div className="stack">
          <ul className="ticks">
            <li>{T('Friends can also pay you in USDT or SOL on the Solana network.', 'Dost tujhe Solana network pe USDT ya SOL mein bhi de sakte hain.')}</li>
            <li>{T('Money lands in a wallet on this phone that only you control. We can’t move it.', 'Paise is phone ke wallet mein aate hain, sirf tere control mein. Hum hila nahi sakte.')}</li>
            <li>{T('A PIN protects the wallet. Your 12 backup words restore it.', 'PIN wallet ko lock rakhta hai. 12 backup words se wapas milta hai.')}</li>
          </ul>
          <p className="fine">{T('Crypto prices move and payments can’t be reversed. Only turn this on if you know how USDT works.', 'Crypto ka rate badalta hai aur payment wapas nahi hoti. Tabhi on kar jab USDT samajhta ho.')}</p>
          <Press tone="sats" size="lg" block loading={busy} onClick={() => (needsPin() ? turnOn(null) : setStep('pin'))}>
            {T('Turn on', 'On kar')}
          </Press>
        </div>
      ) : (
        <SetSecret busy={busy} title={T('Pick a PIN for your wallet', 'Wallet ke liye PIN rakh')} onSet={(s) => void turnOn(s)} />
      )}
    </Sheet>
  )
}
