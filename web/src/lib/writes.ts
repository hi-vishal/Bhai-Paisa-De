// Request bodies for every change to a group. For accounts with an identity key, each one
// carries the member's signature over exactly the entry the server will write; the server
// rebuilds the entry from the request and refuses it if a single byte differs.

import { cleanText, newId } from '@shared/canon'
import { isCategory } from '@shared/categories'
import { claimSettlement } from '@shared/claims'
import type { EntryData } from '@shared/ledger'
import type { CurrencyCode } from '@shared/money'
import { joinName, nextPosition, startingMembers } from '@shared/rules'
import { computeSplit, type SplitInput } from '@shared/split'
import { sigFields, signAll } from './sign'
import type { Claim, GroupFull, User } from './types'

export async function newGroupBody(me: User, f: { name: string; emoji: string; currency: CurrencyCode; members: string[] }) {
  const base = { name: cleanText(f.name), emoji: cleanText(f.emoji), currency: f.currency, members: f.members }
  if (!me.pubkey) return base
  const names = startingMembers(me.name, f.members)
  const id = newId()
  const memberIds = names.map(() => newId())
  const by = memberIds[0]
  const entries: EntryData[] = [
    { type: 'group', id, name: base.name, currency: f.currency, emoji: base.emoji, by },
    ...names.map((n, position): EntryData => ({ type: 'member', id: memberIds[position], name: n, position, pubkey: position === 0 ? me.pubkey! : undefined, by })),
  ]
  return { ...base, id, memberIds, signed: await signAll(id, entries) }
}

export async function addMemberBody(me: User, g: GroupFull, name: string) {
  const id = newId()
  const data: EntryData = { type: 'member', id, name: cleanText(name), position: nextPosition(g.members.map((m) => m.position)), by: g.me! }
  return { name: data.name, id, ...(await sigFields(me.pubkey, g.group.id, data)) }
}

/** A friend who's on the app: they get a "you were added" card and join with their own key. */
export async function addFriendBody(me: User, g: GroupFull, friend: { id: string; name: string }) {
  const id = newId()
  const data: EntryData = { type: 'member', id, name: joinName(friend.name, g.members.map((m) => m.name)), position: nextPosition(g.members.map((m) => m.position)), by: g.me! }
  return { userId: friend.id, id, ...(await sigFields(me.pubkey, g.group.id, data)) }
}

/** Yes to a friend's invite: bind your key to the member they made for you. */
export async function acceptBody(me: User, groupId: string, memberId: string) {
  if (!me.pubkey) return { memberId }
  return { memberId, ...(await sigFields(me.pubkey, groupId, { type: 'claim', memberId, pubkey: me.pubkey })) }
}

/** "Got it": the payee signs the settlement this claim turns into. */
export async function confirmBody(me: User, groupId: string, meId: string, c: Claim) {
  const id = newId()
  return { id, ...(await sigFields(me.pubkey, groupId, claimSettlement(c, id, meId))) }
}

export async function expenseBody(me: User, g: GroupFull, f: { description: string; category: string; paidBy: string; amount?: number; split: SplitInput; kitty?: boolean }) {
  const body = { description: cleanText(f.description), category: f.category, paidBy: f.paidBy, amount: f.amount, split: f.split, kitty: f.kitty || undefined }
  if (!me.pubkey) return body
  const r = computeSplit(f.split, f.split.mode === 'itemized' ? null : f.amount ?? 0, g.members.map((m) => m.id))
  const id = newId()
  const data: EntryData = {
    type: 'expense',
    id,
    description: body.description,
    category: isCategory(f.category) ? f.category : 'other',
    paidBy: f.paidBy,
    total: r.total,
    shares: r.shares,
    mode: f.split.mode,
    kitty: f.kitty || undefined,
    by: g.me!,
  }
  return { ...body, id, ...(await sigFields(me.pubkey, g.group.id, data)) }
}

export async function voidBody(me: User, groupId: string, meId: string, expenseId: string) {
  return sigFields(me.pubkey, groupId, { type: 'void', expenseId, by: meId })
}

/** Recorded by hand: "got it in cash", a UPI payment, or money into the kitty. */
export async function manualBody(me: User, groupId: string, meId: string, f: { from: string; to: string; amount: number; note?: string; method?: 'manual' | 'upi' | 'kitty'; ref?: string }) {
  const note = f.note?.trim() ? cleanText(f.note) : undefined
  const method = f.method ?? 'manual'
  const ref = f.ref && /^\d{12}$/.test(f.ref.replace(/\s+/g, '')) ? f.ref.replace(/\s+/g, '') : undefined
  const id = newId()
  const data: EntryData = { type: 'settlement', id, from: f.from, to: f.to, amount: f.amount, method, note, ref, by: meId }
  return { from: f.from, to: f.to, amount: f.amount, note, method, ref, id, ...(await sigFields(me.pubkey, groupId, data)) }
}

type Invite = { group: { id: string }; members: { id: string; name: string; position: number }[] }

export async function joinBody(me: User, inv: Invite, claim: string | null) {
  if (!me.pubkey) return claim ? { memberId: claim } : {}
  if (claim) return { memberId: claim, ...(await sigFields(me.pubkey, inv.group.id, { type: 'claim', memberId: claim, pubkey: me.pubkey })) }
  const id = newId()
  const data: EntryData = {
    type: 'member',
    id,
    name: joinName(me.name, inv.members.map((m) => m.name)),
    position: nextPosition(inv.members.map((m) => m.position)),
    pubkey: me.pubkey,
    by: id,
  }
  return { id, ...(await sigFields(me.pubkey, inv.group.id, data)) }
}
