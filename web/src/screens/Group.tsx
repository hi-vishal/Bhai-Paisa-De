import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { CATEGORIES, isCategory } from '@shared/categories'
import type { Transfer } from '@shared/balances'
import { formatBase } from '@shared/money'
import { AddPeopleSheet } from '../components/AddPeopleSheet'
import { Avatar, AvatarStack } from '../components/Avatar'
import { ClaimCard } from '../components/ClaimCard'
import { Emoji, Empty, Spinner, Switch } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { DebtGraph } from '../components/DebtGraph'
import { GroupChat } from '../components/GroupChat'
import { KittyCard, KittySetup } from '../components/Kitty'
import { ManualSheet } from '../components/ManualSheet'
import { Odometer } from '../components/Odometer'
import { PaySheet } from '../components/PaySheet'
import { Press } from '../components/Press'
import { RoastSheet } from '../components/RoastSheet'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { api, ApiError, authedImage, upload } from '../lib/api'
import { ago, dayLabel, firstName, methodIcon, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { shrink } from '../lib/image'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import type { Expense, GroupFull, Member, Settlement } from '../lib/types'
import { useResource } from '../lib/useResource'
import { voidBody } from '../lib/writes'

type Row = { kind: 'e'; at: number; e: Expense } | { kind: 's'; at: number; s: Settlement }
type Tab = 'list' | 'owes' | 'chat'

export function Group() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const nav = useNavigate()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const { data: g, error, mutate, reload } = useResource(`group:${id}`, () => api<GroupFull>(`/groups/${id}`))
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'chat' ? 'chat' : params.get('tab') === 'owes' ? 'owes' : 'list'))
  const [openExpense, setOpenExpense] = useState<Expense | null>(null)
  const [roast, setRoast] = useState<Transfer | null>(null)
  const [manual, setManual] = useState<Transfer | null>(null)
  const [paying, setPaying] = useState<Transfer | null>(null)
  const [adding, setAdding] = useState(() => params.get('add') === '1')
  const [kittySetup, setKittySetup] = useState(false)
  const [nudging, setNudging] = useState<string | null>(null)

  // deep links from pushes and the checklist: ?add=1, ?tab=chat, ?confirm=…
  useEffect(() => {
    if (params.get('add') || params.get('tab') || params.get('confirm')) setParams({}, { replace: true })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<Row[]>(() => {
    if (!g) return []
    return [...g.expenses.map((e) => ({ kind: 'e' as const, at: e.createdAt, e })), ...g.settlements.map((s) => ({ kind: 's' as const, at: s.createdAt, s }))].sort((a, b) => b.at - a.at)
  }, [g])

  if (error && !g) return <div className="screen"><TopBar back="/" title="…" /><Empty emoji="🙈" title={errText(error, lang)} /></div>
  if (!g) return <div className="screen"><TopBar back="/" title="…" /><Spinner /></div>

  const m = (mid: string) => g.members.find((x) => x.id === mid)!
  const meId = g.me!
  const myNet = g.balances.net[meId] ?? 0
  const cur = g.group.currency
  const mine = g.balances.plan.filter((t) => t.from === meId || t.to === meId)
  const others = g.balances.plan.filter((t) => t.from !== meId && t.to !== meId)
  const tone = myNet > 0 ? 'get' : myNet < 0 ? 'owe' : 'lav'
  const alone = g.members.length < 2
  const claimsForMe = g.claims.filter((c) => c.to === meId)
  const claimsByMe = g.claims.filter((c) => c.from === meId)
  const waitingOn = (t: Transfer) => g.claims.filter((c) => c.from === t.from && c.to === t.to && c.method !== 'kitty').reduce((a, c) => a + c.amount, 0)

  const toggleSimplify = async (v: boolean) => {
    mutate({ ...g, group: { ...g.group, simplify: v }, balances: { ...g.balances, plan: v ? g.balances.simplified : g.balances.pairwise } })
    try {
      mutate(await api<GroupFull>(`/groups/${g.group.id}`, { method: 'PATCH', body: { simplify: v } }))
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const nudge = async (t: Transfer) => {
    const who = m(t.from)
    if (!who.joined) return setRoast(t)
    setNudging(t.from)
    try {
      await api(`/groups/${g.group.id}/nudge`, { body: { to: t.from } })
      sfx.zap()
      haptic([8, 30, 8])
      toast(T(`Nudged ${firstName(who.name)} 🔔`, `${firstName(who.name)} ko yaad dilaya 🔔`), { tone: 'get', silent: true })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_joined') setRoast(t)
      else toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setNudging(null)
    }
  }

  const transferRow = (t: Transfer, i: number) => {
    const from = m(t.from)
    const to = m(t.to)
    const iAmOwed = t.to === meId
    const iOwe = t.from === meId
    const waiting = waitingOn(t)
    return (
      <motion.li
        key={`${t.from}>${t.to}`}
        layout
        className={`xfer stk${iAmOwed ? ' stk--get' : iOwe ? ' stk--owe' : ''}`}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0, transition: { delay: i * 0.04 } }}
        exit={{ opacity: 0, scale: 0.8 }}
      >
        <div className="xfer__who">
          <Avatar name={from.name} src={from.avatar} size={36} ghost={!from.joined} />
          <span className="xfer__arrow" aria-hidden>
            →
          </span>
          <Avatar name={to.name} src={to.avatar} size={36} ghost={!to.joined} />
          <span className="xfer__names">
            <b>{iOwe ? T('You', 'Tu') : firstName(from.name)}</b> {iOwe ? T('pay', '→') : T('pays', '→')} <b>{iAmOwed ? T('you', 'tujhe') : firstName(to.name)}</b>
            {waiting > 0 && <small className="xfer__wait">{T(`${money(waiting, cur)} waiting to be confirmed`, `${money(waiting, cur)} confirm hona baaki`)}</small>}
          </span>
          <b className="xfer__amt">{money(t.amount, cur)}</b>
        </div>
        <div className="xfer__acts">
          {iAmOwed && (
            <>
              {from.joined ? (
                <Press tone="sats" size="sm" loading={nudging === t.from} onClick={() => nudge(t)}>
                  🔔 {T('Nudge', 'Yaad dila')}
                </Press>
              ) : null}
              <Press tone={from.joined ? 'paper' : 'sats'} size="sm" onClick={() => setRoast(t)}>
                🌶️ {T('Send pay link', 'Pay link bhej')}
              </Press>
              <Press tone="paper" size="sm" onClick={() => setManual(t)}>
                ✋ {T('Got it', 'Mil gaya')}
              </Press>
            </>
          )}
          {iOwe &&
            (to.joined ? (
              <Press tone="ink" size="sm" onClick={() => setPaying(t)}>
                💸 {T(`Pay ${money(t.amount - waiting, cur)}`, `${money(t.amount - waiting, cur)} de`)}
              </Press>
            ) : (
              <Press tone="paper" size="sm" onClick={() => setManual(t)}>
                ✋ {T('I paid them', 'Maine de diya')}
              </Press>
            ))}
          {!iAmOwed && !iOwe && (
            <Press tone="paper" size="sm" onClick={() => setRoast(t)}>
              🔗 {T('Share pay link', 'Pay link share kar')}
            </Press>
          )}
        </div>
      </motion.li>
    )
  }

  const dayGroups: { label: string; rows: Row[] }[] = []
  for (const r of rows) {
    const label = dayLabel(r.at, lang)
    const last = dayGroups[dayGroups.length - 1]
    if (last?.label === label) last.rows.push(r)
    else dayGroups.push({ label, rows: [r] })
  }

  const TABS: [Tab, string][] = [
    ['list', T('Bills', 'Bills')],
    ['owes', T('Balances', 'Kaun kisko')],
    ['chat', T('Chat', 'Chat')],
  ]

  return (
    <div className={`screen${tab === 'chat' ? ' screen--chat' : ''}`}>
      <TopBar
        back="/"
        title={
          <>
            <span className="title-emoji">{g.group.emoji}</span> {g.group.name}
          </>
        }
        sub={
          <button type="button" className="topbar__people" onClick={() => (sfx.tap(), setAdding(true))}>
            <AvatarStack names={g.members} size={20} max={6} /> {g.members.length} {T('people', 'log')} · <b>＋ {T('Add', 'Add')}</b>
          </button>
        }
        right={
          <motion.button className="iconbtn" aria-label={T('Group settings', 'Group settings')} whileTap={{ rotate: 90, x: 2, y: 2 }} onClick={() => (sfx.tap(), nav(`/g/${g.group.id}/settings`))}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="2.6" />
              <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
          </motion.button>
        }
      />

      {tab !== 'chat' && (
        <>
          <AnimatePresence initial={false}>
            {claimsForMe.map((c) => (
              <ClaimCard key={c.id} claim={c} from={m(c.from)} to={m(c.to)} groupId={g.group.id} meId={meId} currency={cur} onChange={mutate} />
            ))}
          </AnimatePresence>

          {alone ? (
            <motion.section className="first stk stk--get" initial={{ rotate: 2, opacity: 0 }} animate={{ rotate: -1, opacity: 1 }}>
              <Emoji char="👯" size={80} />
              <h3>{T('Add your people', 'Apne log add kar')}</h3>
              <p>{T('Send the invite on WhatsApp, or just type their names. They don’t need the app to pay you.', 'WhatsApp pe invite bhej, ya bas naam likh. Paise dene ke liye unko app nahi chahiye.')}</p>
              <Press tone="ink" size="lg" block onClick={() => setAdding(true)}>
                ＋ {T('Add people', 'Log add kar')}
              </Press>
            </motion.section>
          ) : (
            <motion.section className={`mybal stk stk--${tone}`} initial={{ rotate: 2, scale: 0.96 }} animate={{ rotate: -0.8, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 16 }}>
              <div>
                <span className="mybal__label">{myNet > 0 ? T('You get back', 'Tujhe milne hain') : myNet < 0 ? T('You owe', 'Tujhe dene hain') : T('You’re square', 'Tera hisaab clear')}</span>
                <Odometer value={money(Math.abs(myNet), cur)} className="mybal__amt" />
                {claimsByMe.length > 0 && <small className="mybal__note">{T(`${claimsByMe.length} payment${claimsByMe.length > 1 ? 's' : ''} waiting to be confirmed`, `${claimsByMe.length} payment confirm hona baaki`)}</small>}
              </div>
              <div className="mybal__acts">
                <Press tone="ink" size="sm" onClick={() => (sfx.tap(), setTab('owes'))}>
                  {myNet < 0 ? T('Pay up', 'De de') : T('Settle up', 'Settle kar')}
                </Press>
                <Press tone="paper" size="sm" onClick={() => nav(`/g/${g.group.id}/wrapped`)}>
                  🎁 Wrapped
                </Press>
              </div>
            </motion.section>
          )}

          {g.group.kitty && <KittyCard g={g} onChange={mutate} />}
        </>
      )}

      <LayoutGroup>
        <div className="tabs tabs--3" role="tablist">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              className={`tabs__tab${tab === k ? ' is-on' : ''}`}
              onClick={() => {
                sfx.tap()
                setTab(k)
              }}
            >
              {tab === k && <motion.span layoutId="tabpill" className="tabs__pill" transition={{ type: 'spring', stiffness: 500, damping: 34 }} />}
              <span className="tabs__label">
                {label}
                {k === 'owes' && g.balances.plan.length > 0 && <i className="tabs__badge">{g.balances.plan.length}</i>}
              </span>
            </button>
          ))}
        </div>
      </LayoutGroup>

      <AnimatePresence mode="wait" initial={false}>
        {tab === 'list' ? (
          <motion.div key="list" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            {!rows.length && (
              <Empty
                emoji="🧾"
                title={T('No bills yet', 'Abhi koi bill nahi')}
                body={T('Add the first one. Dinner, cab, that one Zomato order nobody admits to.', 'Pehla bill daal. Dinner, cab, woh Zomato order jo koi maanta nahi.')}
                action={
                  <Press tone="sats" size="lg" onClick={() => nav(`/g/${g.group.id}/add`)}>
                    ＋ {T('Add a bill', 'Bill daal')}
                  </Press>
                }
              />
            )}
            {dayGroups.map((d) => (
              <section key={d.label} className="day">
                <h3 className="day__label">{d.label}</h3>
                <ul className="rows">
                  {d.rows.map((r) => (r.kind === 'e' ? <ExpenseRow key={r.e.id} e={r.e} g={g} onOpen={() => setOpenExpense(r.e)} /> : <SettlementRow key={r.s.id} s={r.s} g={g} />))}
                </ul>
              </section>
            ))}
            {g.counts && g.counts.expenses > g.expenses.length && <p className="fine center">{T('Showing the latest 500. Export CSV in settings for everything.', 'Latest 500 dikh rahe. Sab ke liye settings mein CSV export kar.')}</p>}
          </motion.div>
        ) : tab === 'owes' ? (
          <motion.div key="owes" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            {g.members.length > 1 && g.balances.plan.length > 0 && (
              <div className="graph-card stk">
                <DebtGraph members={g.members} plan={g.balances.plan} currency={cur} />
                <div className="simplify">
                  <div>
                    <b>{T('Simplify debts', 'Udhaar simplify kar')}</b>
                    <span>
                      {g.balances.pairwise.length} → {g.balances.simplified.length} {T('payments', 'payments')}
                    </span>
                  </div>
                  <Switch on={g.group.simplify} onChange={toggleSimplify} label={T('Simplify debts', 'Udhaar simplify kar')} />
                </div>
              </div>
            )}
            {!g.balances.plan.length ? (
              <Empty emoji="🥳" title={T('Everyone’s square', 'Sab ka hisaab clear')} body={T('Nobody owes anybody. Screenshot this, it won’t last.', 'Koi kisi ka dendaar nahi. Screenshot le le, zyada der nahi chalega.')} />
            ) : (
              <>
                {mine.length > 0 && <h3 className="day__label">{T('Yours', 'Tera')}</h3>}
                <ul className="xfers">
                  <AnimatePresence>{mine.map(transferRow)}</AnimatePresence>
                </ul>
                {others.length > 0 && <h3 className="day__label">{T('Everyone else', 'Baaki sab')}</h3>}
                <ul className="xfers">
                  <AnimatePresence>{others.map(transferRow)}</AnimatePresence>
                </ul>
              </>
            )}
            {claimsByMe.length > 0 && (
              <>
                <h3 className="day__label">{T('Waiting to be confirmed', 'Confirm hona baaki')}</h3>
                {claimsByMe.map((c) => (
                  <ClaimCard key={c.id} claim={c} from={m(c.from)} to={m(c.to)} groupId={g.group.id} meId={meId} currency={cur} onChange={mutate} />
                ))}
              </>
            )}
            {!g.group.kitty && g.members.filter((x) => x.joined).length > 0 && (
              <button type="button" className="add-row add-row--soft" onClick={() => (sfx.tap(), setKittySetup(true))}>
                🏦 {T('Start a group kitty (trip fund, rent pool)', 'Group kitty shuru kar (trip fund, rent pool)')}
              </button>
            )}
          </motion.div>
        ) : (
          <motion.div key="chat" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <GroupChat g={g} onActivity={() => void reload()} onChange={mutate} />
          </motion.div>
        )}
      </AnimatePresence>

      <ExpenseSheet e={openExpense} g={g} onClose={() => setOpenExpense(null)} onChange={mutate} />
      <AddPeopleSheet open={adding} onClose={() => setAdding(false)} g={g} onChange={mutate} />
      <KittySetup open={kittySetup} onClose={() => setKittySetup(false)} g={g} onChange={mutate} />
      {roast && <RoastSheet open onClose={() => setRoast(null)} groupId={g.group.id} groupName={g.group.name} currency={cur} from={m(roast.from)} to={m(roast.to)} amount={roast.amount} />}
      {manual && <ManualSheet open onClose={() => setManual(null)} groupId={g.group.id} currency={cur} from={m(manual.from)} to={m(manual.to)} max={manual.amount} onDone={mutate} />}
      {paying && (
        <PaySheet
          open
          onClose={() => setPaying(null)}
          groupId={g.group.id}
          meId={meId}
          groupName={g.group.name}
          currency={cur}
          to={m(paying.to)}
          amount={paying.amount - waitingOn(paying)}
          onDone={mutate}
        />
      )}
    </div>
  )
}

