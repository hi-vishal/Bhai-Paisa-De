import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CATEGORIES, type Category } from '@shared/categories'
import { CURRENCIES, formatMoney, parseMoney } from '@shared/money'
import { computeSplit, type SplitInput, type SplitItem } from '@shared/split'
import { Avatar } from '../components/Avatar'
import { blast, Spinner, Switch } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Odometer } from '../components/Odometer'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api, ApiError, upload } from '../lib/api'
import { shrink } from '../lib/image'
import { useSession } from '../lib/session'
import { expenseBody } from '../lib/writes'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import type { GroupFull, Member } from '../lib/types'
import { setCached, useResource } from '../lib/useResource'

type Mode = SplitInput['mode']
type DraftItem = { key: number; name: string; price: string; who: string[] }

const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export function AddExpense() {
  const { id } = useParams()
  const { data: g } = useResource(`group:${id}`, () => api<GroupFull>(`/groups/${id}`))
  if (!g) return <div className="screen"><TopBar back={`/g/${id}`} title="…" /><Spinner /></div>
  return <AddExpenseForm g={g} />
}

function AddExpenseForm({ g }: { g: GroupFull }) {
  const { user } = useSession()
  const { T, lang } = useLang()
  const nav = useNavigate()
  const toast = useToast()
  const cur = g.group.currency
  const dec = CURRENCIES[cur].decimals
  const order = g.members.map((m) => m.id)
  const meId = g.me!

  const [amt, setAmt] = useState('')
  const [pad, setPad] = useState(coarse)
  const [desc, setDesc] = useState('')
  const [cat, setCat] = useState<Category>('food')
  const [paidBy, setPaidBy] = useState(meId)
  const [mode, setMode] = useState<Mode>('equal')
  const [included, setIncluded] = useState<string[]>(order)
  const [exact, setExact] = useState<Record<string, string>>({})
  const [shares, setShares] = useState<Record<string, number>>(() => Object.fromEntries(order.map((i) => [i, 1])))
  const [pct, setPct] = useState<Record<string, string>>({})
  const [items, setItems] = useState<DraftItem[]>([{ key: 1, name: '', price: '', who: [] }])
  const [tax, setTax] = useState('')
  const [tip, setTip] = useState('')
  const [discount, setDiscount] = useState('')
  const [busy, setBusy] = useState(false)
  const [kitty, setKitty] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const [repeat, setRepeat] = useState(false)
  const holder = g.group.kitty?.holder

  const total = parseMoney(amt || '0', cur) ?? 0

  // desktop: type the amount straight on the keyboard while nothing else has focus
  useEffect(() => {
    if (coarse || mode === 'itemized') return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (/^[0-9.]$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const press = (k: string) => {
    haptic(4)
    if (k === '⌫') {
      sfx.backspace()
      return setAmt((a) => a.slice(0, -1))
    }
    setAmt((a) => {
      if (k === '.' && (dec === 0 || a.includes('.'))) return a
      const next = a === '0' && k !== '.' ? k : a + k
      const [, frac = ''] = next.split('.')
      if (frac.length > dec || next.replace('.', '').length > 9) {
        sfx.error()
        return a
      }
      sfx.key(Number(k === '.' ? 0 : k))
      return next === '.' ? '0.' : next
    })
  }

  const input: SplitInput = useMemo(() => {
    switch (mode) {
      case 'equal':
        return { mode, memberIds: included }
      case 'exact':
        return { mode, amounts: Object.fromEntries(order.map((i) => [i, parseMoney(exact[i] || '0', cur) ?? -1])) }
      case 'shares':
        return { mode, shares }
      case 'percent':
        return { mode, percents: Object.fromEntries(order.map((i) => [i, Number(pct[i] || 0)])) }
      case 'itemized':
        return {
          mode,
          items: items.filter((it) => it.price || it.who.length).map<SplitItem>((it) => ({ name: it.name || T('item', 'item'), amount: parseMoney(it.price || '0', cur) ?? 0, memberIds: it.who })),
          taxPercent: Number(tax) || undefined,
          tip: parseMoney(tip || '0', cur) ?? 0,
          discount: parseMoney(discount || '0', cur) ?? 0,
        }
    }
  }, [mode, included, exact, shares, pct, items, tax, tip, discount, order, cur, T])

  let preview: ReturnType<typeof computeSplit> | null = null
  let problem: string | null = null
  try {
    preview = computeSplit(input, mode === 'itemized' ? null : total, order)
  } catch (e) {
    problem = (e as Error).message
  }
  const shownTotal = mode === 'itemized' ? preview?.total ?? 0 : total
  const leftover = mode === 'equal' && included.length ? total % included.length : 0

  const exactSum = order.reduce((a, i) => a + (parseMoney(exact[i] || '0', cur) ?? 0), 0)
  const pctSum = order.reduce((a, i) => a + (Number(pct[i]) || 0), 0)

  const save = async () => {
    if (!desc.trim()) {
      toast(T('What was it for?', 'Kis cheez ka tha?'), { tone: 'owe', emoji: '✍️' })
      return
    }
    if (!preview) {
      toast(problem ?? T('Split doesn’t add up', 'Split match nahi ho raha'), { tone: 'owe', emoji: '🧮' })
      return
    }
    setBusy(true)
    try {
      const payer = kitty && holder ? holder : paidBy
      const body = await expenseBody(user!, g, { description: desc, category: cat, paidBy: payer, amount: mode === 'itemized' ? undefined : total, split: input, kitty: kitty && !!holder })
      const r = await api<GroupFull & { id: string }>(`/groups/${g.group.id}/expenses`, { body })
      setCached(`group:${g.group.id}`, r)
      // the extras ride after the bill: if one fails, the bill is still saved
      if (photo)
        await upload(`/groups/${g.group.id}/expenses/${r.id}/receipt`, await shrink(photo))
          .then(() => api<GroupFull>(`/groups/${g.group.id}`).then((x) => setCached(`group:${g.group.id}`, x)))
          .catch(() => toast(T('Saved, but the receipt didn’t upload. Add it from the bill.', 'Save hua, par receipt upload nahi hui. Bill se phir laga.'), { tone: 'owe' }))
      if (repeat) await api(`/groups/${g.group.id}/recurring`, { body: { expenseId: r.id, every: 'month' } }).catch(() => {})
      sfx.success()
      haptic([10, 40, 10])
      if (preview.total >= 500000 * 10 ** (dec - 2)) blast('money')
      toast(T(`Added ${money(preview.total, cur)}`, `${money(preview.total, cur)} add ho gaya`), { tone: 'get', emoji: CATEGORIES[cat].emoji, silent: true })
      nav(`/g/${g.group.id}`, { replace: true })
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'group_changed' || e.code === 'signature_mismatch')) setCached(`group:${g.group.id}`, await api<GroupFull>(`/groups/${g.group.id}`).catch(() => g))
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], mid: string) => (list.includes(mid) ? list.filter((x) => x !== mid) : order.filter((x) => x === mid || list.includes(x)))
  const MODES: [Mode, string][] = [
    ['equal', T('Equal', 'Barabar')],
    ['exact', T('Exact', 'Exact')],
    ['shares', T('Shares', 'Shares')],
    ['percent', '%'],
    ['itemized', T('Items', 'Items')],
  ]

  return (
    <div className="screen screen--add">
      <TopBar back={`/g/${g.group.id}`} title={T('Add expense', 'Kharcha daal')} sub={`${g.group.emoji} ${g.group.name}`} />

      <motion.button
        className={`amount stk${mode === 'itemized' ? ' amount--auto' : ''}`}
        onClick={() => mode !== 'itemized' && (sfx.tap(), setPad(true))}
        initial={{ rotate: -2, scale: 0.95 }}
        animate={{ rotate: -1, scale: 1 }}
        aria-label={T('Amount', 'Amount')}
      >
        <span className="amount__sym">{CURRENCIES[cur].symbol.trim()}</span>
        {mode === 'itemized' ? (
          <Odometer value={formatMoney(shownTotal, cur).replace(CURRENCIES[cur].symbol, '')} className="amount__num" />
        ) : (
          <span className={`amount__num${amt ? '' : ' is-empty'}`}>
            {amt ? Number(amt.split('.')[0]).toLocaleString(CURRENCIES[cur].locale) + (amt.includes('.') ? '.' + amt.split('.')[1] : '') : '0'}
            {pad && <i className="caret" />}
          </span>
        )}
        {mode === 'itemized' && <small className="amount__note">{T('adds up from items', 'items se jud raha hai')}</small>}
      </motion.button>

      <AnimatePresence initial={false}>
        {pad && mode !== 'itemized' && (
          <motion.div className="keypad" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="keypad__grid">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', dec ? '.' : '', '0', '⌫'].map((k, i) =>
                k ? (
                  <motion.button key={k} className={`key${k === '⌫' ? ' key--del' : ''}`} whileTap={{ y: 3, x: 3, boxShadow: '0 0 0 #000', scale: 0.96 }} onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : k}>
                    {k}
                  </motion.button>
                ) : (
                  <span key={`blank${i}`} />
                ),
              )}
            </div>
            <button className="linkish center" onClick={() => setPad(false)}>
              {T('Done', 'Ho gaya')} ↓
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <label className="label" htmlFor="desc">
        {T('What for?', 'Kis cheez ka?')}
      </label>
      <input
        id="desc"
        className="field field--big"
        maxLength={80}
        value={desc}
        placeholder={T('Dinner at Thalassa', 'Thalassa mein dinner')}
        onFocus={() => setPad(false)}
        onChange={(e) => setDesc(e.target.value)}
      />
      <div className="chips chips--scroll" role="radiogroup" aria-label={T('Category', 'Category')}>
        {(Object.keys(CATEGORIES) as Category[]).map((c) => (
          <motion.button
            key={c}
            role="radio"
            aria-checked={c === cat}
            className={`chip${c === cat ? ' chip--on' : ''}`}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              sfx.tap()
              setCat(c)
            }}
          >
            {CATEGORIES[c].emoji} {CATEGORIES[c][lang]}
          </motion.button>
        ))}
      </div>

      {holder && (
        <div className={`kitty-pick stk${kitty ? ' stk--sats' : ''}`}>
          <span>
            🏦 <b>{T('Paid from the kitty', 'Kitty se diya')}</b>
            <small>{T('Comes out of the group pot', 'Group ke pot se jaayega')}</small>
          </span>
          <Switch on={kitty} onChange={setKitty} label={T('Paid from the kitty', 'Kitty se diya')} />
        </div>
      )}

      {!kitty && <label className="label">{T('Paid by', 'Paise kisne diye?')}</label>}
      {!kitty && <div className="whopaid" role="radiogroup">
        {g.members.map((m) => (
          <motion.button
            key={m.id}
            role="radio"
            aria-checked={paidBy === m.id}
            className={`whopaid__btn${paidBy === m.id ? ' is-on' : ''}`}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              sfx.tap()
              setPaidBy(m.id)
            }}
          >
            <Avatar name={m.name} src={m.avatar} size={44} ghost={!m.joined} />
            <span>{m.isMe ? T('You', 'Tu') : firstName(m.name)}</span>
          </motion.button>
        ))}
      </div>}

      <label className="label">{T('Split how?', 'Kaise baante?')}</label>
      <LayoutGroup>
        <div className="seg" role="tablist">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={mode === k}
              className={`seg__btn${mode === k ? ' is-on' : ''}`}
              onClick={() => {
                sfx.tap()
                setMode(k)
                if (k === 'itemized') setPad(false)
              }}
            >
              {mode === k && <motion.span layoutId="segpill" className="seg__pill" transition={{ type: 'spring', stiffness: 520, damping: 34 }} />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </LayoutGroup>

      <div className="splitbox stk">
        {mode === 'itemized' ? (
          <ItemsEditor members={g.members} items={items} setItems={setItems} cur={cur} tax={tax} setTax={setTax} tip={tip} setTip={setTip} discount={discount} setDiscount={setDiscount} />
        ) : (
          <ul className="split-edit">
            {g.members.map((m) => {
              const share = preview?.shares[m.id] ?? 0
              const on = mode === 'equal' ? included.includes(m.id) : true
              return (
                <li key={m.id} className={on ? '' : 'is-off'}>
                  {mode === 'equal' ? (
                    <button
                      className={`tick${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      aria-label={m.name}
                      onClick={() => {
                        on ? sfx.unpop() : sfx.pop()
                        setIncluded((l) => toggle(l, m.id))
                      }}
                    >
                      {on ? '✓' : ''}
                    </button>
                  ) : null}
                  <Avatar name={m.name} src={m.avatar} size={30} ghost={!m.joined} />
                  <span className="split-edit__name">{m.isMe ? T('You', 'Tu') : m.name}</span>
                  {mode === 'exact' && (
                    <input className="field field--sm" inputMode="decimal" placeholder="0" value={exact[m.id] ?? ''} onFocus={() => setPad(false)} onChange={(e) => setExact((x) => ({ ...x, [m.id]: e.target.value }))} />
                  )}
                  {mode === 'percent' && (
                    <span className="pct">
                      <input className="field field--sm" inputMode="decimal" placeholder="0" value={pct[m.id] ?? ''} onFocus={() => setPad(false)} onChange={(e) => setPct((x) => ({ ...x, [m.id]: e.target.value }))} />%
                    </span>
                  )}
                  {mode === 'shares' && (
                    <span className="stepper">
                      <button aria-label="less" onClick={() => (sfx.unpop(), setShares((s) => ({ ...s, [m.id]: Math.max(0, (s[m.id] ?? 0) - 1) })))}>
                        −
                      </button>
                      <b>{shares[m.id] ?? 0}</b>
                      <button aria-label="more" onClick={() => (sfx.pop(), setShares((s) => ({ ...s, [m.id]: Math.min(99, (s[m.id] ?? 0) + 1) })))}>
                        +
                      </button>
                    </span>
                  )}
                  {mode !== 'exact' && <Odometer value={money(share, cur)} className="split-edit__amt" />}
                </li>
              )
            })}
          </ul>
        )}

        {mode === 'exact' && total > 0 && (
          <p className={`split-status${exactSum === total ? ' ok' : ''}`}>
            {exactSum === total ? T('Adds up ✓', 'Barabar ✓') : exactSum < total ? `${money(total - exactSum, cur)} ${T('left to assign', 'baaki hai')}` : `${money(exactSum - total, cur)} ${T('too much', 'zyada hai')}`}
          </p>
        )}
        {mode === 'percent' && (
          <p className={`split-status${Math.abs(pctSum - 100) < 0.001 ? ' ok' : ''}`}>
            {Math.abs(pctSum - 100) < 0.001 ? T('100% ✓', '100% ✓') : `${Math.round(pctSum * 100) / 100}% ${T('of 100%', '/ 100%')}`}
          </p>
        )}
        {leftover > 0 && preview && (
          <p className="paise-note">
            🪙{' '}
            {leftover === 1
              ? T('1 leftover paisa goes to whoever’s first in line, so it adds up exactly.', '1 bacha paisa line mein pehle wale ko, taaki total ekdum barabar ho.')
              : T(`${leftover} leftover paise go one each to the first ${leftover} in line, so it adds up exactly.`, `${leftover} bache paise line mein pehle ${leftover} logon ko ek-ek, taaki total ekdum barabar ho.`)}
          </p>
        )}
        {problem && (total > 0 || mode === 'itemized') && <p className="split-status bad">{problem}</p>}
      </div>

      <div className="extras-row">
        <label className={`chip chip--file${photo ? ' chip--on' : ''}`}>
          <input type="file" accept="image/*" hidden onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          📎 {photo ? T('Receipt added', 'Receipt lag gayi') : T('Receipt photo', 'Receipt photo')}
        </label>
        <button type="button" className={`chip${repeat ? ' chip--on' : ''}`} aria-pressed={repeat} onClick={() => (sfx.tap(), setRepeat((v) => !v))}>
          🔁 {T('Repeat monthly', 'Har mahine')}
        </button>
      </div>

      <div className="sticky-cta">
        <Press tone="sats" size="lg" block loading={busy} disabled={!preview || !desc.trim()} onClick={save}>
          {T('Add', 'Add kar')} {shownTotal > 0 ? money(shownTotal, cur) : ''} {CATEGORIES[cat].emoji}
        </Press>
      </div>
    </div>
  )
}

function ItemsEditor(props: {
  members: Member[]
  items: DraftItem[]
  setItems: (f: (x: DraftItem[]) => DraftItem[]) => void
  cur: GroupFull['group']['currency']
  tax: string
  setTax: (v: string) => void
  tip: string
  setTip: (v: string) => void
  discount: string
  setDiscount: (v: string) => void
}) {
  const { T } = useLang()
  const { members, items, setItems } = props
  const upd = (key: number, patch: Partial<DraftItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)))
  return (
    <div className="items">
      <AnimatePresence initial={false}>
        {items.map((it, i) => (
          <motion.div key={it.key} className="item" layout initial={{ opacity: 0, y: -10, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, x: 60 }}>
            <div className="item__row">
              <input className="field field--sm item__name" placeholder={T(`Item ${i + 1} (biryani?)`, `Item ${i + 1} (biryani?)`)} value={it.name} onChange={(e) => upd(it.key, { name: e.target.value })} />
              <input className="field field--sm item__price" inputMode="decimal" placeholder="₹0" value={it.price} onChange={(e) => upd(it.key, { price: e.target.value })} />
              {items.length > 1 && (
                <button className="item__x" aria-label={T('Remove item', 'Item hata')} onClick={() => (sfx.unpop(), setItems((xs) => xs.filter((x) => x.key !== it.key)))}>
                  ✕
                </button>
              )}
            </div>
            <div className="item__who">
              <span className="fine">{T('Who had it?', 'Kisne khaaya?')}</span>
              {members.map((m) => {
                const on = it.who.includes(m.id)
                return (
                  <motion.button
                    key={m.id}
                    className={`item__eater${on ? ' is-on' : ''}`}
                    whileTap={{ scale: 0.85 }}
                    aria-pressed={on}
                    onClick={() => {
                      on ? sfx.unpop() : sfx.pop()
                      upd(it.key, { who: on ? it.who.filter((x) => x !== m.id) : [...it.who, m.id] })
                    }}
                  >
                    <Avatar name={m.name} size={30} ghost={!on} />
                    <small>{m.isMe ? T('you', 'tu') : firstName(m.name)}</small>
                  </motion.button>
                )
              })}
              <button className="chip chip--tiny" onClick={() => (sfx.pop(), upd(it.key, { who: members.map((m) => m.id) }))}>
                {T('all', 'sab')}
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <Press tone="paper" size="sm" block onClick={() => setItems((xs) => [...xs, { key: Date.now(), name: '', price: '', who: [] }])}>
        ＋ {T('Add item', 'Item add kar')}
      </Press>
      <div className="extras">
        <label>
          <span>{T('Tax / service %', 'Tax / service %')}</span>
          <input className="field field--sm" inputMode="decimal" placeholder="5" value={props.tax} onChange={(e) => props.setTax(e.target.value)} />
        </label>
        <label>
          <span>{T('Tip', 'Tip')}</span>
          <input className="field field--sm" inputMode="decimal" placeholder="0" value={props.tip} onChange={(e) => props.setTip(e.target.value)} />
        </label>
        <label>
          <span>{T('Discount', 'Discount')}</span>
          <input className="field field--sm" inputMode="decimal" placeholder="0" value={props.discount} onChange={(e) => props.setDiscount(e.target.value)} />
        </label>
      </div>
      <p className="fine">{T('Tax, tip and discount are shared in proportion to what each person had.', 'Tax, tip aur discount har kisi ke khaane ke hisaab se baant-te hain.')}</p>
    </div>
  )
}
