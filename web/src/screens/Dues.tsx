import { motion } from 'framer-motion'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CurrencyCode } from '@shared/money'
import { Avatar } from '../components/Avatar'
import { ClaimCard } from '../components/ClaimCard'
import { Empty, Spinner } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { ManualSheet } from '../components/ManualSheet'
import { Odometer } from '../components/Odometer'
import { PaySheet } from '../components/PaySheet'
import { Press } from '../components/Press'
import { RoastSheet } from '../components/RoastSheet'
import { useToast } from '../components/Toast'
import { api, ApiError } from '../lib/api'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import type { Claim, GroupFull } from '../lib/types'
import { setCached, useResource } from '../lib/useResource'

type Person = { id: string; name: string; joined: boolean; isMe: boolean; avatar: string | null; upi: string | null; sol: boolean }
type Due = {
  groupId: string
  groupName: string
  emoji: string
  currency: CurrencyCode
  me: string
  transfers: { from: Person; to: Person; amount: number }[]
  claims: (Omit<Claim, 'from' | 'to'> & { from: Person; to: Person })[]
}
type Row = Due['transfers'][number] & { g: Due }

/** Everything you're owed and everything you owe, across all groups, with the button to fix it. */
export function Dues() {
  const { T, lang } = useLang()
  const nav = useNavigate()
  const toast = useToast()
  const { data, reload } = useResource('dues', () => api<{ groups: Due[] }>('/dues'))
  const [roast, setRoast] = useState<Row | null>(null)
  const [manual, setManual] = useState<Row | null>(null)
  const [paying, setPaying] = useState<Row | null>(null)
  const [nudging, setNudging] = useState<string | null>(null)

  if (!data) return <div className="screen"><TopBar title={T('Dues', 'Hisaab')} /><Spinner /></div>

  const rows: Row[] = data.groups.flatMap((g) => g.transfers.map((t) => ({ ...t, g })))
  const incoming = rows.filter((r) => r.to.isMe).sort((a, b) => b.amount - a.amount)
  const outgoing = rows.filter((r) => r.from.isMe).sort((a, b) => b.amount - a.amount)
  const toConfirm = data.groups.flatMap((g) => g.claims.filter((c) => c.to.id === g.me).map((c) => ({ c, g })))
  const sumBy = (rs: Row[]) => {
    const m = new Map<CurrencyCode, number>()
    for (const r of rs) m.set(r.g.currency, (m.get(r.g.currency) ?? 0) + r.amount)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const inSum = sumBy(incoming)
  const outSum = sumBy(outgoing)
  const waiting = (r: Row) => r.g.claims.filter((c) => c.from.id === r.from.id && c.to.id === r.to.id && c.method !== 'kitty').reduce((a, c) => a + c.amount, 0)

  const changed = (g: GroupFull) => {
    setCached(`group:${g.group.id}`, g)
    void reload()
  }

  const nudge = async (r: Row) => {
    const key = `${r.g.groupId}${r.from.id}`
    setNudging(key)
    try {
      await api(`/groups/${r.g.groupId}/nudge`, { body: { to: r.from.id } })
      sfx.zap()
      haptic([8, 30, 8])
      toast(T(`Nudged ${firstName(r.from.name)} 🔔`, `${firstName(r.from.name)} ko yaad dilaya 🔔`), { tone: 'get', silent: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_joined') setRoast(r)
      else toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setNudging(null)
    }
  }

  const card = (r: Row, i: number) => {
    const other = r.to.isMe ? r.from : r.to
    const key = `${r.g.groupId}${r.from.id}${r.to.id}`
    const wait = waiting(r)
    return (
      <motion.li
        key={key}
        className={`due stk stk--${r.to.isMe ? 'get' : 'owe'}`}
        initial={{ opacity: 0, y: 16, rotate: i % 2 ? 1.2 : -1.2 }}
        animate={{ opacity: 1, y: 0, rotate: i % 2 ? 0.5 : -0.5, transition: { delay: Math.min(i, 8) * 0.05 } }}
      >
        <div className="due__top">
          <Avatar name={other.name} src={other.avatar} size={44} ghost={!other.joined} />
          <div className="due__who">
            <b>{firstName(other.name)}</b>
            <button className="due__group" onClick={() => (sfx.tap(), nav(`/g/${r.g.groupId}`))}>
              {r.g.emoji} {r.g.groupName}
            </button>
            {wait > 0 && <small className="xfer__wait">{T(`${money(wait, r.g.currency)} waiting to be confirmed`, `${money(wait, r.g.currency)} confirm hona baaki`)}</small>}
          </div>
          <b className="due__amt">{money(r.amount, r.g.currency)}</b>
        </div>
        <div className="xfer__acts">
          {r.to.isMe ? (
            <>
              {r.from.joined && (
                <Press tone="sats" size="sm" loading={nudging === `${r.g.groupId}${r.from.id}`} onClick={() => nudge(r)}>
                  🔔 {T('Nudge', 'Yaad dila')}
                </Press>
              )}
              <Press tone={r.from.joined ? 'paper' : 'sats'} size="sm" onClick={() => setRoast(r)}>
                🌶️ {T('Send pay link', 'Pay link bhej')}
              </Press>
              <Press tone="paper" size="sm" onClick={() => setManual(r)}>
                ✋ {T('Got it', 'Mil gaya')}
              </Press>
            </>
          ) : r.to.joined ? (
            <Press tone="ink" size="sm" disabled={r.amount - wait <= 0} onClick={() => setPaying(r)}>
              💸 {T(`Pay ${money(r.amount - wait, r.g.currency)}`, `${money(r.amount - wait, r.g.currency)} de`)}
            </Press>
          ) : (
            <Press tone="paper" size="sm" onClick={() => setManual(r)}>
              ✋ {T('I paid them', 'Maine de diya')}
            </Press>
          )}
        </div>
      </motion.li>
    )
  }

  return (
    <div className="screen">
      <TopBar title={T('Dues', 'Hisaab')} />

      <div className="dues-sum">
        <motion.div className={`stk stk--${incoming.length ? 'get' : 'paper'}`} initial={{ rotate: -4, y: 10 }} animate={{ rotate: -2, y: 0 }}>
          <small>{T('Owed to you', 'Milne hain')}</small>
          <Odometer value={money(inSum[0]?.[1] ?? 0, inSum[0]?.[0] ?? 'INR')} className="dues-sum__amt" />
          <small>
            {incoming.length} {T(incoming.length === 1 ? 'person' : 'people', 'log')}
          </small>
        </motion.div>
        <motion.div className={`stk stk--${outgoing.length ? 'owe' : 'paper'}`} initial={{ rotate: 4, y: 10 }} animate={{ rotate: 2, y: 0 }}>
          <small>{T('You owe', 'Dene hain')}</small>
          <Odometer value={money(outSum[0]?.[1] ?? 0, outSum[0]?.[0] ?? 'INR')} className="dues-sum__amt" />
          <small>
            {outgoing.length} {T(outgoing.length === 1 ? 'person' : 'people', 'log')}
          </small>
        </motion.div>
      </div>

      {toConfirm.length > 0 && (
        <>
          <h3 className="day__label">{T('Did it arrive?', 'Paise aaye?')}</h3>
          {toConfirm.map(({ c, g }) => (
            <ClaimCard key={c.id} claim={{ ...c, from: c.from.id, to: c.to.id }} from={c.from} to={c.to} groupId={g.groupId} meId={g.me} currency={g.currency} onChange={changed} />
          ))}
        </>
      )}

      {!rows.length && !toConfirm.length && <Empty emoji="🧘" title={T('All square', 'Sab barabar')} body={T('Nobody owes you, you owe nobody. Inner peace unlocked.', 'Na koi tera dendaar, na tu kisi ka. Inner peace unlocked.')} />}

      {incoming.length > 0 && <h3 className="day__label">{T('Coming to you', 'Tujhe milne hain')}</h3>}
      <ul className="xfers">{incoming.map(card)}</ul>
      {outgoing.length > 0 && <h3 className="day__label">{T('You owe', 'Tujhe dene hain')}</h3>}
      <ul className="xfers">{outgoing.map(card)}</ul>

      {roast && <RoastSheet open onClose={() => setRoast(null)} groupId={roast.g.groupId} groupName={roast.g.groupName} currency={roast.g.currency} from={roast.from} to={roast.to} amount={roast.amount} />}
      {manual && <ManualSheet open onClose={() => setManual(null)} groupId={manual.g.groupId} currency={manual.g.currency} from={manual.from} to={manual.to} max={manual.amount} onDone={changed} />}
      {paying && (
        <PaySheet
          open
          onClose={() => setPaying(null)}
          groupId={paying.g.groupId}
          meId={paying.g.me}
          groupName={paying.g.groupName}
          currency={paying.g.currency}
          to={paying.to}
          amount={paying.amount - waiting(paying)}
          onDone={changed}
        />
      )}
    </div>
  )
}
