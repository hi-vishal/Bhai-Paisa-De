import { debtsFor, owedBetween } from '../shared/balances'
import { isCurrency, type CurrencyCode } from '../shared/money'
import { q, type ExpenseRow, type GroupRow, type MemberRow, type SettlementRow } from './db'

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

export function loadGroupState(groupId: string) {
  const group = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId)
  if (!group) throw new HttpError(404, 'group_not_found', 'group not found')
  const members = q.all<MemberRow>('SELECT * FROM members WHERE group_id = ? ORDER BY position', groupId)
  const expenses = q.all<ExpenseRow>('SELECT * FROM expenses WHERE group_id = ? ORDER BY created_at DESC', groupId)
  const settlements = q.all<SettlementRow>('SELECT * FROM settlements WHERE group_id = ? ORDER BY created_at DESC', groupId)
  const order = members.map((m) => m.id)
  const balances = debtsFor(
    !!group.simplify,
    order,
    expenses.map((e) => ({ id: e.id, paidBy: e.paid_by, total: e.amount, shares: JSON.parse(e.shares_json), voided: !!e.voided_at })),
    settlements.map((s) => ({ id: s.id, from: s.from_member, to: s.to_member, amount: s.amount })),
  )
  const currency: CurrencyCode = isCurrency(group.currency) ? group.currency : 'INR'
  return { group, currency, members, expenses, settlements, balances, order }
}

export type GroupState = ReturnType<typeof loadGroupState>

export const owed = (s: GroupState, from: string, to: string) => owedBetween(s.balances.plan, from, to)

/**
 * The group kitty: money people put in (settlements marked kitty, to whoever holds it) minus bills
 * paid out of it. Balances already treat both as ordinary money moving, so whatever is left shows up
 * as the holder owing it back; this is the same money, seen as a pot.
 */
export function kittyOf(s: GroupState) {
  if (!s.group.kitty_holder) return null
  const byMember: Record<string, number> = {}
  let collected = 0
  for (const x of s.settlements)
    if (x.method === 'kitty') {
      collected += x.amount
      byMember[x.from_member] = (byMember[x.from_member] ?? 0) + x.amount
    }
  const spent = s.expenses.filter((e) => e.from_kitty && !e.voided_at).reduce((a, e) => a + e.amount, 0)
  return { holder: s.group.kitty_holder, target: s.group.kitty_target, collected, spent, left: collected - spent, byMember }
}
