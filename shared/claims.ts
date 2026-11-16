// "I've paid": the payer says so, the person getting paid confirms. On confirm, the payee signs a
// settlement entry built from the claim. Server and phone both build it with this function, so the
// signature the phone makes is over exactly the entry the server writes.

import type { EntryData } from './ledger'

export type ClaimMethod = 'upi' | 'cash' | 'bank' | 'other' | 'kitty'
export const CLAIM_METHODS: ClaimMethod[] = ['upi', 'cash', 'bank', 'other', 'kitty']
export const isClaimMethod = (v: unknown): v is ClaimMethod => typeof v === 'string' && (CLAIM_METHODS as string[]).includes(v)

const NOTE: Record<Exclude<ClaimMethod, 'upi' | 'kitty'>, string> = { cash: 'Cash', bank: 'Bank transfer', other: 'Paid' }

export type ClaimLike = { from: string; to: string; amount: number; method: ClaimMethod; ref: string | null }

/** The settlement entry that confirming a claim writes. `by` is the payee. */
export function claimSettlement(c: ClaimLike, id: string, by: string): EntryData {
  if (c.method === 'kitty') return { type: 'settlement', id, from: c.from, to: c.to, amount: c.amount, method: 'kitty', ref: c.ref ?? undefined, by }
  if (c.method === 'upi') return { type: 'settlement', id, from: c.from, to: c.to, amount: c.amount, method: 'upi', ref: c.ref ?? undefined, by }
  return { type: 'settlement', id, from: c.from, to: c.to, amount: c.amount, method: 'manual', note: NOTE[c.method], by }
}
