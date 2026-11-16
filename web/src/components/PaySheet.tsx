import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ClaimMethod } from '@shared/claims'
import { formatMoney, parseMoney, type CurrencyCode } from '@shared/money'
import { api } from '../lib/api'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import type { GroupFull } from '../lib/types'
import { Avatar } from './Avatar'
import { blast } from './bits'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'
import { UpiPay } from './UpiPay'

type Person = { id: string; name: string; avatar: string | null; upi: string | null; sol: boolean; joined: boolean }

type Props = {
  open: boolean
  onClose: () => void
  groupId: string
  meId: string
  groupName: string
  currency: CurrencyCode
  to: Person
  amount: number
  /** "kitty": chipping in to whoever holds the kitty, any amount */
  kitty?: boolean
  onDone: (g: GroupFull) => void
}

/** You owe someone: pay them by UPI (or however), then tell them, and they confirm. */
export function PaySheet({ open, onClose, groupId, meId, groupName, currency, to, amount, kitty, onDone }: Props) {
  const { T, lang } = useLang()
  const toast = useToast()
  const nav = useNavigate()
  const [busy, setBusy] = useState(false)
  const [method, setMethod] = useState<ClaimMethod>('cash')
  // chipping in to the kitty is any amount; paying a debt is what's owed
  const [typed, setTyped] = useState(formatMoney(amount, currency).replace(/[^\d.]/g, ''))
  const amt = kitty ? parseMoney(typed, currency) ?? 0 : amount
  const upi = to.upi && currency === 'INR' ? to.upi : null

  const claim = async (amt: number, how: ClaimMethod, ref: string | null) => {
    setBusy(true)
    try {
      const g = await api<GroupFull>(`/groups/${groupId}/claims`, { body: { to: to.id, amount: amt, method: kitty ? 'kitty' : how, ref } })
      sfx.stamp()
      haptic([10, 40, 10])
      blast('money')
      toast(T(`Sent to ${firstName(to.name)} to confirm`, `${firstName(to.name)} ko confirm karne bheja`), { tone: 'get', emoji: '📨', silent: true })
      onDone(g)
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const payByLink = async () => {
    try {
      const r = await api<{ path: string }>(`/groups/${groupId}/paylinks`, { body: { from: meId, to: to.id } })
      onClose()
      nav(r.path)
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const METHODS: [ClaimMethod, string][] = [
    ['cash', T('Cash', 'Cash')],
    ['upi', 'UPI'],
    ['bank', T('Bank', 'Bank')],
    ['other', T('Other', 'Kuch aur')],
  ]

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={kitty ? T('Chip in to the kitty', 'Kitty mein daal') : T(`Pay ${firstName(to.name)}`, `${firstName(to.name)} ko de`)}>
      <div className="paysheet__who">
        <Avatar name={to.name} src={to.avatar} size={52} />
        <div>
          {kitty ? (
            <input className="field field--big paysheet__amt" inputMode="decimal" value={typed} aria-label={T('Amount', 'Kitna')} onChange={(e) => setTyped(e.target.value)} />
          ) : (
            <b>{money(amount, currency)}</b>
          )}
          <small>
            {kitty ? T(`${firstName(to.name)} holds the kitty for ${groupName}`, `${groupName} ki kitty ${firstName(to.name)} ke paas hai`) : T(`to ${to.name} · ${groupName}`, `${to.name} ko · ${groupName}`)}
          </small>
        </div>
      </div>

      {!to.joined ? (
        <p className="callout">{T(`${firstName(to.name)} isn’t on the app yet. Pay them, then mark it paid yourself from the group.`, `${firstName(to.name)} app pe nahi hai. Paise de ke group se khud paid mark kar.`)}</p>
      ) : upi ? (
        amt > 0 && <UpiPay key={amt} payee={{ name: to.name, upi }} amount={amt} currency={currency} note={kitty ? `Kitty: ${groupName}` : groupName} busy={busy} onPaid={(a, ref) => claim(a, 'upi', ref)} />
      ) : (
        <div className="stack">
          <p className="muted">
            {currency !== 'INR'
              ? T('Pay them the way you usually do, then tell them here.', 'Jaise usually dete ho waise de, phir yahan bata.')
              : T(`${firstName(to.name)} hasn’t added a UPI ID. Pay them however you like, then tell them here.`, `${firstName(to.name)} ne UPI ID nahi daali. Jaise chahe de, phir yahan bata.`)}
          </p>
          <div className="chips">
            {METHODS.map(([k, label]) => (
              <button key={k} type="button" className={`chip${method === k ? ' chip--on' : ''}`} onClick={() => (sfx.tap(), setMethod(k))}>
                {label}
              </button>
            ))}
          </div>
          <Press tone="get" size="lg" block loading={busy} disabled={amt <= 0} onClick={() => claim(amt, method, null)}>
            ✅ {T(`I’ve paid ${money(amt, currency)}`, `Maine ${money(amt, currency)} de diye`)}
          </Press>
        </div>
      )}

      {to.sol && !kitty && (
        <button type="button" className="linkish center" onClick={payByLink}>
          {T('Pay with USDT or SOL instead', 'USDT ya SOL se de')}
        </button>
      )}
    </Sheet>
  )
}
