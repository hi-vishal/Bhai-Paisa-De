import { motion } from 'framer-motion'
import { useState } from 'react'
import { formatMoney, parseMoney, type CurrencyCode } from '@shared/money'
import { cleanRef, upiUrl, type UpiApp } from '@shared/upi'
import { copyText, firstName, money } from '../lib/format'
import { useLang } from '../lib/i18n'
import { isIOS, isMobile } from '../lib/platform'
import { haptic, sfx } from '../lib/sound'
import { QR } from './bits'
import { Press } from './Press'
import { useToast } from './Toast'


const APPS: { app: UpiApp; name: string; tone: string }[] = [
  { app: 'gpay', name: 'GPay', tone: 'paper' },
  { app: 'phonepe', name: 'PhonePe', tone: 'lav' },
  { app: 'paytm', name: 'Paytm', tone: 'cash' },
]

type Props = {
  payee: { name: string; upi: string }
  amount: number
  currency: CurrencyCode
  note: string
  /** after paying: "I've paid" with the amount and an optional UPI reference */
  onPaid: (amount: number, ref: string | null) => Promise<void> | void
  busy?: boolean
}

/**
 * Open the UPI app with everything filled in. Android picks the app itself; iPhones need one
 * button per app. The QR and the copyable UPI ID cover laptops and apps that refuse links.
 */
export function UpiPay({ payee, amount, currency, note, onPaid, busy }: Props) {
  const { T } = useLang()
  const toast = useToast()
  const [opened, setOpened] = useState(false)
  const [ref, setRef] = useState('')
  const [partial, setPartial] = useState(false)
  const [amt, setAmt] = useState(formatMoney(amount, currency).replace(/[^\d.]/g, ''))
  const minor = partial ? parseMoney(amt, currency) : amount
  const valid = minor !== null && minor > 0 && minor <= amount
  const url = (app: UpiApp) => upiUrl({ pa: payee.upi, pn: payee.name, am: minor ?? amount, tn: note }, app)
  const ios = isIOS()
  const mobile = isMobile()
  const refOk = !ref.trim() || !!cleanRef(ref)

  const open = (app: UpiApp) => {
    sfx.zap()
    haptic([5, 20, 5])
    setOpened(true)
    window.location.href = url(app)
  }

  return (
    <div className="upipay">
      {mobile ? (
        ios ? (
          <div className="upipay__apps">
            {APPS.map((a) => (
              <Press key={a.app} tone={a.tone as 'paper'} onClick={() => open(a.app)}>
                {a.name}
              </Press>
            ))}
            <Press tone="sats" className="upipay__any" onClick={() => open('any')}>
              {T('Other UPI app', 'Koi aur UPI app')}
            </Press>
          </div>
        ) : (
          <Press tone="ink" size="lg" block disabled={!valid} onClick={() => open('any')}>
            {T(`Pay ${money(minor ?? amount, currency)} with UPI`, `UPI se ${money(minor ?? amount, currency)} de`)}
          </Press>
        )
      ) : (
        <div className="upipay__qr stk">
          <QR text={url('any')} size={180} />
          <p className="fine center">{T('Scan with any UPI app on your phone', 'Phone ke kisi bhi UPI app se scan kar')}</p>
        </div>
      )}

      <button
        type="button"
        className="upipay__id"
        onClick={async () => {
          await copyText(payee.upi)
          sfx.pop()
          toast(T('UPI ID copied', 'UPI ID copy ho gayi'), { emoji: '📋', tone: 'get', silent: true })
        }}
      >
        <span>
          <small>{T(`${firstName(payee.name)}’s UPI ID`, `${firstName(payee.name)} ki UPI ID`)}</small>
          <b className="mono">{payee.upi}</b>
        </span>
        <i aria-hidden>⧉</i>
      </button>

      {!partial ? (
        <button type="button" className="linkish center" onClick={() => setPartial(true)}>
          {T('Paying only part of it?', 'Thoda hi de raha hai?')}
        </button>
      ) : (
        <label className="upipay__partial">
          <span>{T('Amount', 'Kitna')}</span>
          <input className="field" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
        </label>
      )}

      <motion.div className={`upipay__done${opened ? ' is-hot' : ''}`} animate={opened ? { scale: [1, 1.03, 1] } : {}} transition={{ repeat: opened ? 2 : 0, duration: 0.5 }}>
        <label className="label" htmlFor="utr">
          {T('UPI reference (optional)', 'UPI reference (zaroori nahi)')}
        </label>
        <input
          id="utr"
          className={`field mono${refOk ? '' : ' field--bad'}`}
          inputMode="numeric"
          maxLength={16}
          placeholder={T('12 digits from the receipt', 'Receipt ke 12 digits')}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
        <Press tone="get" size="lg" block loading={busy} disabled={!valid || !refOk} onClick={() => onPaid(minor!, cleanRef(ref))}>
          ✅ {T(`I’ve paid ${money(minor ?? amount, currency)}`, `Maine ${money(minor ?? amount, currency)} de diye`)}
        </Press>
        <p className="fine center">{T(`${firstName(payee.name)} gets a ping to confirm it arrived. Then it’s settled.`, `${firstName(payee.name)} ko confirm karne ka ping jaayega. Phir settle.`)}</p>
      </motion.div>
    </div>
  )
}
