import { Router } from 'express'
import { claimSettlement, isClaimMethod, type ClaimMethod } from '../shared/claims'
import { CURRENCIES, formatMoney } from '../shared/money'
import { cleanRef } from '../shared/upi'
import { full, settled } from './api'
import { auth, limit, type Authed } from './auth'
import { newId } from './crypto'
import { q, type ClaimRow, type MemberRow } from './db'
import { markClaimEvent, memberById, postEvent, pushMembers } from './events'
import { idFor, int, memberOf, memberSig, P } from './http'
import { appendAtomically } from './nostr'
import { HttpError, loadGroupState, owed, type GroupState } from './state'

// "I've paid": UPI, cash and bank transfers happen outside the app, so the payer says so and the
// person getting paid confirms. Only the confirmation moves the balance, signed by the payee.

export const claims = Router()

const MAX_PENDING_PER_PAIR = 3

/** Shared by the in-app button and the public pay link. */
export function createClaim(s: GroupState, from: MemberRow, to: MemberRow, amount: number, method: ClaimMethod, ref: string | null, via: 'app' | 'link') {
  if (from.id === to.id) throw new HttpError(400, 'bad_pair', 'pick who paid whom')
  if (!to.user_id) throw new HttpError(409, 'payee_not_joined', `${to.name} isn't on the app, so there's nobody to confirm. Mark it paid yourself.`)
  const pending = q.all<ClaimRow>("SELECT * FROM claims WHERE group_id = ? AND from_member = ? AND to_member = ? AND status = 'pending'", s.group.id, from.id, to.id)
  if (pending.length >= MAX_PENDING_PER_PAIR) throw new HttpError(429, 'too_many_claims', `${to.name} still has to confirm your earlier ones`)
  if (method === 'kitty') {
    if (s.group.kitty_holder !== to.id) throw new HttpError(400, 'bad_kitty', 'kitty money goes to whoever holds the kitty')
    if (amount > 10_000_000 * 10 ** CURRENCIES[s.currency].decimals) throw new HttpError(400, 'too_big', 'that is too much for one entry')
  } else {
    const due = owed(s, from.id, to.id)
    const waiting = pending.filter((c) => c.method !== 'kitty').reduce((a, c) => a + c.amount, 0)
    if (due <= 0) throw new HttpError(409, 'nothing_owed', `${from.name} doesn't owe ${to.name} anything right now`)
    if (waiting && amount > due - waiting)
      throw new HttpError(409, 'already_claimed', `you already said you paid ${formatMoney(waiting, s.currency)}. Waiting for ${to.name} to confirm`)
    if (amount > due) throw new HttpError(400, 'too_much', `that's more than the ${formatMoney(due, s.currency)} owed`)
  }
  const id = newId()
  q.run("INSERT INTO claims (id, group_id, from_member, to_member, amount, method, ref, status, via, created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)", id, s.group.id, from.id, to.id, amount, method, ref, via, Date.now())
  const amt = formatMoney(amount, s.currency)
  postEvent(s.group.id, from.id, { t: 'claim', id, from: from.id, to: to.id, amount, method }, method === 'kitty' ? `${from.name} says they put ${amt} in the kitty` : `${from.name} says they paid ${to.name} ${amt}`)
  pushMembers([to], {
    title: method === 'kitty' ? `${from.name} added ${amt} to the kitty?` : `${from.name} says they paid you ${amt}`,
    body: `${s.group.emoji} ${s.group.name}: check your ${method === 'upi' ? 'UPI app' : 'account'} and confirm`,
    url: `/g/${s.group.id}?confirm=${id}`,
    tag: `claim-${id}`,
  })
  return q.get<ClaimRow>('SELECT * FROM claims WHERE id = ?', id)!
}

const claimOf = (groupId: string, cid: string) => {
  const c = q.get<ClaimRow>('SELECT * FROM claims WHERE id = ? AND group_id = ?', cid, groupId)
  if (!c) throw new HttpError(404, 'not_found', 'that payment note is gone')
  if (c.status !== 'pending') throw new HttpError(409, 'claim_done', `already ${c.status}`)
  return c
}

claims.post('/groups/:id/claims', auth, limit('claim', 60, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const b = req.body ?? {}
  const to = s.members.find((m) => m.id === b.to)
  if (!to) throw new HttpError(400, 'bad_pair', 'who did you pay?')
  const method = isClaimMethod(b.method) ? b.method : 'upi'
  createClaim(s, me, to, int(b.amount, 'amount'), method, cleanRef(b.ref), 'app')
  res.status(201).json(full(s.group.id, me))
})

