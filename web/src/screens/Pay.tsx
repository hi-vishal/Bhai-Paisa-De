import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { ClaimMethod } from '@shared/claims'
import { ASSETS, CURRENCIES, formatBase } from '@shared/money'
import { explorerTx, toDecimal } from '@shared/solana'
import { Avatar } from '../components/Avatar'
import { blast, Emoji, LangToggle, LogoMark, QR, Spinner, ThemeToggle } from '../components/bits'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { UpiPay } from '../components/UpiPay'
import { api, ApiError } from '../lib/api'
import { copyText, firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { requireUnlocked } from '../lib/sign'
import { planSend, send, serverInfo, WalletError } from '../lib/solwallet'
import { haptic, sfx } from '../lib/sound'
import type { Claim, PayInfo, Quote, Rail } from '../lib/types'

const SOL_WALLETS = ['Phantom', 'Solflare', 'Backpack', 'Binance', 'OKX', 'Trust Wallet']
const ORDER: Rail[] = ['UPI', 'USDT', 'SOL']

const rail: Record<Rail, { icon: string; en: string; hi: string; sub: string; tone: string }> = {
  UPI: { icon: '📲', en: 'UPI', hi: 'UPI', sub: 'GPay · PhonePe · Paytm', tone: 'get' },
  USDT: { icon: '₮', en: 'USDT', hi: 'USDT', sub: 'Solana', tone: 'cash' },
  SOL: { icon: '◎', en: 'SOL', hi: 'SOL', sub: 'Solana', tone: 'lav' },
}

/** The page a friend opens from WhatsApp. No account, no install: pay, tap "I've paid", done. */
export function Pay() {
  const { token } = useParams()
  const { T, lang } = useLang()
  const toast = useToast()
  const [info, setInfo] = useState<PayInfo | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [pick, setPick] = useState<Rail | null>(null)
  const [busy, setBusy] = useState(false)
  const [method, setMethod] = useState<ClaimMethod>('cash')
  const celebrated = useRef(false)

  const load = useCallback(async () => {
    try {
      const r = await api<PayInfo>(`/pay/${token}`, { auth: false })
      setInfo(r)
      if (r.pending) {
        setQuote(r.pending)
        setPick(r.pending.asset as Rail)
      } else {
        // UPI first, always; a crypto tab the payer picked stays picked while the page is open
        setPick((cur) => (cur && r.to.rails[cur] ? cur : ORDER.find((a) => r.to.rails[a]) ?? null))
      }
    } catch (e) {
      setErr(e)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const claim = info?.claim ?? null
  const waiting = claim?.status === 'pending'
  // while the payee hasn't answered, keep the page fresh so "confirmed" shows up by itself
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => void load(), 4000)
    return () => clearInterval(t)
  }, [waiting, load])

  // crypto: the server watches the chain; we just listen
  useEffect(() => {
    if (!quote || quote.status === 'paid' || quote.status === 'rejected' || (quote.status === 'expired' && !quote.lateWatch)) return
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        const r = await api<{ quote: Quote }>(`/pay/${token}/quote/${quote.id}`, { auth: false })
        if (!stop) setQuote(r.quote)
      } catch {
        // network blip; the next poll will catch up
      }
      if (!stop) setTimeout(tick, quote.status === 'expired' ? 6000 : 2000)
    }
    const t = setTimeout(tick, 1500)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [quote?.id, quote?.status, token]) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmed = claim?.status === 'confirmed' || quote?.status === 'paid'
  useEffect(() => {
    if (confirmed && !celebrated.current) {
      celebrated.current = true
      sfx.stamp()
      haptic([20, 60, 30, 60, 80])
      setTimeout(() => sfx.chaching(), 250)
      setTimeout(() => blast('money'), 300)
    }
  }, [confirmed])

  const getQuote = async (a: Rail | null = pick) => {
    if (!a || a === 'UPI') return
    setBusy(true)
    try {
      const r = await api<{ quote: Quote }>(`/pay/${token}/quote`, { body: { asset: a }, auth: false })
      sfx.zap()
      haptic([5, 20, 5])
      setQuote(r.quote)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'nothing_owed') await load()
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const choose = (a: Rail) => {
    sfx.tap()
    setPick(a)
    if (quote && quote.status !== 'paid') setQuote(null)
  }

  const sayPaid = async (amount: number, how: ClaimMethod, ref: string | null) => {
    setBusy(true)
    try {
      await api(`/pay/${token}/claims`, { body: { amount, method: how, ref }, auth: false })
      sfx.send()
      haptic([10, 40, 10])
      await load()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const takeBack = async (c: Claim) => {
    try {
      await api(`/pay/${token}/claims/${c.id}/cancel`, { body: {}, auth: false })
      sfx.unpop()
      await load()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const demoPay = async () => {
    if (!quote) return
    try {
      const r = await api<{ quote: Quote }>(`/pay/${token}/quote/${quote.id}/demo-pay`, { method: 'POST', auth: false })
      setQuote(r.quote)
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  if (err)
    return (
      <div className="pay pay--dead">
        <PayHeader />
        <div className="pay__center">
          <Emoji char="🫥" size={110} />
          <h1>{T('This link is broken', 'Ye link toota hua hai')}</h1>
          <p>{errText(err, lang)}</p>
        </div>
        <PayFooter />
      </div>
    )
  if (!info) return <div className="pay"><PayHeader /><Spinner /></div>

  const cur = info.group.currency
  const from = firstName(info.from.name)
  const to = firstName(info.to.name)
  const owed = info.owed
  const rails = ORDER.filter((a) => info.to.rails[a])
  const recentlyRejected = claim?.status === 'rejected'
  const shownAmount = waiting ? claim!.amount : confirmed && claim?.status === 'confirmed' ? claim.amount : quote?.amount ?? owed

  const METHODS: [ClaimMethod, string][] = [
    ['cash', T('Cash', 'Cash')],
    ['upi', 'UPI'],
    ['bank', T('Bank', 'Bank')],
    ['other', T('Other', 'Kuch aur')],
  ]

  return (
    <div className={`pay${confirmed ? ' pay--paid' : ''}`}>
      <PayHeader />
      <motion.h1 className="pay__h" initial={{ y: 20, opacity: 0, rotate: -2 }} animate={{ y: 0, opacity: 1, rotate: -1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
        {confirmed ? T(`${from}, legend.`, `${from}, tu legend hai.`) : waiting ? T(`Nice one, ${from}.`, `Badhiya ${from}.`) : T(`${from}, pay up.`, `${from}, bhai paise de.`)}
      </motion.h1>
      <div className="pay__payee">
        <Avatar name={info.to.name} src={info.to.avatar} size={44} />
        <p>
          {info.group.emoji} {info.group.name}
          <br />
          <b>{confirmed ? T(`paid to ${to}`, `${to} ko diye`) : T(`you owe ${to}`, `${to} ko dene hain`)}</b>
        </p>
      </div>

      <div className="pay__amtrow">
        <motion.div className="pay__amt stk stk--paper" initial={{ scale: 0.8, rotate: 4 }} animate={{ scale: 1, rotate: 1.5 }} transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.1 }}>
          <span className="pay__fiat">{money(shownAmount, cur)}</span>
          {quote && pick !== 'UPI' && !confirmed && <span className="pay__sats">≈ {formatBase(BigInt(quote.base), quote.asset, 6)}</span>}
          <AnimatePresence>
            {confirmed && (
              <motion.div className="stamp" initial={{ scale: 3, rotate: -40, opacity: 0 }} animate={{ scale: 1, rotate: -14, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
                {T('PAID', 'PAID')} ✓
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
        {!confirmed && !waiting && owed > 0 && (
          <motion.span className="pay__give" initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 8 }} transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.3 }}>
            <Emoji char="🫴" size={58} />
          </motion.span>
        )}
      </div>

      {confirmed ? (
        <>
          {quote?.status === 'paid' ? (
            <Receipt quote={quote} to={info.to.name} cluster={info.solana.cluster} />
          ) : (
            <motion.div className="receipt" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}>
              <p>{T(`${to} confirmed it arrived. You’re settled. 🤝`, `${to} ne confirm kiya. Hisaab clear. 🤝`)}</p>
              {claim?.ref && <p className="fine">UPI ref {claim.ref}</p>}
            </motion.div>
          )}
          <div className="pay__party">
            <Emoji char="🥳" size={110} />
          </div>
        </>
      ) : waiting ? (
        <motion.div className="pay__waiting stk stk--cash" initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
          <span className="pay__pulse" aria-hidden />
          <b>{T(`Waiting for ${to} to confirm`, `${to} ke confirm ka wait`)}</b>
          <p className="fine">{T(`${to} got a ping. This page updates by itself the moment they tap “Got it”.`, `${to} ko ping gaya. Jaise hi “Mil gaya” dabayega, ye page khud update hoga.`)}</p>
          <button type="button" className="linkish" onClick={() => takeBack(claim!)}>
            {T('I pressed that by mistake', 'Galti se daba diya')}
          </button>
        </motion.div>
      ) : owed <= 0 && !quote ? (
        <div className="pay__center">
          <Emoji char="🥳" size={96} />
          <h2>{T('Nothing owed right now', 'Abhi kuch nahi dena')}</h2>
          <p className="muted">{T(`You and ${to} are square.`, `Tu aur ${to} barabar ho.`)}</p>
        </div>
      ) : (
        <>
          {recentlyRejected && <p className="callout callout--owe">{T(`${to} says your last payment hasn’t arrived. Check your UPI app, then try again.`, `${to} bol raha hai pichla payment nahi aaya. UPI app check kar, phir try kar.`)}</p>}
          {rails.length > 1 && (
            <div className="rails" role="radiogroup" aria-label={T('Pay with', 'Kisse pay karega')}>
              {rails.map((a) => (
                <motion.button key={a} type="button" role="radio" aria-checked={pick === a} className={`rail rail--${rail[a].tone}${pick === a ? ' rail--on' : ''}`} whileTap={{ scale: 0.92, rotate: -2 }} onClick={() => choose(a)}>
                  <span className="rail__icon">{rail[a].icon}</span>
                  <b>{T(rail[a].en, rail[a].hi)}</b>
                  <small>{a === 'USDT' && info.solana.cluster !== 'mainnet-beta' ? 'devnet' : rail[a].sub}</small>
                </motion.button>
              ))}
            </div>
          )}
          {pick === 'UPI' && info.to.upi ? (
            <UpiPay payee={{ name: info.to.name, upi: info.to.upi }} amount={owed} currency={cur} note={info.group.name} busy={busy} onPaid={(a, ref) => sayPaid(a, 'upi', ref)} />
          ) : pick === 'USDT' || pick === 'SOL' ? (
            !quote || quote.asset !== pick ? (
              <div className="pay__start">
                <Press tone="ink" size="lg" block loading={busy} onClick={() => getQuote()}>
                  {rail[pick].icon} {T(`Pay with ${pick}`, `${pick} se pay kar`)}
                </Press>
                <p className="fine center">{T(`We lock the live rate for ${info.quoteSeconds} seconds. Pay from any Solana wallet or exchange.`, `Live rate ${info.quoteSeconds} second ke liye lock. Kisi bhi Solana wallet ya exchange se pay kar.`)}</p>
                <div className="pay__wallets">
                  <span className="fine">{T('Works with', 'Chalega')}:</span>
                  {SOL_WALLETS.map((w) => (
                    <span key={w} className="chip chip--tiny">
                      {w}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <SolanaCard quote={quote} busy={busy} cluster={info.solana.cluster} stableLabel={info.solana.stableLabel} onRefresh={() => getQuote()} onDemo={quote.canSimulate ? demoPay : undefined} />
            )
          ) : info.to.joined ? (
            <div className="stack pay__other">
              <p className="muted">
                {cur === 'INR'
                  ? T(`${to} hasn’t added a UPI ID yet. Pay them however you usually do, then tap below so they can confirm.`, `${to} ne abhi UPI ID nahi daali. Jaise usually dete ho waise de, phir neeche tap kar taaki woh confirm kare.`)
                  : T(`Pay ${to} however you usually do, then tap below so they can confirm.`, `${to} ko jaise usually dete ho waise de, phir neeche tap kar.`)}
              </p>
              <div className="chips">
                {METHODS.map(([k, label]) => (
                  <button key={k} type="button" className={`chip${method === k ? ' chip--on' : ''}`} onClick={() => (sfx.tap(), setMethod(k))}>
                    {label}
                  </button>
                ))}
              </div>
              <Press tone="get" size="lg" block loading={busy} onClick={() => sayPaid(owed, method, null)}>
                ✅ {T(`I’ve paid ${money(owed, cur)}`, `Maine ${money(owed, cur)} de diye`)}
              </Press>
            </div>
          ) : (
            <p className="callout">{T(`${to} isn’t on the app, so pay them directly and let the group know.`, `${to} app pe nahi hai, toh seedha de aur group ko bata de.`)}</p>
          )}
        </>
      )}
      <PayFooter />
    </div>
  )
}

function PayHeader() {
  return (
    <header className="pay__top">
      <span className="pay__brand">
        <LogoMark size={30} /> bhai paise de.
      </span>
      <span className="topbar__right">
        <ThemeToggle />
        <LangToggle />
      </span>
    </header>
  )
}

/** Every pay link is an invitation: the person paying today splits their own bills tomorrow. */
function PayFooter() {
  const { T } = useLang()
  const { user } = useSession()
  return (
    <footer className="pay__foot">
      {!user && (
        <Link to="/welcome" className="pay__cta stk">
          <span>
            <b>{T('Split your own bills, free', 'Apne bills bhi split kar, free')}</b>
            <small>{T('Groups, UPI paybacks, chat. Takes 10 seconds.', 'Groups, UPI se wapas, chat. 10 second lagte hain.')}</small>
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}
    </footer>
  )
}

/** The 90-second ring around a QR, shared by both rails. */
function useCountdown(quote: Quote) {
  const [now, setNow] = useState(Date.now())
  const lastTick = useRef(0)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      setNow(Date.now())
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])
  const total = quote.expiresAt - quote.createdAt
  const left = Math.max(0, quote.expiresAt - now)
  const secs = Math.ceil(left / 1000)
  const expired = left <= 0 || quote.status === 'expired'
  useEffect(() => {
    if (secs <= 10 && secs > 0 && secs !== lastTick.current) {
      lastTick.current = secs
      sfx.tick()
    }
  }, [secs])
  const frac = left / total
  return { frac, secs, expired, color: frac > 0.5 ? '#B8F25B' : frac > 0.2 ? '#FFC21A' : '#FF3D8B' }
}

function QrRing({ quote, text, href, label }: { quote: Quote; text: string; href: string; label: string }) {
  const { T } = useLang()
  const { frac, secs, expired, color } = useCountdown(quote)
  return (
    <motion.div className={`qrframe${secs <= 10 && !expired ? ' is-urgent' : ''}`} animate={expired ? { rotate: 0, scale: 0.97 } : { rotate: [0, -0.6, 0.6, 0] }} transition={expired ? {} : { repeat: Infinity, duration: 4 }}>
      <svg className="qrframe__ring" viewBox="0 0 300 300" aria-hidden>
        <rect x="6" y="6" width="288" height="288" rx="34" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="10" />
        <rect x="6" y="6" width="288" height="288" rx="34" fill="none" stroke={expired ? '#999' : color} strokeWidth="10" pathLength={1} strokeDasharray={`${frac} 1`} strokeLinecap="round" />
      </svg>
      <a href={href} className="qrframe__qr" aria-label={label}>
        <QR text={text} size={220} dim={expired && !quote.lateWatch} />
      </a>
      <span className="qrframe__timer">{expired ? T('expired', 'expire') : `${secs}s`}</span>
      {(!expired || quote.lateWatch) && (
        <span className="qrframe__watch">
          <i />
          {T('watching for payment', 'payment ka wait')}
        </span>
      )}
    </motion.div>
  )
}

function RateLine({ quote, unit }: { quote: Quote; unit: string }) {
  const { T } = useLang()
  return (
    <p className="fine center">
      1 {unit} = {money(Math.round(quote.rate * 10 ** CURRENCIES[quote.currency].decimals), quote.currency)} ·{' '}
      {quote.rateSource === 'live' ? T('live rate', 'live rate') : quote.rateSource === 'last-known' ? T('last known rate (CoinGecko is slow)', 'aakhri rate (CoinGecko slow hai)') : T('fallback rate (demo only)', 'fallback rate (sirf demo)')}
    </p>
  )
}

/** Solana Pay: one QR for wallets that scan, plus address + exact amount for exchanges. */
function SolanaCard({ quote, busy, cluster, stableLabel, onRefresh, onDemo }: { quote: Quote; busy: boolean; cluster: string; stableLabel: string; onRefresh: () => void; onDemo?: () => void }) {
  const { T, lang } = useLang()
  const toast = useToast()
  const { user, vault } = useSession()
  const { expired } = useCountdown(quote)
  const [paying, setPaying] = useState<string | null>(null)
  const base = BigInt(quote.base)
  const unit = quote.asset === 'USDT' ? 'USDT' : 'SOL'
  const decimal = toDecimal(base, quote.asset === 'USDT' ? 6 : ASSETS.SOL.decimals)

  const copy = async (text: string, what: string) => {
    await copyText(text)
    sfx.pop()
    toast(T(`${what} copied`, `${what} copy ho gaya`), { emoji: '📋', tone: 'get', silent: true })
  }

  // the payer has this app too: pay from the built-in wallet, reference and all, in one tap
  const payInApp = async () => {
    if (!vault) return
    try {
      setPaying(T('Checking balance…', 'Balance check…'))
      const plan = await planSend(vault.sol, quote.recipient!, quote.asset as 'SOL' | 'USDT', base, quote.paymentHash)
      const id = await requireUnlocked()
      setPaying(T('Signing…', 'Sign ho raha…'))
      sfx.send()
      await send(id, plan, () => setPaying(T('Sent. Waiting for the network…', 'Bhej diya. Network ka wait…')))
      setPaying(T('Confirmed. Waiting for the receipt…', 'Confirm. Receipt ka wait…'))
    } catch (e) {
      setPaying(null)
      toast(e instanceof WalletError || e instanceof Error ? e.message : errText(e, lang), { tone: 'owe' })
    }
  }

  if (quote.status === 'rejected')
    return (
      <div className="callout callout--owe">
        <b>{T('Payment not accepted', 'Payment accept nahi hua')}</b> {quote.note}
      </div>
    )

  return (
    <div className="invoice">
      <QrRing quote={quote} text={quote.invoice} href={quote.invoice} label={T('Open in wallet', 'Wallet mein khol')} />
      {expired && !quote.lateWatch ? (
        <Press tone="sats" size="lg" block loading={busy} onClick={onRefresh}>
          🔄 {T('Rate moved. Get a fresh quote', 'Rate badal gaya. Naya quote le')}
        </Press>
      ) : (
        <div className="invoice__acts">
          {expired && <p className="callout">{T('The 90 seconds ran out. Already sent it? We keep watching for a day; it counts at the rate when it lands.', '90 second khatam. Bhej diya? Hum ek din tak dekhte rahenge; jis rate pe pahunchega, utna count hoga.')}</p>}
          {!expired && (
            <a className="btn btn--ink btn--lg btn--block" href={quote.invoice} onClick={() => sfx.press()}>
              {quote.asset === 'USDT' ? '₮' : '◎'} {T('Open in wallet', 'Wallet mein khol')}
            </a>
          )}
          {user && vault && !expired && (
            <Press tone="sats" size="lg" block loading={!!paying} onClick={payInApp}>
              🔐 {T(`Pay ${decimal} ${unit} from my wallet`, `Mere wallet se ${decimal} ${unit} de`)}
            </Press>
          )}
          {paying && <p className="fine center">{paying}</p>}
          <details className="howto exch">
            <summary>{T('Paying from an exchange (Binance, CoinDCX…)?', 'Exchange se (Binance, CoinDCX…)?')}</summary>
            <p className="fine">{T(`Withdraw on the Solana network to this address, exactly this amount. We match it by the amount.`, `Solana network pe is address pe, bilkul itna withdraw kar. Hum amount se match karte hain.`)}</p>
            <button type="button" className="keybox mono" onClick={() => copy(quote.recipient!, T('Address', 'Address'))}>
              {quote.recipient}
            </button>
            <button type="button" className="keybox keybox--amt" onClick={() => copy(decimal, T('Amount', 'Amount'))}>
              <b>{decimal}</b> {quote.asset === 'USDT' ? stableLabel : 'SOL'} ⧉
            </button>
            <p className="fine">{T('Network: Solana (SPL). Not Ethereum, not Tron, not BSC.', 'Network: Solana (SPL). Ethereum, Tron, BSC nahi.')}</p>
          </details>
          {onDemo && !expired && (
            <Press tone="cash" block onClick={onDemo}>
              🧪 {T(`Simulate payment (${cluster})`, `Fake payment kar (${cluster})`)}
            </Press>
          )}
        </div>
      )}
      <RateLine quote={quote} unit={unit} />
    </div>
  )
}

function Receipt({ quote, to, cluster }: { quote: Quote; to: string; cluster: 'mainnet-beta' | 'devnet' | 'testnet' }) {
  const { T } = useLang()
  const [srvCluster, setSrvCluster] = useState(cluster)
  useEffect(() => {
    void serverInfo().then((s) => setSrvCluster(s.solana.cluster)).catch(() => {})
  }, [])
  return (
    <motion.div className="receipt" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.5 }}>
      <div className="receipt__row">
        <span>{T('Paid to', 'Kisko')}</span>
        <b>{to}</b>
      </div>
      <div className="receipt__row">
        <span>{T('Amount', 'Kitna')}</span>
        <b>{formatBase(BigInt(quote.base), quote.asset, 6)}</b>
      </div>
      <div className="receipt__row">
        <span>{T('Proof', 'Proof')}</span>
        {quote.txSig ? (
          <a className="mono" href={explorerTx(quote.txSig, srvCluster)} target="_blank" rel="noreferrer">
            {quote.txSig.slice(0, 10)}… ↗
          </a>
        ) : (
          <b className="mono">{(quote.txSig ?? quote.paymentHash).slice(0, 10)}…</b>
        )}
      </div>
      {quote.note && <p className="fine">{quote.note}</p>}
      <p className="fine">
        {quote.demo
          ? T('Test payment: no real money moved. The flow and checks are the real ones.', 'Test payment: asli paisa nahi gaya. Flow aur checks asli hain.')
          : T(`The Solana network confirmed the transfer to ${to}. Settled on proof, not on a promise.`, `Solana network ne ${to} ko transfer confirm kiya. Proof pe settle, vaade pe nahi.`)}
      </p>
    </motion.div>
  )
}
