// Balances are derived, never stored: replay expenses and settlements, get the same answer every time.

export type LedgerExpense = { id: string; paidBy: string; total: number; shares: Record<string, number>; voided?: boolean }
export type LedgerSettlement = { id: string; from: string; to: string; amount: number }
export type Transfer = { from: string; to: string; amount: number }

/** Positive = the group owes this member. Negative = this member owes the group. */
export function netBalances(memberOrder: string[], expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const net: Record<string, number> = Object.fromEntries(memberOrder.map((id) => [id, 0]))
  for (const e of expenses) {
    if (e.voided) continue
    net[e.paidBy] = (net[e.paidBy] ?? 0) + e.total
    for (const [id, s] of Object.entries(e.shares)) net[id] = (net[id] ?? 0) - s
  }
  for (const s of settlements) {
    net[s.from] = (net[s.from] ?? 0) + s.amount
    net[s.to] = (net[s.to] ?? 0) - s.amount
  }
  return net
}

/** Who owes whom, pair by pair, exactly as the bills fell. */
export function pairwiseDebts(memberOrder: string[], expenses: LedgerExpense[], settlements: LedgerSettlement[]): Transfer[] {
  const owe = new Map<string, number>()
  const k = (a: string, b: string) => `${a}\u0000${b}`
  const bump = (a: string, b: string, v: number) => owe.set(k(a, b), (owe.get(k(a, b)) ?? 0) + v)
  for (const e of expenses) {
    if (e.voided) continue
    for (const [id, s] of Object.entries(e.shares)) if (id !== e.paidBy && s) bump(id, e.paidBy, s)
  }
  for (const s of settlements) bump(s.from, s.to, -s.amount)
  const out: Transfer[] = []
  for (let i = 0; i < memberOrder.length; i++)
    for (let j = i + 1; j < memberOrder.length; j++) {
      const a = memberOrder[i]
      const b = memberOrder[j]
      const d = (owe.get(k(a, b)) ?? 0) - (owe.get(k(b, a)) ?? 0)
      if (d > 0) out.push({ from: a, to: b, amount: d })
      else if (d < 0) out.push({ from: b, to: a, amount: -d })
    }
  return out
}

/**
 * Fewest-hops settlement plan from net balances: repeatedly match the biggest debtor
 * with the biggest creditor. At most n−1 transfers. Ties break by member order, so it's stable.
 */
export function simplifyDebts(memberOrder: string[], net: Record<string, number>): Transfer[] {
  const pos = new Map(memberOrder.map((id, i) => [id, i]))
  const cmp = (a: [string, number], b: [string, number]) => b[1] - a[1] || pos.get(a[0])! - pos.get(b[0])!
  const creditors = memberOrder.filter((id) => net[id] > 0).map((id) => [id, net[id]] as [string, number])
  const debtors = memberOrder.filter((id) => net[id] < 0).map((id) => [id, -net[id]] as [string, number])
  const out: Transfer[] = []
  while (creditors.length && debtors.length) {
    creditors.sort(cmp)
    debtors.sort(cmp)
    const c = creditors[0]
    const d = debtors[0]
    const amt = Math.min(c[1], d[1])
    out.push({ from: d[0], to: c[0], amount: amt })
    c[1] -= amt
    d[1] -= amt
    if (!c[1]) creditors.shift()
    if (!d[1]) debtors.shift()
  }
  return out
}

export function debtsFor(simplify: boolean, memberOrder: string[], expenses: LedgerExpense[], settlements: LedgerSettlement[]) {
  const net = netBalances(memberOrder, expenses, settlements)
  const pairwise = pairwiseDebts(memberOrder, expenses, settlements)
  const simplified = simplifyDebts(memberOrder, net)
  return { net, pairwise, simplified, plan: simplify ? simplified : pairwise }
}

export function owedBetween(plan: Transfer[], from: string, to: string) {
  return plan.filter((t) => t.from === from && t.to === to).reduce((a, t) => a + t.amount, 0)
}
