import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useState } from 'react'
import { ASSETS, baseToMinor, CURRENCIES, formatBase, type Asset, type CurrencyCode } from '@shared/money'
import { explorerAddress, explorerTx, fromDecimal, isAddress, toDecimal } from '@shared/solana'
import { blast, Emoji, QR, Spinner } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Odometer } from '../components/Odometer'
import { Press } from '../components/Press'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { BackupSheet, CryptoSheet } from '../components/WalletFlows'
import { api } from '../lib/api'
import { ago, copyText, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { requireUnlocked } from '../lib/sign'
import { balances, history, planSend, send, serverInfo, WalletError, type Balances, type HistoryItem, type ServerInfo } from '../lib/solwallet'
import { haptic, sfx } from '../lib/sound'

type Prices = Record<Asset, { price: number; source: string }>
const FIAT_KEY = 'bpd.fiat'
const fiatPref = (): CurrencyCode => {
  try {
    const v = localStorage.getItem(FIAT_KEY)
    if (v && v in CURRENCIES) return v as CurrencyCode
  } catch {
    // ignore
  }
  return 'INR'
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`

/** The galla: the shop's cash drawer. SOL and USDT you hold yourself, on this phone. */
export function Wallet() {
  const { T, lang } = useLang()
  const { user, vault } = useSession()
  const toast = useToast()
  const [srv, setSrv] = useState<ServerInfo | null>(null)
  const [bal, setBal] = useState<Balances | null>(null)
  const [prices, setPrices] = useState<Prices | null>(null)
  const [hist, setHist] = useState<HistoryItem[] | null>(null)
  const [fiat, setFiat] = useState<CurrencyCode>(fiatPref)
  const [err, setErr] = useState<unknown>(null)
  const [receive, setReceive] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [backup, setBackup] = useState(false)
  const [turnOn, setTurnOn] = useState(false)
  const address = vault && user?.solAddress ? vault.sol : null

  const load = useCallback(async () => {
    if (!address) return
    try {
      const [s, b, p] = await Promise.all([serverInfo(), balances(address), api<Prices>(`/prices/${fiat}`)])
      setSrv(s)
      setBal(b)
      setPrices(p)
      setErr(null)
      void history(address).then(setHist).catch(() => setHist([]))
    } catch (e) {
      setErr(e)
    }
  }, [address, fiat])

  useEffect(() => {
    void load()
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 20_000)
    return () => clearInterval(t)
  }, [load])

  if (!user) return null

  if (!address)
    return (
      <div className="screen">
        <TopBar back="/me" title={T('Crypto wallet', 'Crypto wallet')} />
        <motion.section className="stk stk--lav wallet-empty" initial={{ rotate: 3, opacity: 0 }} animate={{ rotate: -1, opacity: 1 }}>
          <Emoji char="₮" size={88} />
          <h2>{T('Crypto payments are off', 'Crypto payments off hain')}</h2>
          <p>{T('Optional. Turn them on and friends can also pay you in USDT or SOL, into a wallet on this phone that only you control.', 'Optional. On kar toh dost USDT ya SOL mein bhi de sakte hain, is phone ke wallet mein jo sirf tere control mein hai.')}</p>
          <Press tone="ink" block disabled={!vault} onClick={() => setTurnOn(true)}>
            {T('Turn on', 'On kar')}
          </Press>
        </motion.section>
        <CryptoSheet open={turnOn} onClose={() => setTurnOn(false)} />
      </div>
    )

  const devnet = srv && srv.solana.cluster !== 'mainnet-beta'
  const value = (asset: Asset, base: bigint) => (prices ? baseToMinor(base, fiat, asset, prices[asset].price) : 0)
  const total = bal ? value('SOL', bal.sol) + value('USDT', bal.usdt) : 0
  const stable = srv?.solana.stableLabel ?? 'USDT'

  return (
    <div className="screen">
      <TopBar
        back="/me"
        title={T('Crypto wallet', 'Crypto wallet')}
        sub={
          srv && (
            <span className={`netbadge${devnet ? ' netbadge--test' : ''}`}>
              <i /> {srv.solana.cluster === 'mainnet-beta' ? 'Solana mainnet' : `Solana ${srv.solana.cluster} · ${T('test money', 'test paisa')}`}
            </span>
          )
        }
      />

      <motion.section className="galla stk stk--sats" initial={{ rotate: -3, y: 14, opacity: 0 }} animate={{ rotate: -1, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <div className="galla__top">
          <span className="galla__label">{T('In your galla', 'Tere galle mein')}</span>
          <select
            className="galla__fiat"
            value={fiat}
            aria-label={T('Show in', 'Kis currency mein')}
            onChange={(e) => {
              const c = e.target.value as CurrencyCode
              setFiat(c)
              try {
                localStorage.setItem(FIAT_KEY, c)
              } catch {
                // ignore
              }
            }}
          >
            {(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        {bal && prices ? <Odometer value={money(total, fiat)} className="galla__amt" /> : <span className="galla__amt galla__amt--wait">{err ? '—' : '···'}</span>}
        <div className="galla__assets">
          <span>
            ◎ {bal ? formatBase(bal.sol, 'SOL', 4) : '…'}
          </span>
          <span>
            ₮ {bal ? formatBase(bal.usdt, 'USDT') : '…'}
          </span>
        </div>
        <button
          type="button"
          className="galla__addr mono"
          onClick={async () => {
            await copyText(address!)
            sfx.pop()
            toast(T('Address copied', 'Address copy ho gaya'), { emoji: '📋', tone: 'get', silent: true })
          }}
        >
          {short(address!)} ⧉
        </button>
        <span className="galla__coin" aria-hidden>
          <Emoji char="🪙" size={70} />
        </span>
      </motion.section>

      {err !== null && <div className="callout callout--owe">{T("Couldn't reach the Solana network. Pull down to retry.", 'Solana network tak nahi pahunch paaye. Thodi der mein try kar.')} <span className="fine">{errText(err, lang)}</span></div>}

      <div className="galla__acts">
        <Press tone="get" onClick={() => setReceive(true)}>
          ↓ {T('Receive', 'Le')}
        </Press>
        <Press tone="owe" onClick={() => setSendOpen(true)} disabled={!bal}>
          ↑ {T('Send', 'Bhej')}
        </Press>
        <Press tone="paper" onClick={() => (sfx.tap(), void load())}>
          ↻
        </Press>
      </div>

      {!vault?.backedUp && (
        <motion.button className="nag stk stk--owe" initial={{ rotate: 2, scale: 0.95 }} animate={{ rotate: 0.6, scale: 1 }} onClick={() => setBackup(true)}>
          <Emoji char="📝" size={44} />
          <span>
            <b>{T('Write down your 12 words', 'Apne 12 words likh le')}</b>
            <small>{T('Lose this phone without them and the money is gone. 2 minutes, once.', 'Inke bina phone gaya toh paise gaye. 2 minute, bas ek baar.')}</small>
          </span>
          <span className="nag__go">→</span>
        </motion.button>
      )}

      <h2 className="section-title">{T('What you hold', 'Kya hai')}</h2>
      <ul className="assets">
        <AssetRow icon="◎" name="Solana" unit="SOL" amount={bal ? formatBase(bal.sol, 'SOL', 6) : '…'} fiat={bal && prices ? money(value('SOL', bal.sol), fiat) : ''} tone="lav" />
        <AssetRow icon="₮" name={stable} unit="USDT" amount={bal ? formatBase(bal.usdt, 'USDT') : '…'} fiat={bal && prices ? money(value('USDT', bal.usdt), fiat) : ''} tone="get" />
      </ul>
      {bal && bal.sol === 0n && bal.usdt > 0n && <p className="fine">⚠️ {T('Sending USDT needs a little SOL for the network fee (about ₹0.05).', 'USDT bhejne ke liye network fee ke liye thoda SOL chahiye (lagbhag ₹0.05).')}</p>}

      {devnet && (
        <div className="callout">
          <b>{T('This is test money.', 'Ye test paisa hai.')}</b>{' '}
          {T('Get free devnet SOL at', 'Free devnet SOL yahan se:')}{' '}
          <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
            faucet.solana.com
          </a>{' '}
          {T('and test dollars at', 'aur test dollars:')}{' '}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">
            faucet.circle.com
          </a>{' '}
          (Solana devnet).
        </div>
      )}

      <h2 className="section-title">{T('Recent', 'Haal hi mein')}</h2>
      {!hist ? (
        <Spinner />
      ) : !hist.length ? (
        <p className="fine">{T('Nothing yet. Share your address or a pay link.', 'Abhi kuch nahi. Address ya pay link share kar.')}</p>
      ) : (
        <ul className="txlist">
          {hist.map((h) => {
            const asset: Asset = h.usdt !== 0n ? 'USDT' : 'SOL'
            const amt = asset === 'USDT' ? h.usdt : h.sol
            const incoming = amt > 0n
            return (
              <li key={h.signature} className="txrow">
                <span className={`txrow__dir ${incoming ? 'in' : 'out'}`}>{incoming ? '↓' : '↑'}</span>
                <span className="txrow__mid">
                  <b className={incoming ? 'pos' : ''}>{incoming ? '+' : ''}{formatBase(amt, asset, asset === 'SOL' ? 5 : 2)}</b>
                  <small>{h.at ? ago(h.at, lang) : '…'}{!h.ok && ` · ${T('failed', 'fail')}`}</small>
                </span>
                {srv && (
                  <a className="txrow__link" href={explorerTx(h.signature, srv.solana.cluster)} target="_blank" rel="noreferrer">
                    {T('Explorer', 'Explorer')} ↗
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {srv && (
        <a className="linkish center" href={explorerAddress(address!, srv.solana.cluster)} target="_blank" rel="noreferrer">
          {T('See everything on Solana Explorer', 'Sab kuch Solana Explorer pe dekh')} ↗
        </a>
      )}

      <Sheet open={receive} onClose={() => setReceive(false)} title={T('Receive', 'Le')}>
        <div className="receive">
          <div className="qrframe__qr receive__qr">
            <QR text={`solana:${address}`} size={220} />
          </div>
          <button
            type="button"
            className="keybox mono"
            onClick={async () => {
              await copyText(address!)
              sfx.pop()
              toast(T('Address copied', 'Address copy ho gaya'), { emoji: '📋', tone: 'get', silent: true })
            }}
          >
            {address}
          </button>
          <p className="fine center">
            {T(`Send only SOL or ${stable} on the Solana network${devnet ? ' (devnet)' : ''} to this address. Other networks will be lost.`, `Is address pe sirf Solana network${devnet ? ' (devnet)' : ''} pe SOL ya ${stable} bhej. Doosre network ka paisa gum ho jaayega.`)}
          </p>
          {typeof navigator.share === 'function' && (
            <Press tone="sats" block onClick={() => void navigator.share({ text: address! }).catch(() => {})}>
              {T('Share address', 'Address share kar')}
            </Press>
          )}
        </div>
      </Sheet>

      {bal && prices && srv && (
        <SendSheet
          open={sendOpen}
          onClose={() => setSendOpen(false)}
          from={address!}
          bal={bal}
          prices={prices}
          fiat={fiat}
          srv={srv}
          onSent={() => {
            void load()
          }}
        />
      )}
      <BackupSheet open={backup} onClose={() => setBackup(false)} />
    </div>
  )
}

function AssetRow({ icon, name, unit, amount, fiat, tone }: { icon: string; name: string; unit: string; amount: string; fiat: string; tone: string }) {
  return (
    <li className="asset stk">
      <span className={`asset__icon stk--${tone}`}>{icon}</span>
      <span className="asset__mid">
        <b>{name}</b>
        <small>{unit} · Solana</small>
      </span>
      <span className="asset__amt">
        <b>{amount}</b>
        <small>{fiat}</small>
      </span>
    </li>
  )
}

type Stage = 'form' | 'review' | 'sending' | 'done'

function SendSheet({ open, onClose, from, bal, prices, fiat, srv, onSent }: { open: boolean; onClose: () => void; from: string; bal: Balances; prices: Prices; fiat: CurrencyCode; srv: ServerInfo; onSent: () => void }) {
  const { T, lang } = useLang()
  const toast = useToast()
  const [asset, setAsset] = useState<'USDT' | 'SOL'>(bal.usdt > 0n || bal.sol === 0n ? 'USDT' : 'SOL')
  const [to, setTo] = useState('')
  const [amt, setAmt] = useState('')
  const [stage, setStage] = useState<Stage>('form')
  const [plan, setPlan] = useState<Awaited<ReturnType<typeof planSend>> | null>(null)
  const [sig, setSig] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const d = asset === 'USDT' ? srv.solana.stableDecimals : ASSETS.SOL.decimals
  const base = fromDecimal(amt || '0', d)
  const toOk = isAddress(to.trim()) && to.trim() !== from
  const ok = toOk && base !== null && base > 0n
  const have = asset === 'USDT' ? bal.usdt : bal.sol

  useEffect(() => {
    if (open) {
      setStage('form')
      setSig(null)
      setPlan(null)
    }
  }, [open])

  const review = async () => {
    if (!ok) return
    setBusy(true)
    try {
      setPlan(await planSend(from, to.trim(), asset, base!))
      setStage('review')
      sfx.pop()
    } catch (e) {
      toast(e instanceof WalletError ? T(e.message, e.message) : errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const go = async () => {
    if (!plan) return
    try {
      const id = await requireUnlocked()
      setStage('sending')
      sfx.send()
      const s = await send(id, plan, setSig)
      setSig(s)
      setStage('done')
      sfx.chaching()
      haptic([20, 60, 30])
      blast('money')
      onSent()
    } catch (e) {
      setStage('review')
      toast(e instanceof Error ? e.message : errText(e, lang), { tone: 'owe' })
    }
  }

  return (
    <Sheet open={open} onClose={() => stage !== 'sending' && onClose()} title={stage === 'done' ? undefined : T('Send', 'Bhej')}>
      <AnimatePresence mode="wait">
        {stage === 'form' && (
          <motion.div key="f" className="stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="seg seg--2">
              {(['USDT', 'SOL'] as const).map((a) => (
                <button key={a} type="button" className={`seg__btn${asset === a ? ' is-on' : ''}`} onClick={() => (sfx.tap(), setAsset(a), setAmt(''))}>
                  {asset === a && <motion.i layoutId="send-asset" className="seg__pill" />}
                  <span>{a === 'USDT' ? '₮ USDT' : '◎ SOL'}</span>
                </button>
              ))}
            </div>
            <label className="label" htmlFor="sendto">
              {T('To (Solana address)', 'Kisko (Solana address)')}
            </label>
            <div className="paste">
              <input id="sendto" className="field mono" value={to} spellCheck={false} autoComplete="off" placeholder="7xKX…" onChange={(e) => setTo(e.target.value)} />
              <button
                type="button"
                className="chip chip--tiny paste__btn"
                onClick={async () => {
                  try {
                    setTo((await navigator.clipboard.readText()).trim())
                    sfx.pop()
                  } catch {
                    toast(T('Clipboard blocked. Long-press to paste.', 'Clipboard band hai. Long-press karke paste kar.'), { tone: 'owe', silent: true })
                  }
                }}
              >
                {T('Paste', 'Paste')}
              </button>
            </div>
            {to && !toOk && <p className="fine neg">{to.trim() === from ? T('That’s your own address', 'Ye tera hi address hai') : T('Not a Solana address', 'Ye Solana address nahi')}</p>}
            <label className="label" htmlFor="sendamt">
              {T('Amount', 'Kitna')}
            </label>
            <div className="paste">
              <input id="sendamt" className="field field--big" inputMode="decimal" value={amt} placeholder="0" onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ''))} />
              <button type="button" className="chip chip--tiny paste__btn" onClick={() => (sfx.tap(), setAmt(toDecimal(asset === 'SOL' ? (have > 10_000_000n ? have - 10_000_000n : 0n) : have, d)))}>
                {T('Max', 'Max')}
              </button>
            </div>
            <p className="fine">
              {base !== null && base > 0n ? `≈ ${money(baseToMinor(base, fiat, asset, prices[asset].price), fiat)} · ` : ''}
              {T('You have', 'Tere paas')} {formatBase(have, asset, 6)}
            </p>
            <Press tone="ink" block loading={busy} disabled={!ok} onClick={review}>
              {T('Review', 'Check kar')}
            </Press>
          </motion.div>
        )}
        {stage === 'review' && plan && (
          <motion.div key="r" className="stack" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
            <div className="receipt">
              <div className="receipt__row">
                <span>{T('Sending', 'Bhej raha')}</span>
                <b>{formatBase(base!, asset, 6)}</b>
              </div>
              <div className="receipt__row">
                <span>{T('Worth', 'Keemat')}</span>
                <b>≈ {money(baseToMinor(base!, fiat, asset, prices[asset].price), fiat)}</b>
              </div>
              <div className="receipt__row">
                <span>{T('To', 'Kisko')}</span>
                <b className="mono">{short(to.trim())}</b>
              </div>
              <div className="receipt__row">
                <span>{T('Network fee', 'Network fee')}</span>
                <b>{formatBase(plan.feeLamports, 'SOL', 6)}</b>
              </div>
              {plan.createsAccount && <p className="fine">{T('Includes a one-time ~0.002 SOL to open their USDT account.', 'Isme unka USDT account kholne ka ek baar ka ~0.002 SOL shaamil hai.')}</p>}
            </div>
            <p className="fine">{T('Crypto payments can’t be undone. Check the address.', 'Crypto payment wapas nahi hota. Address check kar le.')}</p>
            <Press tone="owe" size="lg" block onClick={go}>
              🔐 {T('Approve with PIN & send', 'PIN se approve kar & bhej')}
            </Press>
            <button type="button" className="linkish center" onClick={() => setStage('form')}>
              ← {T('Edit', 'Badal')}
            </button>
          </motion.div>
        )}
        {stage === 'sending' && (
          <motion.div key="s" className="minting" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div animate={{ x: [0, 160], opacity: [1, 0] }} transition={{ repeat: Infinity, duration: 1.1 }}>
              <Emoji char="💸" size={84} />
            </motion.div>
            <h3>{sig ? T('Sent. Waiting for the network…', 'Bhej diya. Network ka wait…') : T('Signing on your phone…', 'Phone pe sign ho raha…')}</h3>
          </motion.div>
        )}
        {stage === 'done' && (
          <motion.div key="d" className="minting" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <Emoji char="✅" size={96} />
            <h3>{T('Confirmed on Solana', 'Solana pe confirm')}</h3>
            {sig && (
              <a className="linkish" href={explorerTx(sig, srv.solana.cluster)} target="_blank" rel="noreferrer">
                {T('View on Explorer', 'Explorer pe dekh')} ↗
              </a>
            )}
            <Press tone="ink" block onClick={onClose}>
              {T('Done', 'Ho gaya')}
            </Press>
          </motion.div>
        )}
      </AnimatePresence>
    </Sheet>
  )
}