function ExpenseRow({ e, g, onOpen }: { e: Expense; g: GroupFull; onOpen: () => void }) {
  const { T } = useLang()
  const cat = isCategory(e.category) ? CATEGORIES[e.category] : CATEGORIES.other
  const payer = g.members.find((x) => x.id === e.paidBy)!
  const me = g.me!
  const myShare = e.shares[me] ?? 0
  const lent = e.paidBy === me ? e.amount - myShare : 0
  return (
    <motion.li layout className={`erow${e.voidedAt ? ' is-void' : ''}`}>
      <motion.button className="erow__btn" whileTap={{ x: 3, y: 3 }} onClick={() => (sfx.tap(), onOpen())}>
        <span className="erow__cat" aria-hidden>
          {cat.emoji}
        </span>
        <span className="erow__mid">
          <b>
            {e.description}
            {e.receipt && <i className="erow__clip" aria-label={T('has receipt', 'receipt hai')}>📎</i>}
          </b>
          <small>
            {e.kitty ? T('Paid from the kitty', 'Kitty se diya') : `${payer.isMe ? T('You', 'Tune') : firstName(payer.name)} ${T('paid', 'diye')}`} {money(e.amount, g.group.currency)}
          </small>
        </span>
        <span className="erow__me">
          {e.voidedAt ? (
            <small>{T('removed', 'hataya')}</small>
          ) : lent > 0 ? (
            <>
              <small>{T('you lent', 'udhaar diya')}</small>
              <b className="pos">{money(lent, g.group.currency)}</b>
            </>
          ) : myShare > 0 ? (
            <>
              <small>{T('your share', 'tera hissa')}</small>
              <b className="neg">{money(myShare, g.group.currency)}</b>
            </>
          ) : (
            <small>{T('not in it', 'tu nahi tha')}</small>
          )}
        </span>
      </motion.button>
    </motion.li>
  )
}

