import { useEffect, useState } from 'react'
import { formatMoney, parseMoney, type CurrencyCode } from '@shared/money'
import { api } from '../lib/api'
import { useSession } from '../lib/session'
import { manualBody } from '../lib/writes'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { sfx } from '../lib/sound'
import type { GroupFull } from '../lib/types'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

type How = { key: string; method: 'upi' | 'manual'; en: string; hi: string }
const HOW: How[] = [
  { key: 'upi', method: 'upi', en: 'UPI', hi: 'UPI' },
  { key: 'cash', method: 'manual', en: 'Cash', hi: 'Cash' },
  { key: 'bank', method: 'manual', en: 'Bank transfer', hi: 'Bank transfer' },
  { key: 'treat', method: 'manual', en: 'Bought them dinner', hi: 'Khaana khila ke' },
]

type Props = {
  open: boolean
  onClose: () => void
  groupId: string
  currency: CurrencyCode
  from: { id: string; name: string; isMe: boolean }
  to: { id: string; name: string; isMe: boolean }
  max: number
  onDone: (g: GroupFull) => void
}

/** "Got it by UPI", "cash at the airport": the payee's word. (Or the payer's, when the payee never joined.) */
export function ManualSheet({ open, onClose, groupId, currency, from, to, max, onDone }: Props) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [amt, setAmt] = useState('')
  const [how, setHow] = useState<How>(HOW[0])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setAmt(formatMoney(max, currency).replace(/[^\d.]/g, ''))
      setHow(currency === 'INR' ? HOW[0] : HOW[1])
      setNote('')
    }
  }, [open, max, currency])

  const minor = parseMoney(amt, currency)
  const valid = minor !== null && minor > 0 && minor <= max

  const save = async () => {
    if (!valid) return
    setBusy(true)
    try {
      const meId = to.isMe ? to.id : from.id
      const text = how.method === 'upi' ? note.trim() || undefined : note.trim() || T(how.en, how.hi)
      const g = await api<GroupFull>(`/groups/${groupId}/settlements`, { body: await manualBody(user!, groupId, meId, { from: from.id, to: to.id, amount: minor!, note: text, method: how.method }) })
      sfx.stamp()
      setTimeout(() => sfx.chaching(), 180)
      toast(T(`Recorded: ${firstName(from.name)} paid ${money(minor!, currency)}`, `Likh diya: ${firstName(from.name)} ne ${money(minor!, currency)} diye`), { tone: 'cash', emoji: '✋', silent: true })
      onDone(g)
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const who = to.isMe ? T('You’re confirming you got it.', 'Tu confirm kar raha hai ki paise mil gaye.') : T(`${firstName(to.name)} never joined, so you can record paying them.`, `${firstName(to.name)} ne join nahi kiya, toh tu khud record kar sakta hai.`)

  return (
    <Sheet open={open} onClose={onClose} title={T('Mark as settled', 'Settle mark kar')} tone="cash">
      <p className="manual__who">
        <b>{from.isMe ? T('You', 'Tune') : firstName(from.name)}</b> → <b>{to.isMe ? T('you', 'tujhe') : firstName(to.name)}</b>
      </p>
      <label className="label" htmlFor="mamt">
        {T('How much', 'Kitna')} <small className="muted">({T('up to', 'max')} {money(max, currency)})</small>
      </label>
      <input id="mamt" className="field field--big" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} />
      <label className="label" htmlFor="mnote">
        {T('How?', 'Kaise?')}
      </label>
      <div className="chips">
        {HOW.map((h) => (
          <button
            key={h.key}
            type="button"
            className={`chip${h.key === how.key ? ' chip--on' : ''}`}
            onClick={() => {
              sfx.tap()
              setHow(h)
            }}
          >
            {T(h.en, h.hi)}
          </button>
        ))}
      </div>
      <input id="mnote" className="field hand" maxLength={60} value={note} placeholder={T('Note (optional)', 'Note (zaroori nahi)')} onChange={(e) => setNote(e.target.value)} />
      <div className="callout">✋ {who}</div>
      <Press tone="ink" size="lg" block loading={busy} disabled={!valid} onClick={save}>
        {T('Record it', 'Record kar')}
      </Press>
    </Sheet>
  )
}
