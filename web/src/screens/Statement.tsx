import { useParams } from 'react-router-dom'
import { CATEGORIES, isCategory } from '@shared/categories'
import { Spinner, Wordmark } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Press } from '../components/Press'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { useLang } from '../lib/i18n'
import type { GroupFull } from '../lib/types'
import { useResource } from '../lib/useResource'

const day = (ts: number, lang: string) => new Date(ts).toLocaleDateString(lang === 'hi' ? 'en-IN' : undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** A clean, printable statement of the whole group. "Save as PDF" from the print dialog. */
export function Statement() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const { data: g } = useResource(`group:${id}`, () => api<GroupFull>(`/groups/${id}`))
  if (!g) return <Spinner />
  const cur = g.group.currency
  const name = (mid: string) => g.members.find((m) => m.id === mid)?.name ?? '?'
  const live = g.expenses.filter((e) => !e.voidedAt)
  const total = live.reduce((a, e) => a + e.amount, 0)
  const first = Math.min(g.group.createdAt, ...live.map((e) => e.createdAt))
  const spentBy = new Map<string, number>()
  for (const e of live) for (const [mid, v] of Object.entries(e.shares)) spentBy.set(mid, (spentBy.get(mid) ?? 0) + v)

  return (
    <div className="screen statement">
      <div className="no-print">
        <TopBar back={`/g/${g.group.id}/settings`} title={T('Statement', 'Statement')} />
        <Press tone="ink" size="lg" block onClick={() => window.print()}>
          🖨️ {T('Print or save as PDF', 'Print ya PDF save kar')}
        </Press>
      </div>

      <article className="stmt">
        <header className="stmt__head">
          <Wordmark />
          <div>
            <h1>
              {g.group.emoji} {g.group.name}
            </h1>
            <p>
              {day(first, lang)} – {day(Date.now(), lang)} · {g.members.length} {T('people', 'log')} · {T('total spent', 'total kharcha')} {money(total, cur)}
            </p>
          </div>
        </header>

        <h2>{T('Where everyone stands', 'Kiska kitna')}</h2>
        <table>
          <thead>
            <tr>
              <th>{T('Person', 'Naam')}</th>
              <th className="num">{T('Their share of bills', 'Unka hissa')}</th>
              <th className="num">{T('Balance', 'Balance')}</th>
            </tr>
          </thead>
          <tbody>
            {g.members.map((m) => {
              const n = g.balances.net[m.id] ?? 0
              return (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td className="num">{money(spentBy.get(m.id) ?? 0, cur)}</td>
                  <td className={`num ${n > 0 ? 'pos' : n < 0 ? 'neg' : ''}`}>{n === 0 ? T('settled', 'clear') : n > 0 ? T(`gets ${money(n, cur)}`, `${money(n, cur)} milenge`) : T(`owes ${money(-n, cur)}`, `${money(-n, cur)} dene`)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {g.balances.plan.length > 0 && (
          <>
            <h2>{T('To settle up', 'Settle karne ke liye')}</h2>
            <ul className="stmt__plan">
              {g.balances.plan.map((t) => (
                <li key={`${t.from}>${t.to}`}>
                  {name(t.from)} → {name(t.to)}: <b>{money(t.amount, cur)}</b>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>{T('Bills', 'Bills')}</h2>
        <table>
          <thead>
            <tr>
              <th>{T('Date', 'Date')}</th>
              <th>{T('What', 'Kya')}</th>
              <th>{T('Paid by', 'Kisne diya')}</th>
              <th className="num">{T('Amount', 'Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {[...live].reverse().map((e) => (
              <tr key={e.id}>
                <td>{day(e.createdAt, lang)}</td>
                <td>
                  {(isCategory(e.category) ? CATEGORIES[e.category] : CATEGORIES.other).emoji} {e.description}
                </td>
                <td>{e.kitty ? T('Kitty', 'Kitty') : name(e.paidBy)}</td>
                <td className="num">{money(e.amount, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {g.settlements.length > 0 && (
          <>
            <h2>{T('Payments', 'Payments')}</h2>
            <table>
              <thead>
                <tr>
                  <th>{T('Date', 'Date')}</th>
                  <th>{T('From → to', 'Kisse → kisko')}</th>
                  <th>{T('How', 'Kaise')}</th>
                  <th className="num">{T('Amount', 'Amount')}</th>
                </tr>
              </thead>
              <tbody>
                {[...g.settlements].reverse().map((s) => (
                  <tr key={s.id}>
                    <td>{day(s.createdAt, lang)}</td>
                    <td>{s.method === 'kitty' ? `${name(s.from)} → ${T('kitty', 'kitty')}` : `${name(s.from)} → ${name(s.to)}`}</td>
                    <td>{s.method === 'upi' ? `UPI${s.ref ? ` · ${s.ref}` : ''}` : s.method === 'solana' ? s.asset ?? 'crypto' : s.method === 'kitty' ? T('kitty', 'kitty') : s.note ?? T('cash/other', 'cash/other')}</td>
                    <td className="num">{money(s.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <footer className="stmt__foot">
          {T(`Generated ${day(Date.now(), lang)} by Bhai Paise De. Every entry is signed by the person who made it.`, `${day(Date.now(), lang)} ko Bhai Paise De se bana. Har entry usne sign ki jisne daali.`)}
        </footer>
      </article>
    </div>
  )
}