function SettlementRow({ s, g }: { s: Settlement; g: GroupFull }) {
  const { T } = useLang()
  const n = (id: string) => {
    const x = g.members.find((mm) => mm.id === id)!
    return x.isMe ? T('You', 'Tu') : firstName(x.name)
  }
  const kind = s.method === 'solana' ? 'sol' : s.method === 'upi' ? 'upi' : s.method === 'kitty' ? 'kitty' : 'manual'
  return (
    <li className={`srow srow--${kind}`}>
      <span className="srow__icon" aria-hidden>
        {methodIcon(s)}
      </span>
      <span className="srow__mid">
        <b>{s.method === 'kitty' ? T(`${n(s.from)} → kitty`, `${n(s.from)} → kitty`) : `${n(s.from)} → ${n(s.to)}`}</b>
        {s.method === 'solana' ? (
          <small>
            {T('On-chain, verified', 'On-chain, verified')} · {s.asset && s.base ? formatBase(BigInt(s.base), s.asset, 4) : ''}
            {s.demo ? ` · ${T('test', 'test')}` : ''}
          </small>
        ) : s.method === 'upi' ? (
          <small>
            {T('UPI, confirmed', 'UPI, confirm')}
            {s.ref ? ` · ref ${s.ref}` : ''}
          </small>
        ) : s.method === 'kitty' ? (
          <small>{T('into the kitty', 'kitty mein')}</small>
        ) : s.method === 'lightning' ? (
          <small>{T('Lightning', 'Lightning')}</small>
        ) : (
          <small className="hand">“{s.note || T('settled outside the app', 'bahar settle hua')}”</small>
        )}
      </span>
      <b className="srow__amt">{money(s.amount, g.group.currency)}</b>
    </li>
  )
}

