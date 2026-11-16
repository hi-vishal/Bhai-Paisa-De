import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { formatMoney, parseMoney } from '@shared/money'
import { api } from '../lib/api'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { GroupFull } from '../lib/types'
import { manualBody } from '../lib/writes'
import { Avatar } from './Avatar'
import { Emoji } from './bits'
import { PaySheet } from './PaySheet'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

/**
 * The group kitty: a pot one person holds for everyone (trip fund, flat rent pool).
 * Money in counts as a payment to the holder; bills paid from it count as the holder paying.
 * So balances stay right on their own, and whatever's left is owed back to whoever put it in.
 */
export function KittyCard({ g, onChange }: { g: GroupFull; onChange: (g: GroupFull) => void }) {
  const { T } = useLang()
  const [chip, setChip] = useState(false)
  const [record, setRecord] = useState(false)
  const [setup, setSetup] = useState(false)
  const k = g.group.kitty!
  const cur = g.group.currency
  const holder = g.members.find((m) => m.id === k.holder)!
  const iHold = holder.isMe
  const canEdit = iHold || g.members.find((m) => m.isMe)?.isCreator
  const pct = k.target ? Math.min(100, Math.round((k.collected / k.target) * 100)) : null
  const top = Object.entries(k.byMember).sort((a, b) => b[1] - a[1])

  return (
    <motion.section className="kitty stk stk--sats" initial={{ rotate: 1.5, y: 8, opacity: 0 }} animate={{ rotate: -0.6, y: 0, opacity: 1 }}>
      <div className="kitty__head">
        <Emoji char="🏦" size={46} />
        <div>
          <small>{T('Group kitty', 'Group kitty')}</small>
          <b>
            {money(k.left, cur)} <span>{T('left', 'bacha')}</span>
          </b>
        </div>
        {canEdit && (
          <button type="button" className="kitty__edit" onClick={() => (sfx.tap(), setSetup(true))} aria-label={T('Kitty settings', 'Kitty settings')}>
            ⋯
          </button>
        )}
      </div>
      {pct !== null && (
        <div className="kitty__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          <span>
            {money(k.collected, cur)} / {money(k.target!, cur)}
          </span>
        </div>
      )}
      <p className="kitty__line">
        {T(`${iHold ? 'You hold' : `${firstName(holder.name)} holds`} it. In: ${money(k.collected, cur)} · Spent: ${money(k.spent, cur)}`, `${iHold ? 'Tere paas' : `${firstName(holder.name)} ke paas`}. Aaya: ${money(k.collected, cur)} · Kharcha: ${money(k.spent, cur)}`)}
      </p>
      {top.length > 0 && (
        <div className="kitty__who">
          {top.map(([id, amt]) => {
            const m = g.members.find((x) => x.id === id)
            return m ? (
              <span key={id}>
                <Avatar name={m.name} src={m.avatar} size={22} /> {money(amt, cur)}
              </span>
            ) : null
          })}
        </div>
      )}
      <div className="share-row">
        {iHold ? (
          <Press tone="ink" size="sm" onClick={() => setRecord(true)}>
            ＋ {T('Money came in', 'Paise aaye')}
          </Press>
        ) : (
          <Press tone="ink" size="sm" onClick={() => setChip(true)}>
            💰 {T('Chip in', 'Daal')}
          </Press>
        )}
      </div>
      <p className="fine">{T('Pay bills from it with “Paid from kitty” when you add an expense. What’s left goes back through Balances.', 'Kharcha daalte waqt “Kitty se” chun. Bacha hua Balances mein wapas jaata hai.')}</p>

      {chip && (
        <PaySheet
          open
          kitty
          onClose={() => setChip(false)}
          groupId={g.group.id}
          meId={g.me!}
          groupName={g.group.name}
          currency={cur}
          to={{ id: holder.id, name: holder.name, avatar: holder.avatar, upi: holder.upi, sol: false, joined: holder.joined }}
          amount={k.target && g.members.length ? Math.max(100, Math.ceil(Math.max(0, k.target - k.collected) / g.members.length / 100) * 100) : 100000}
          onDone={onChange}
        />
      )}
      <RecordSheet open={record} onClose={() => setRecord(false)} g={g} onChange={onChange} />
      <KittySetup open={setup} onClose={() => setSetup(false)} g={g} onChange={onChange} />
    </motion.section>
  )
}