/** The payee says "got it". Their signature goes on the settlement this writes. */
claims.post('/groups/:id/claims/:cid/confirm', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const c = claimOf(P(req).id, P(req).cid)
  if (c.to_member !== me.id) throw new HttpError(403, 'not_your_call', 'only the person getting the money can confirm it')
  const s = loadGroupState(c.group_id)
  const id = idFor(u, req.body?.id)
  const data = claimSettlement({ from: c.from_member, to: c.to_member, amount: c.amount, method: c.method, ref: c.ref }, id, me.id)
  const sig = memberSig(u, s.group.id, data, req.body?.signed)
  if (c.method !== 'kitty' && c.amount > owed(s, c.from_member, c.to_member)) {
    q.run("UPDATE claims SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'pending'", Date.now(), c.id)
    markClaimEvent(s.group.id, c.id, 'cancelled')
    throw new HttpError(409, 'too_much', 'that was already settled another way')
  }
  if (data.type !== 'settlement') throw new Error('unreachable')
  appendAtomically(s.group.id, [{ data, refId: id, sig }], () => {
    if (q.run("UPDATE claims SET status = 'confirmed', decided_at = ?, settlement_id = ? WHERE id = ? AND status = 'pending'", Date.now(), id, c.id).changes === 0)
      throw new HttpError(409, 'claim_done', 'already decided')
    if (c.method !== 'kitty' && c.amount > owed(loadGroupState(s.group.id), c.from_member, c.to_member)) throw new HttpError(409, 'too_much', 'that was already settled')
    q.run(
      'INSERT INTO settlements (id, group_id, from_member, to_member, amount, method, note, recorded_by, created_at, ref) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, s.group.id, c.from_member, c.to_member, c.amount, data.method, data.note ?? null, me.id, Date.now(), data.ref ?? null,
    )
  })
  markClaimEvent(s.group.id, c.id, 'confirmed')
  settled(s, memberById(c.from_member)!, me, c.amount, data.method, me.id)
  res.json(full(s.group.id, me))
})

claims.post('/groups/:id/claims/:cid/reject', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const c = claimOf(P(req).id, P(req).cid)
  if (c.to_member !== me.id) throw new HttpError(403, 'not_your_call', 'only the person getting the money can answer this')
  q.run("UPDATE claims SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'", Date.now(), c.id)
  markClaimEvent(c.group_id, c.id, 'rejected')
  const s = loadGroupState(c.group_id)
  pushMembers([memberById(c.from_member)], { title: `${me.name} hasn't got your ${formatMoney(c.amount, s.currency)} yet`, body: `${s.group.emoji} ${s.group.name}: check the payment went through`, url: `/g/${s.group.id}` })
  res.json(full(s.group.id, me))
})

claims.post('/groups/:id/claims/:cid/cancel', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const c = claimOf(P(req).id, P(req).cid)
  if (c.from_member !== me.id) throw new HttpError(403, 'not_your_call', 'only whoever said they paid can take it back')
  q.run("UPDATE claims SET status = 'cancelled', decided_at = ? WHERE id = ? AND status = 'pending'", Date.now(), c.id)
  markClaimEvent(c.group_id, c.id, 'cancelled')
  res.json(full(c.group_id, me))
})

// ---------- kitty ----------

/** Start, hand over or close the kitty. Anyone can start one; after that it's the holder's or the creator's call. */
claims.patch('/groups/:id/kitty', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const b = req.body ?? {}
  const current = s.group.kitty_holder
  const boss = s.group.created_by === u.id || current === me.id
  if (current && !boss) throw new HttpError(403, 'not_your_call', 'only whoever holds the kitty (or the group creator) can change it')
  const holder = b.holder === null ? null : s.members.find((m) => m.id === b.holder)
  if (b.holder !== null && !holder) throw new HttpError(400, 'bad_holder', 'who holds the kitty?')
  if (holder && !holder.user_id) throw new HttpError(400, 'holder_not_joined', `${holder.name} has to join the app to hold the kitty, since they confirm the money coming in`)
  const target = b.target === null || b.target === undefined ? null : int(b.target, 'target')
  q.run('UPDATE groups SET kitty_holder = ?, kitty_target = ? WHERE id = ?', holder?.id ?? null, holder ? target : null, s.group.id)
  postEvent(
    s.group.id,
    me.id,
    { t: 'kitty', holder: holder?.id ?? null, target },
    holder ? `${me.name} ${current ? 'updated' : 'started'} a kitty, held by ${holder.name}${target ? ` (goal ${formatMoney(target, s.currency)})` : ''}` : `${me.name} closed the kitty`,
  )
  res.json(full(s.group.id, me))
})

// ---------- nudges ----------

const NUDGE_GAP = 12 * 60 * 60_000

/** A friendly "hey" push to someone who owes you, at most twice a day. */
claims.post('/groups/:id/nudge', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const to = s.members.find((m) => m.id === req.body?.to)
  if (!to) throw new HttpError(400, 'bad_pair', 'nudge who?')
  const amount = owed(s, to.id, me.id)
  if (amount <= 0) throw new HttpError(409, 'nothing_owed', `${to.name} doesn't owe you anything`)
  if (!to.user_id) throw new HttpError(409, 'not_joined', `${to.name} isn't on the app. Send them the pay link instead`)
  const now = Date.now()
  const r = q.run('INSERT INTO nudges (from_member, to_member, at) VALUES (?,?,?) ON CONFLICT(from_member, to_member) DO UPDATE SET at = excluded.at WHERE at < ?', me.id, to.id, now, now - NUDGE_GAP)
  if (r.changes === 0) throw new HttpError(429, 'nudged_recently', `you nudged ${to.name} recently. Give it a few hours`)
  const amt = formatMoney(amount, s.currency)
  postEvent(s.group.id, me.id, { t: 'nudge', from: me.id, to: to.id, amount }, `${me.name} nudged ${to.name} for ${amt}`)
  pushMembers([to], { title: `🔔 ${me.name} is asking for ${amt}`, body: `${s.group.emoji} ${s.group.name}: tap to pay`, url: `/g/${s.group.id}`, tag: `nudge-${me.id}-${to.id}` })
  res.json({ ok: true })
})