function ExpenseSheet({ e, g, onClose, onChange }: { e: Expense | null; g: GroupFull; onClose: () => void; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [receipt, setReceipt] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  const cur = g.group.currency
  const me = g.members.find((x) => x.isMe)
  const creator = g.members.find((x) => x.isCreator)
  const canVoid = !!e && !e.voidedAt && (e.createdBy === me?.id || creator?.isMe)
  const canReceipt = !!e && !e.voidedAt && (e.createdBy === me?.id || e.paidBy === me?.id || creator?.isMe)

  useEffect(() => {
    setReceipt(null)
    setConfirm(false)
    if (!e?.receipt) return
    let url: string | null = null
    authedImage(`/groups/${g.group.id}/expenses/${e.id}/receipt`)
      .then((u) => setReceipt((url = u)))
      .catch(() => {})
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [e?.id, e?.receipt, g.group.id])

  const doVoid = async () => {
    if (!e) return
    setBusy('void')
    try {
      onChange(await api<GroupFull>(`/groups/${g.group.id}/expenses/${e.id}/void`, { body: await voidBody(user!, g.group.id, g.me!, e.id) }))
      sfx.unpop()
      toast(T('Removed. The history keeps a note that it was.', 'Hata diya. History mein note rehta hai.'), { emoji: '🗑️', silent: true })
      onClose()
    } catch (err) {
      toast(errText(err, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
      setConfirm(false)
    }
  }

  const attach = async (f: File | undefined) => {
    if (!f || !e) return
    setBusy('receipt')
    try {
      await upload(`/groups/${g.group.id}/expenses/${e.id}/receipt`, await shrink(f))
      onChange(await api<GroupFull>(`/groups/${g.group.id}`))
      sfx.pop()
      toast(T('Receipt attached', 'Receipt lag gayi'), { tone: 'get', emoji: '📎', silent: true })
    } catch (err) {
      toast(errText(err, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  const repeat = async () => {
    if (!e) return
    setBusy('repeat')
    try {
      await api(`/groups/${g.group.id}/recurring`, { body: { expenseId: e.id, every: 'month' } })
      sfx.success()
      toast(T('We’ll remind you next month', 'Agle mahine yaad dilayenge'), { tone: 'get', emoji: '🔁', silent: true })
    } catch (err) {
      toast(errText(err, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  const cat = e && isCategory(e.category) ? CATEGORIES[e.category] : CATEGORIES.other
  const payer = e ? g.members.find((x) => x.id === e.paidBy) : null
  const ordered = e ? g.members.filter((x) => e.shares[x.id]) : []
  return (
    <Sheet open={!!e} onClose={() => (setConfirm(false), onClose())} title={e?.description}>
      {e && (
        <div className="edetail">
          <div className="edetail__head stk stk--sats">
            <Emoji char={cat.emoji} size={56} />
            <div>
              <b className="edetail__amt">{money(e.amount, cur)}</b>
              <small>
                {e.kitty ? T('from the kitty', 'kitty se') : `${payer?.isMe ? T('You', 'Tune') : payer?.name} ${T('paid', 'diye')}`} · {ago(e.createdAt, lang)} · {modeName(e.mode, T)}
              </small>
            </div>
          </div>
          <ul className="split-list">
            {ordered.map((x: Member) => (
              <li key={x.id}>
                <Avatar name={x.name} src={x.avatar} size={28} ghost={!x.joined} />
                <span>{x.isMe ? T('You', 'Tu') : x.name}</span>
                <b>{money(e.shares[x.id], cur)}</b>
              </li>
            ))}
          </ul>
          {receipt && (
            <button type="button" className={`receipt-img${zoom ? ' is-zoom' : ''}`} onClick={() => setZoom((z) => !z)} aria-label={T('Receipt photo', 'Receipt photo')}>
              <img src={receipt} alt="" />
            </button>
          )}
          {canReceipt && (
            <label className="btn btn--paper btn--md btn--block receipt-pick">
              <input type="file" accept="image/*" hidden onChange={(ev) => void attach(ev.target.files?.[0]).finally(() => (ev.target.value = ''))} />
              {busy === 'receipt' ? '…' : `📎 ${e.receipt ? T('Replace receipt photo', 'Receipt photo badal') : T('Add receipt photo', 'Receipt photo laga')}`}
            </label>
          )}
          {e.createdBy === me?.id && !e.voidedAt && (
            <Press tone="paper" block loading={busy === 'repeat'} onClick={repeat}>
              🔁 {T('Repeat every month', 'Har mahine repeat kar')}
            </Press>
          )}
          {canVoid &&
            (confirm ? (
              <div className="share-row">
                <Press tone="owe" loading={busy === 'void'} onClick={doVoid}>
                  {T('Yes, remove', 'Haan, hata')}
                </Press>
                <Press tone="paper" onClick={() => setConfirm(false)}>
                  {T('Keep', 'Rehne de')}
                </Press>
              </div>
            ) : (
              <button type="button" className="linkish danger center" onClick={() => setConfirm(true)}>
                🗑️ {T('Remove this bill', 'Ye bill hata')}
              </button>
            ))}
        </div>
      )}
    </Sheet>
  )
}

export function modeName(mode: string, T: (en: string, hi: string) => string) {
  return (
    {
      equal: T('split equally', 'barabar'),
      exact: T('exact amounts', 'exact amount'),
      shares: T('by shares', 'shares se'),
      percent: T('by percent', 'percent se'),
      itemized: T('itemized', 'item-wise'),
    }[mode] ?? mode
  )
}
