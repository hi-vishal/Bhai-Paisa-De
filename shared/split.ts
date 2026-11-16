import { allocate } from './money'

// How a bill gets divided. Member order (by position) is the fixed order leftover units follow.

export type SplitItem = { name: string; amount: number; memberIds: string[] }

export type SplitInput =
  | { mode: 'equal'; memberIds: string[] }
  | { mode: 'exact'; amounts: Record<string, number> }
  | { mode: 'shares'; shares: Record<string, number> }
  | { mode: 'percent'; percents: Record<string, number> }
  | {
      mode: 'itemized'
      items: SplitItem[]
      /** tax / service charge as a percent of the item subtotal, e.g. 5 or 12.5 */
      taxPercent?: number
      tip?: number
      discount?: number
    }

export type SplitResult = { total: number; shares: Record<string, number> }

export class SplitError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

const toWeight = (n: number, scale = 100) => {
  if (!Number.isFinite(n) || n < 0) throw new SplitError('bad_weight', 'weights must be positive numbers')
  return Math.round(n * scale)
}

/** Itemized bills derive their own total; every other mode is given one. */
export function computeSplit(input: SplitInput, total: number | null, memberOrder: string[]): SplitResult {
  const known = new Set(memberOrder)
  const check = (ids: string[]) => {
    for (const id of ids) if (!known.has(id)) throw new SplitError('unknown_member', 'split includes someone not in the group')
  }
  const out: Record<string, number> = {}
  const add = (id: string, v: number) => (out[id] = (out[id] ?? 0) + v)

  if (input.mode === 'itemized') {
    if (!input.items.length) throw new SplitError('no_items', 'add at least one item')
    const subtotals: Record<string, number> = {}
    let subtotal = 0
    for (const item of input.items) {
      if (!Number.isSafeInteger(item.amount) || item.amount <= 0) throw new SplitError('bad_amount', `"${item.name || 'item'}" needs a price`)
      if (!item.memberIds.length) throw new SplitError('no_eaters', `who had "${item.name || 'that item'}"?`)
      check(item.memberIds)
      const ordered = memberOrder.filter((id) => item.memberIds.includes(id))
      allocate(item.amount, ordered.map(() => 1)).forEach((s, i) => (subtotals[ordered[i]] = (subtotals[ordered[i]] ?? 0) + s))
      subtotal += item.amount
    }
    const tax = input.taxPercent ? Math.round((subtotal * toWeight(input.taxPercent)) / 10000) : 0
    const extra = tax + (input.tip ?? 0) - (input.discount ?? 0)
    const grand = subtotal + extra
    if (grand <= 0) throw new SplitError('bad_total', 'discount is bigger than the bill')
    const ordered = memberOrder.filter((id) => subtotals[id])
    const extras = allocate(extra, ordered.map((id) => subtotals[id]))
    ordered.forEach((id, i) => add(id, subtotals[id] + extras[i]))
    return { total: grand, shares: out }
  }

  if (total == null || !Number.isSafeInteger(total) || total <= 0) throw new SplitError('bad_amount', 'amount must be more than zero')

  if (input.mode === 'equal') {
    check(input.memberIds)
    const ordered = memberOrder.filter((id) => input.memberIds.includes(id))
    if (!ordered.length) throw new SplitError('nobody', 'pick at least one person')
    allocate(total, ordered.map(() => 1)).forEach((s, i) => add(ordered[i], s))
  } else if (input.mode === 'exact') {
    check(Object.keys(input.amounts))
    let sum = 0
    for (const id of memberOrder) {
      const v = input.amounts[id] ?? 0
      if (!Number.isSafeInteger(v) || v < 0) throw new SplitError('bad_amount', 'exact amounts must be whole and positive')
      if (v > 0) add(id, v)
      sum += v
    }
    if (sum !== total) throw new SplitError('mismatch', `exact amounts add up to ${sum}, bill is ${total}`)
  } else if (input.mode === 'shares' || input.mode === 'percent') {
    const map = input.mode === 'shares' ? input.shares : input.percents
    check(Object.keys(map))
    const ordered = memberOrder.filter((id) => (map[id] ?? 0) > 0)
    const weights = ordered.map((id) => toWeight(map[id]))
    if (input.mode === 'percent' && weights.reduce((a, b) => a + b, 0) !== 10000)
      throw new SplitError('mismatch', 'percentages must add up to 100')
    if (!ordered.length) throw new SplitError('nobody', 'give someone a share')
    allocate(total, weights).forEach((s, i) => add(ordered[i], s))
  } else {
    throw new SplitError('bad_mode', 'unknown split mode')
  }
  return { total, shares: out }
}