/** The holder says money came in (cash handed over, their own share, a UPI they saw land). */
function RecordSheet({ open, onClose, g, onChange }: { open: boolean; onClose: () => void; g: GroupFull; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [from, setFrom] = useState(g.me!)
  const [amt, setAmt] = useState('')
  const [busy, setBusy] = useState(false)
  const minor = parseMoney(amt, g.group.currency)

  const save = async () => {
    if (!minor) return
    setBusy(true)
    try {
      const body = await manualBody(user!, g.group.id, g.me!, { from, to: g.me!, amount: minor, method: 'kitty' })
      onChange(await api<GroupFull>(`/groups/${g.group.id}/settlements`, { body }))
      sfx.chaching()
      toast(T(`${money(minor, g.group.currency)} in the kitty`, `Kitty mein ${money(minor, g.group.currency)}`), { tone: 'get', emoji: '🏦', silent: true })
      setAmt('')
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={T('Money into the kitty', 'Kitty mein paise')}>
      <label className="label">{T('From', 'Kisse')}</label>
      <div className="chips">
        {g.members.map((m) => (
          <button key={m.id} type="button" className={`chip chip--person${from === m.id ? ' chip--on' : ''}`} onClick={() => (sfx.tap(), setFrom(m.id))}>
            <Avatar name={m.name} src={m.avatar} size={22} ghost={!m.joined} /> {m.isMe ? T('Me', 'Main') : firstName(m.name)}
          </button>
        ))}
      </div>
      <label className="label" htmlFor="kamt">
        {T('How much', 'Kitna')}
      </label>
      <input id="kamt" className="field field--big" inputMode="decimal" value={amt} placeholder="0" onChange={(e) => setAmt(e.target.value)} />
      <Press tone="ink" size="lg" block loading={busy} disabled={!minor} onClick={save}>
        {T('Add to kitty', 'Kitty mein daal')}
      </Press>
    </Sheet>
  )
}

/** Start the kitty, change who holds it or the goal, or close it. */
export function KittySetup({ open, onClose, g, onChange }: { open: boolean; onClose: () => void; g: GroupFull; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const toast = useToast()
  const k = g.group.kitty
  const joined = g.members.filter((m) => m.joined)
  const [holder, setHolder] = useState(k?.holder ?? g.me!)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setHolder(k?.holder ?? g.me!)
    setTarget(k?.target ? formatMoney(k.target, g.group.currency).replace(/[^\d.]/g, '') : '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const minor = target.trim() ? parseMoney(target, g.group.currency) : null

  const save = async (off = false) => {
    setBusy(true)
    try {
      onChange(await api<GroupFull>(`/groups/${g.group.id}/kitty`, { method: 'PATCH', body: off ? { holder: null } : { holder, target: minor } }))
      sfx.success()
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={k ? T('Kitty settings', 'Kitty settings') : T('Start a group kitty', 'Group kitty shuru kar')}>
      {!k && <p className="muted">{T('One person holds the money. Everyone chips in, bills get paid from it, and the app keeps count of whose money is whose.', 'Ek banda paise rakhta hai. Sab daalte hain, bills usse jaate hain, aur app hisaab rakhta hai kiska kitna.')}</p>}
      <label className="label">{T('Who holds it?', 'Kiske paas rahegi?')}</label>
      <div className="chips">
        {joined.map((m) => (
          <button key={m.id} type="button" className={`chip chip--person${holder === m.id ? ' chip--on' : ''}`} onClick={() => (sfx.tap(), setHolder(m.id))}>
            <Avatar name={m.name} src={m.avatar} size={22} /> {m.isMe ? T('Me', 'Main') : firstName(m.name)}
          </button>
        ))}
      </div>
      <label className="label" htmlFor="ktarget">
        {T('Goal (optional)', 'Goal (zaroori nahi)')}
      </label>
      <input id="ktarget" className="field" inputMode="decimal" placeholder={T('e.g. 20000', 'jaise 20000')} value={target} onChange={(e) => setTarget(e.target.value)} />
      <Press tone="sats" size="lg" block loading={busy} disabled={!!target.trim() && !minor} onClick={() => save()}>
        {k ? T('Save', 'Save') : T('Start the kitty', 'Kitty shuru kar')} 🏦
      </Press>
      {k && (
        <button type="button" className="linkish danger center" onClick={() => save(true)}>
          {T('Close the kitty', 'Kitty band kar')}
        </button>
      )}
    </Sheet>
  )
}
