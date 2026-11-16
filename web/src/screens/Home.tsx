import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { CurrencyCode } from '@shared/money'
import type { SplitInput } from '@shared/split'
import { Avatar, AvatarStack } from '../components/Avatar'
import { blast, Emoji, Spinner } from '../components/bits'
import { HelpButton, InstallNudge, TopBar } from '../components/Chrome'
import { Odometer } from '../components/Odometer'
import { PhotoSheet } from '../components/PhotoSheet'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { ago, firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { GroupFull, GroupSummary, Invite, Recurring } from '../lib/types'
import { setCached, useResource } from '../lib/useResource'
import { acceptBody, expenseBody } from '../lib/writes'

type HomeData = { groups: GroupSummary[]; invites: Invite[] }

const CHECK_KEY = 'bpd.start.hide'

export function Home({ onAdd }: { onAdd: () => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const { data, loading, reload } = useResource('groups', () => api<HomeData>('/groups'))
  const { data: rec, reload: reloadRec } = useResource('recurring', () => api<{ items: Recurring[] }>('/recurring'))
  const [busy, setBusy] = useState<string | null>(null)
  const [photo, setPhoto] = useState(false)
  const [hideStart, setHideStart] = useState(() => {
    try {
      return localStorage.getItem(CHECK_KEY) === '1'
    } catch {
      return false
    }
  })
  const groups = data?.groups ?? []
  const invites = data?.invites ?? []
  const due = rec?.items.filter((r) => r.due) ?? []

  const totals = new Map<CurrencyCode, number>()
  for (const g of groups) totals.set(g.currency, (totals.get(g.currency) ?? 0) + g.net)
  const ranked = [...totals.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const [cur, net] = ranked[0] ?? ['INR', 0]
  const mood = net > 0 ? 'get' : net < 0 ? 'owe' : 'lav'

  const steps = [
    { done: groups.length > 0, en: 'Make a group', hi: 'Group bana', go: () => nav('/g/new') },
    { done: groups.some((g) => g.members.length > 1), en: 'Add your people', hi: 'Apne log add kar', go: () => (groups[0] ? nav(`/g/${groups[0].id}?add=1`) : nav('/g/new')) },
    { done: groups.some((g) => g.expenseCount > 0), en: 'Add the first bill', hi: 'Pehla bill daal', go: () => (groups[0] ? nav(`/g/${groups[0].id}/add`) : nav('/g/new')) },
    { done: !!user?.upi, en: 'Add your UPI ID to get paid back', hi: 'Paise wapas lene ke liye UPI ID daal', go: () => nav('/me#upi') },
    { done: !!user?.avatar, en: 'Add a photo', hi: 'Photo laga', go: () => setPhoto(true) },
  ]
  const left = steps.filter((s) => !s.done).length
  const showStart = !!data && !hideStart && left > 0

  const accept = async (inv: Invite) => {
    setBusy(inv.memberId)
    try {
      await api(`/groups/${inv.groupId}/accept`, { body: await acceptBody(user!, inv.groupId, inv.memberId) })
      sfx.success()
      blast('party')
      nav(`/g/${inv.groupId}`)
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
      void reload()
    } finally {
      setBusy(null)
    }
  }

  const decline = async (inv: Invite) => {
    await api(`/groups/${inv.groupId}/decline`, { body: { memberId: inv.memberId } }).catch(() => {})
    sfx.unpop()
    void reload()
  }

  const addRecurring = async (r: Recurring) => {
    setBusy(r.id)
    try {
      const g = await api<GroupFull>(`/groups/${r.groupId}`)
      const t = r.template
      const body = await expenseBody(user!, g, { description: t.description, category: t.category, paidBy: t.paidBy, amount: (t.split as SplitInput).mode === 'itemized' ? undefined : t.amount, split: t.split as SplitInput, kitty: t.kitty })
      setCached(`group:${g.group.id}`, await api<GroupFull>(`/groups/${g.group.id}/expenses`, { body }))
      await api(`/recurring/${r.id}/next`, { body: {} })
      sfx.success()
      toast(T(`${t.description} added again`, `${t.description} phir se add`), { tone: 'get', emoji: '🔁', silent: true })
      void reloadRec()
      void reload()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  const skipRecurring = async (r: Recurring) => {
    await api(`/recurring/${r.id}/next`, { body: {} }).catch(() => {})
    sfx.unpop()
    void reloadRec()
  }

  return (
    <div className="screen">
      <TopBar
        title={
          <button type="button" className="hello" onClick={() => (sfx.tap(), nav('/me'))}>
            <Avatar name={user?.name ?? '?'} src={user?.avatar} size={38} />
            <span>
              {T('Hi', 'Yo')} {firstName(user?.name ?? '')} <span className="wave">👋</span>
            </span>
          </button>
        }
        right={<HelpButton />}
      />

      <motion.section
        className={`hero-net stk stk--${mood}`}
        initial={{ rotate: -3, y: 16, opacity: 0 }}
        animate={{ rotate: -1.2, y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <div className="hero-net__text">
          <span className="hero-net__label">
            {net > 0 ? T('All in, you get back', 'Total mein tujhe milne hain') : net < 0 ? T('All in, you owe', 'Total mein tujhe dene hain') : T('All square', 'Sab barabar')}
          </span>
          <span className="hero-net__amt">
            <Odometer value={money(Math.abs(net), cur)} />
          </span>
          <span className="hero-net__sub">
            {net > 0
              ? T('Go collect. Dues has the buttons.', 'Chal vasooli kar. Dues mein buttons hain.')
              : net < 0
                ? T('Pay up before it gets awkward.', 'Awkward hone se pehle de de.')
                : T('Peace. For now.', 'Shanti. Abhi ke liye.')}
          </span>
          {ranked.slice(1).map(([c, v]) => (
            <span key={c} className="hero-net__more">
              {money(v, c, true)}
            </span>
          ))}
        </div>
        <Emoji char={net > 0 ? '🤑' : net < 0 ? '😬' : '😌'} size={84} className="hero-net__emoji" />
      </motion.section>

      <AnimatePresence initial={false}>
        {invites.map((inv) => (
          <motion.div key={inv.memberId} className="invite-card stk stk--cash" layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}>
            <span className="invite-card__emoji">{inv.emoji}</span>
            <div>
              <b>{inv.by ? T(`${firstName(inv.by)} added you to ${inv.groupName}`, `${firstName(inv.by)} ne tujhe ${inv.groupName} mein add kiya`) : T(`You were added to ${inv.groupName}`, `Tujhe ${inv.groupName} mein add kiya`)}</b>
              <small>{T(`as “${inv.name}”`, `“${inv.name}” naam se`)}</small>
            </div>
            <div className="share-row">
              <Press tone="ink" size="sm" loading={busy === inv.memberId} onClick={() => accept(inv)}>
                {T('Join', 'Join kar')}
              </Press>
              <Press tone="paper" size="sm" onClick={() => decline(inv)}>
                {T('Not me', 'Main nahi')}
              </Press>
            </div>
          </motion.div>
        ))}
        {due.map((r) => (
          <motion.div key={r.id} className="due-card stk stk--sats" layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}>
            <span className="invite-card__emoji">🔁</span>
            <div>
              <b>{T(`${r.template.description} is due again`, `${r.template.description} phir se due hai`)}</b>
              <small>
                {money(r.template.amount, r.currency)} · {r.emoji} {r.groupName}
              </small>
            </div>
            <div className="share-row">
              <Press tone="ink" size="sm" loading={busy === r.id} onClick={() => addRecurring(r)}>
                {T('Add it', 'Add kar')}
              </Press>
              <Press tone="paper" size="sm" onClick={() => skipRecurring(r)}>
                {T('Skip', 'Skip')}
              </Press>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>

      {showStart && (
        <motion.section className="start stk" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="start__head">
            <b>{T('Getting started', 'Shuruaat')}</b>
            <span className="start__count">
              {steps.length - left}/{steps.length}
            </span>
            <button
              type="button"
              className="start__x"
              aria-label={T('Hide', 'Chhupa')}
              onClick={() => {
                sfx.unpop()
                setHideStart(true)
                try {
                  localStorage.setItem(CHECK_KEY, '1')
                } catch {
                  // ignore
                }
              }}
            >
              ✕
            </button>
          </div>
          <div className="start__bar">
            <motion.i animate={{ width: `${((steps.length - left) / steps.length) * 100}%` }} />
          </div>
          <ol className="start__list">
            {steps.map((s) => (
              <li key={s.en} className={s.done ? 'is-done' : ''}>
                <button type="button" disabled={s.done} onClick={() => (sfx.tap(), s.go())}>
                  <span className="start__tick">{s.done ? '✓' : ''}</span>
                  {T(s.en, s.hi)}
                  {!s.done && (
                    <span className="start__go" aria-hidden>
                      ›
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </motion.section>
      )}

      <InstallNudge />

      <div className="section-head">
        <h2>{T('Your groups', 'Tere groups')}</h2>
        {groups.length > 0 && (
          <Press tone="paper" size="sm" onClick={() => nav('/g/new')}>
            ＋ {T('New group', 'Naya group')}
          </Press>
        )}
      </div>

      {loading && !data && <Spinner />}
      {data && !groups.length && (
        <motion.div className="first stk stk--lav" initial={{ rotate: 2, opacity: 0 }} animate={{ rotate: -1, opacity: 1 }}>
          <Emoji char="🏖️" size={88} />
          <h3>{T('Make your first group', 'Pehla group bana')}</h3>
          <p>{T('A trip, the flat, office lunch. Name it, add your people, add bills. We do the maths.', 'Trip, flat, office lunch. Naam rakh, log add kar, bill daal. Hisaab hum karenge.')}</p>
          <Press tone="ink" size="lg" block onClick={() => nav('/g/new')}>
            {T('Make a group', 'Group bana')} →
          </Press>
          <button type="button" className="linkish center" onClick={() => nav('/help')}>
            {T('How does it work?', 'Ye kaam kaise karta hai?')}
          </button>
        </motion.div>
      )}

      <div className="groups">
        {groups.map((g, i) => {
          const tone = g.net > 0 ? 'get' : g.net < 0 ? 'owe' : 'paper'
          return (
            <motion.button
              key={g.id}
              className={`gcard stk stk--${tone}`}
              initial={{ opacity: 0, y: 20, rotate: 0 }}
              animate={{ opacity: 1, y: 0, rotate: i % 2 ? 0.8 : -0.8, transition: { delay: 0.05 * i, type: 'spring', stiffness: 300, damping: 22 } }}
              whileTap={{ x: 4, y: 4, boxShadow: '0 0 0 #000', rotate: 0 }}
              onClick={() => {
                sfx.tap()
                nav(`/g/${g.id}`)
              }}
            >
              <span className="gcard__emoji">
                {g.emoji}
                {(g.unread > 0 || g.toConfirm > 0) && <i className={`gcard__badge${g.toConfirm ? ' gcard__badge--act' : ''}`}>{g.toConfirm ? '!' : g.unread}</i>}
              </span>
              <span className="gcard__mid">
                <b>{g.name}</b>
                <span className="gcard__meta">
                  <AvatarStack names={g.members} size={22} />
                  <span>
                    {g.toConfirm
                      ? T(`${g.toConfirm} payment${g.toConfirm > 1 ? 's' : ''} to confirm`, `${g.toConfirm} payment confirm kar`)
                      : `${g.expenseCount} ${T(g.expenseCount === 1 ? 'bill' : 'bills', 'bill')} · ${ago(g.lastActivity, lang)}`}
                  </span>
                </span>
              </span>
              <span className="gcard__net">
                <small>{g.net > 0 ? T('you get', 'milenge') : g.net < 0 ? T('you owe', 'dene hain') : T('settled', 'clear')}</small>
                <b>{g.net === 0 ? '✓' : money(Math.abs(g.net), g.currency)}</b>
              </span>
            </motion.button>
          )
        })}
      </div>

      {groups.length > 0 && (
        <button className="add-row" onClick={onAdd}>
          ＋ {T('Add a bill', 'Bill daal')}
        </button>
      )}
      <PhotoSheet open={photo} onClose={() => setPhoto(false)} />
    </div>
  )
}
