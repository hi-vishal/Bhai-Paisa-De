import { CATEGORIES, isCategory } from '@shared/categories'
import type { GroupFull } from './types'

export type WrappedStats = ReturnType<typeof computeWrapped>

export function computeWrapped(g: GroupFull) {
  const live = g.expenses.filter((e) => !e.voidedAt)
  const name = (id: string) => g.members.find((m) => m.id === id)?.name ?? '?'
  const total = live.reduce((a, e) => a + e.amount, 0)

  const paid = new Map<string, number>()
  const consumed = new Map<string, number>()
  for (const e of live) {
    paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.amount)
    for (const [id, s] of Object.entries(e.shares)) consumed.set(id, (consumed.get(id) ?? 0) + s)
  }
  const rank = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])

  const atm = rank(paid)[0]
  const foodie = rank(consumed)[0]
  const biggest = [...live].sort((a, b) => b.amount - a.amount)[0]

  const cats = new Map<string, number>()
  for (const e of live) cats.set(e.category, (cats.get(e.category) ?? 0) + 1)
  const topCat = rank(cats)[0]

  const debtor = Object.entries(g.balances.net).sort((a, b) => a[1] - b[1])[0]
  const upi = g.settlements.filter((s) => s.method === 'upi')
  const manual = g.settlements.filter((s) => s.method === 'manual')
  const chain = g.settlements.filter((s) => s.method === 'solana')
  const kitty = g.settlements.filter((s) => s.method === 'kitty')

  const settlerCount = new Map<string, number>()
  for (const s of g.settlements) settlerCount.set(s.from, (settlerCount.get(s.from) ?? 0) + 1)
  const fastest = rank(settlerCount)[0]

  const ghosts = g.members.filter((m) => !m.joined)

  const days = new Map<string, number>()
  for (const e of live) {
    const d = new Date(e.createdAt).toDateString()
    days.set(d, (days.get(d) ?? 0) + e.amount)
  }
  const wildestDay = rank(days)[0]

  return {
    total,
    count: live.length,
    members: g.members.length,
    perHead: g.members.length ? Math.round(total / g.members.length) : 0,
    atm: atm ? { name: name(atm[0]), amount: atm[1], share: total ? atm[1] / total : 0 } : null,
    foodie: foodie ? { name: name(foodie[0]), amount: foodie[1] } : null,
    biggest: biggest ? { description: biggest.description, amount: biggest.amount, by: name(biggest.paidBy) } : null,
    topCat: topCat && isCategory(topCat[0]) ? { ...CATEGORIES[topCat[0]], count: topCat[1] } : null,
    moocher: debtor && debtor[1] < 0 ? { name: name(debtor[0]), amount: -debtor[1] } : null,
    upiCount: upi.length,
    chainCount: chain.length,
    settledCount: upi.length + chain.length + manual.length,
    settledAmount: [...upi, ...chain, ...manual].reduce((a, s) => a + s.amount, 0),
    manualCount: manual.length,
    kittyAmount: kitty.reduce((a, s) => a + s.amount, 0),
    fastest: fastest ? { name: name(fastest[0]), count: fastest[1] } : null,
    ghosts: ghosts.map((m) => m.name),
    wildestDay: wildestDay ? { date: new Date(wildestDay[0]), amount: wildestDay[1] } : null,
    settled: g.balances.plan.length === 0,
  }
}
