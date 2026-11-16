import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { ID_RE } from '../shared/canon'
import { isCategory } from '../shared/categories'
import { encodeBackup, type EntryData } from '../shared/ledger'
import { CURRENCIES, formatMoney, isCurrency } from '../shared/money'
import { joinName, nextPosition, startingMembers } from '../shared/rules'
import { isAddress } from '../shared/solana'
import { computeSplit, SplitError, type SplitInput } from '../shared/split'
import { cleanRef, cleanUpi } from '../shared/upi'
import { auth, checkAuthEvent, createSession, limit, newChallenge, type Authed } from './auth'
import { config } from './config'
import { hashToken, newId, newToken } from './crypto'
import { q, type ClaimRow, type ExpenseRow, type GroupRow, type LedgerRow, type MemberRow, type SessionRow, type SettlementRow, type UserRow } from './db'
import { postEvent, pushMembers } from './events'
import { avatarUrl, freshUser, idFor, int, memberOf, memberSig, P, stillNext, str, usersOf, userView } from './http'
import { appendAtomically, serverPubkey } from './nostr'
import { prices } from './rates'
import { addressProofMessage, checkAddressProof } from './solana'
import { HttpError, kittyOf, loadGroupState, owed, type GroupState } from './state'

export const api = Router()

export { P, limit }

/** Balances always use every bill; the list sent to the phone is the latest few hundred. */
const LIST_CAP = 500

export const claimView = (c: ClaimRow) => ({ id: c.id, from: c.from_member, to: c.to_member, amount: c.amount, method: c.method, ref: c.ref, status: c.status, via: c.via, createdAt: c.created_at })

export function groupView(s: GroupState, me: MemberRow | null) {
  const users = usersOf(s.members)
  const claims = q.all<ClaimRow>("SELECT * FROM claims WHERE group_id = ? AND status = 'pending' ORDER BY created_at DESC", s.group.id)
  return {
    counts: { expenses: s.expenses.length, settlements: s.settlements.length },
    group: {
      id: s.group.id,
      name: s.group.name,
      emoji: s.group.emoji,
      currency: s.currency,
      simplify: !!s.group.simplify,
      createdAt: s.group.created_at,
      createdBy: s.group.created_by,
      inviteCode: me ? s.group.invite_code : undefined,
      kitty: kittyOf(s),
    },
    me: me?.id ?? null,
    members: s.members.map((m) => {
      const u = m.user_id ? users.get(m.user_id) : undefined
      return {
        id: m.id,
        name: m.name,
        position: m.position,
        joined: !!m.user_id,
        invited: !m.user_id && !!m.invited_user,
        /** the account behind them (or the friend invited), so "add a friend" can skip people already here */
        userId: m.user_id ?? m.invited_user,
        isMe: m.id === me?.id,
        avatar: avatarUrl(u),
        upi: u?.upi_id ?? null,
        sol: !!(config.solana.enabled && u?.sol_address),
        signs: !!m.pubkey,
        isCreator: m.user_id === s.group.created_by,
      }
    }),
    expenses: s.expenses.slice(0, LIST_CAP).map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category,
      amount: e.amount,
      paidBy: e.paid_by,
      mode: e.split_mode,
      split: JSON.parse(e.split_json),
      shares: JSON.parse(e.shares_json) as Record<string, number>,
      createdBy: e.created_by,
      createdAt: e.created_at,
      voidedAt: e.voided_at,
      kitty: !!e.from_kitty,
      receipt: !!e.has_receipt,
    })),
    settlements: s.settlements.slice(0, LIST_CAP).map((x) => ({
      id: x.id,
      from: x.from_member,
      to: x.to_member,
      amount: x.amount,
      method: x.method,
      note: x.note,
      ref: x.ref,
      sats: x.sats,
      asset: x.asset,
      base: x.base_amount,
      txSig: x.tx_sig,
      demo: !!x.demo,
      recordedBy: x.recorded_by,
      createdAt: x.created_at,
    })),
    claims: claims.map(claimView),
    balances: s.balances,
  }
}

function ledgerSummary(groupId: string) {
  const r = q.get<{ n: number; pub: number; signed: number }>(
    "SELECT COUNT(*) n, SUM(CASE WHEN relays_ok != '[]' THEN 1 ELSE 0 END) pub, SUM(CASE WHEN signer IS NOT NULL THEN 1 ELSE 0 END) signed FROM ledger WHERE group_id = ?",
    groupId,
  )
  return { entries: r?.n ?? 0, published: r?.pub ?? 0, signed: r?.signed ?? 0, offsite: config.nostrEnabled }
}

export const full = (groupId: string, me: MemberRow) => ({ ...groupView(loadGroupState(groupId), me), ledger: ledgerSummary(groupId) })

// ---------- server info ----------

api.get('/server', (_req, res) => {
  res.json({
    pubkey: serverPubkey,
    relays: config.relays,
    offsite: config.nostrEnabled,
    demo: config.demoWallet,
    quoteSeconds: config.quoteSeconds,
    tip: config.tip.upi ? { upi: config.tip.upi, name: config.tip.name } : null,
    solana: {
      enabled: config.solana.enabled,
      cluster: config.solana.cluster,
      stableMint: config.solana.stableMint,
      stableDecimals: config.solana.stableDecimals,
      stableLabel: config.solana.stableLabel,
      priorityMicroLamports: config.solana.priorityMicroLamports.toString(),
    },
  })
})

api.get('/prices/:currency', async (req, res) => {
  const c = P(req).currency.toUpperCase()
  if (!isCurrency(c)) throw new HttpError(400, 'bad_currency', 'unknown currency')
  if (!config.solana.enabled) throw new HttpError(404, 'crypto_off', 'crypto payments are off on this server')
  res.setHeader('Cache-Control', 'private, max-age=20')
  res.json(await prices(c))
})

// ---------- sign in: the phone holds a key; the key signs a challenge ----------

api.post('/auth/challenge', limit('challenge', 60, 10 * 60_000), (_req, res) => {
  res.json(newChallenge())
})

/** Sign in, or sign up if this key is new and a name came with it. */
api.post('/auth/login', limit('login', 30, 10 * 60_000), (req, res) => {
  const pubkey = checkAuthEvent(req.body?.event, '/api/auth/login')
  let user = q.get<UserRow>('SELECT * FROM users WHERE pubkey = ?', pubkey)
  let created = false
  if (!user) {
    if (req.body?.name === undefined) throw new HttpError(404, 'no_account', 'no account for this key yet')
    const name = str(req.body.name, 'name', 32)
    const upi = req.body.upi ? cleanUpi(req.body.upi) : null
    if (req.body.upi && !upi) throw new HttpError(400, 'bad_upi', "that doesn't look like a UPI ID (like name@okhdfcbank)")
    const id = newId()
    // the legacy column wants a value; this one can never be presented
    q.run('INSERT INTO users (id, name, token_hash, created_at, pubkey, upi_id) VALUES (?,?,?,?,?,?)', id, name, `none:${hashToken(newToken())}`, Date.now(), pubkey, upi)
    user = q.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!
    created = true
  }
  const s = createSession(user.id, req.body?.label)
  res.status(created ? 201 : 200).json({ token: s.token, user: userView(user), created })
})

/** Accounts from before recovery phrases: attach an identity key to keep the same account. */
api.post('/auth/link', auth, limit('login', 30, 10 * 60_000), (req, res) => {
  const u = (req as Authed).user
  if (u.pubkey) throw new HttpError(409, 'already_linked', 'this account already has a key')
  const pubkey = checkAuthEvent(req.body?.event, '/api/auth/link')
  if (q.get('SELECT id FROM users WHERE pubkey = ?', pubkey)) throw new HttpError(409, 'key_in_use', 'that key belongs to another account')
  q.run('UPDATE users SET pubkey = ? WHERE id = ?', pubkey, u.id)
  // bind the key in every group this account is in, so its future signatures check out
  for (const m of q.all<MemberRow>('SELECT * FROM members WHERE user_id = ? AND pubkey IS NULL', u.id))
    appendAtomically(m.group_id, [{ data: { type: 'claim', memberId: m.id, pubkey }, refId: m.id }], () => {
      q.run('UPDATE members SET pubkey = ? WHERE id = ?', pubkey, m.id)
    })
  const s = createSession(u.id, req.body?.label)
  res.json({ token: s.token, user: freshUser(u.id) })
})

api.post('/auth/logout', auth, (req, res) => {
  const s = (req as Authed).session
  if (s) q.run('DELETE FROM sessions WHERE id = ?', s.id)
  res.json({ ok: true })
})

// ---------- me ----------

api.get('/me', auth, (req, res) => {
  res.json({ user: userView((req as Authed).user) })
})

/** Name and UPI ID. A new name shows in new groups; groups you're already in keep the name you joined with. */
api.patch('/me', auth, (req, res) => {
  const u = (req as Authed).user
  const b = req.body ?? {}
  const name = b.name !== undefined ? str(b.name, 'name', 32) : u.name
  let upi = u.upi_id
  if (b.upi !== undefined) {
    upi = b.upi === null || b.upi === '' ? null : cleanUpi(b.upi)
    if (b.upi && !upi) throw new HttpError(400, 'bad_upi', "that doesn't look like a UPI ID (like name@okhdfcbank)")
  }
  q.run('UPDATE users SET name = ?, upi_id = ? WHERE id = ?', name, upi, u.id)
  res.json({ user: freshUser(u.id) })
})

api.get('/me/sessions', auth, (req, res) => {
  const { user, session } = req as Authed
  const rows = q.all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen DESC', user.id, Date.now())
  res.json({ sessions: rows.map((s) => ({ id: s.id, label: s.label, createdAt: s.created_at, lastSeen: s.last_seen, current: s.id === session?.id })) })
})

api.delete('/me/sessions/:sid', auth, (req, res) => {
  const { user } = req as Authed
  q.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', P(req).sid, user.id)
  res.json({ ok: true })
})

/** Where SOL and USDT pay links send money. The wallet signs a message to prove the address is yours. */
api.get('/me/solana/message', auth, (req, res) => {
  const address = String(req.query.address ?? '')
  if (!isAddress(address)) throw new HttpError(400, 'bad_address', 'not a Solana address')
  res.json({ message: addressProofMessage((req as Authed).user.id, address) })
})

api.put('/me/solana', auth, limit('wallet', 12, 10 * 60_000), (req, res) => {
  const u = (req as Authed).user
  if (!config.solana.enabled) throw new HttpError(404, 'crypto_off', 'crypto payments are off on this server')
  const { address, signature } = req.body ?? {}
  if (!isAddress(address)) throw new HttpError(400, 'bad_address', 'not a Solana address')
  if (typeof signature !== 'string' || !checkAddressProof(u.id, address, signature)) throw new HttpError(400, 'bad_proof', "the wallet's signature doesn't prove this address")
  q.run('UPDATE users SET sol_address = ?, sol_verified_at = ? WHERE id = ?', address, Date.now(), u.id)
  res.json({ user: freshUser(u.id) })
})

api.delete('/me/solana', auth, (req, res) => {
  const u = (req as Authed).user
  q.run('UPDATE users SET sol_address = NULL, sol_verified_at = NULL WHERE id = ?', u.id)
  res.json({ user: freshUser(u.id) })
})

// ---------- groups ----------

api.get('/groups', auth, (req, res) => {
  const u = (req as Authed).user
  const mine = q.all<MemberRow>('SELECT * FROM members WHERE user_id = ?', u.id)
  const groups = mine
    .map((m) => {
      const s = loadGroupState(m.group_id)
      const users = usersOf(s.members)
      const live = s.expenses.filter((e) => !e.voided_at)
      const lastMsg = q.get<{ at: number | null }>('SELECT MAX(created_at) at FROM messages WHERE group_id = ?', m.group_id)?.at ?? 0
      const last = Math.max(s.group.created_at, lastMsg, ...live.slice(0, 1).map((e) => e.created_at), ...s.settlements.slice(0, 1).map((x) => x.created_at))
      const read = q.get<{ last_read: number }>('SELECT last_read FROM chat_reads WHERE member_id = ?', m.id)?.last_read ?? 0
      const unread =
        q.get<{ n: number }>("SELECT COUNT(*) n FROM messages WHERE group_id = ? AND id > ? AND deleted_at IS NULL AND (member_id IS NULL OR member_id != ?)", m.group_id, read, m.id)?.n ?? 0
      const toConfirm = q.get<{ n: number }>("SELECT COUNT(*) n FROM claims WHERE group_id = ? AND to_member = ? AND status = 'pending'", m.group_id, m.id)?.n ?? 0
      return {
        id: s.group.id,
        name: s.group.name,
        emoji: s.group.emoji,
        currency: s.currency,
        me: m.id,
        net: s.balances.net[m.id] ?? 0,
        members: s.members.map((x) => ({ id: x.id, name: x.name, joined: !!x.user_id, avatar: avatarUrl(x.user_id ? users.get(x.user_id) : null) })),
        expenseCount: live.length,
        total: live.reduce((a, e) => a + e.amount, 0),
        lastActivity: last,
        unread: Math.min(unread, 99),
        toConfirm,
        kitty: !!s.group.kitty_holder,
      }
    })
    .sort((a, b) => b.lastActivity - a.lastActivity)
  // friends who added you to their group, waiting for a yes
  const invites = q
    .all<MemberRow & { g_name: string; g_emoji: string; inviter: string | null }>(
      `SELECT m.*, g.name g_name, g.emoji g_emoji, (SELECT u.name FROM users u WHERE u.id = g.created_by) inviter
       FROM members m JOIN groups g ON g.id = m.group_id
       WHERE m.invited_user = ? AND m.user_id IS NULL AND NOT EXISTS (SELECT 1 FROM members x WHERE x.group_id = m.group_id AND x.user_id = ?)`,
      u.id,
      u.id,
    )
    .map((m) => ({ groupId: m.group_id, memberId: m.id, name: m.name, groupName: m.g_name, emoji: m.g_emoji, by: m.inviter }))
  res.json({ groups, invites })
})

api.post('/groups', auth, limit('groups', 30, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const b = req.body ?? {}
  const name = str(b.name, 'group name', 40)
  const emoji = str(b.emoji ?? '💸', 'emoji', 16)
  const currency = b.currency ?? 'INR'
  if (!isCurrency(currency)) throw new HttpError(400, 'bad_currency', 'pick a currency from the list')
  const typed: unknown[] = Array.isArray(b.members) ? b.members : []
  const names = startingMembers(u.name, typed.map((n) => str(n, 'member name', 32)))
  if (names.length > 50) throw new HttpError(400, 'too_many', 'max 50 people per group')
  const id = idFor(u, b.id)
  const memberIds: string[] = u.pubkey ? (Array.isArray(b.memberIds) ? b.memberIds : []) : names.map(() => newId())
  if (memberIds.length !== names.length || !memberIds.every((x) => typeof x === 'string' && ID_RE.test(x)) || new Set(memberIds).size !== names.length)
    throw new HttpError(409, 'signature_mismatch', 'member list changed while signing. Try again')
  const by = memberIds[0]
  const entries: EntryData[] = [
    { type: 'group', id, name, currency, emoji, by },
    ...names.map((n, position): EntryData => ({ type: 'member', id: memberIds[position], name: n, position, pubkey: position === 0 ? u.pubkey ?? undefined : undefined, by })),
  ]
  const sigs: unknown[] = Array.isArray(b.signed) ? b.signed : []
  const checked = entries.map((d, i) => memberSig(u, id, d, sigs[i]))
  if (q.get('SELECT id FROM groups WHERE id = ?', id)) throw new HttpError(409, 'id_taken', 'that id is taken, try again')
  const groupKey = randomBytes(32).toString('hex')
  appendAtomically(
    id,
    entries.map((data, i) => ({ data, refId: i ? memberIds[i - 1] : null, sig: checked[i] })),
    () => {
      const now = Date.now()
      q.run('INSERT INTO groups (id, name, emoji, currency, created_by, created_at, invite_code, group_key) VALUES (?,?,?,?,?,?,?,?)', id, name, emoji, currency, u.id, now, newToken(9), groupKey)
      names.forEach((n, position) =>
        q.run('INSERT INTO members (id, group_id, name, user_id, position, created_at, pubkey) VALUES (?,?,?,?,?,?,?)', memberIds[position], id, n, position === 0 ? u.id : null, position, now, position === 0 ? u.pubkey : null),
      )
    },
    groupKey,
  )
  res.status(201).json(full(id, memberOf(id, u.id)))
})

api.get('/groups/:id', auth, (req, res) => {
  const u = (req as Authed).user
  res.json(full(P(req).id, memberOf(P(req).id, u.id)))
})

api.patch('/groups/:id', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', P(req).id)!
  // name and emoji are local niceties; the ledger keeps what the group was created as
  const name = req.body?.name !== undefined ? str(req.body.name, 'group name', 40) : g.name
  const emoji = req.body?.emoji !== undefined ? str(req.body.emoji, 'emoji', 16) : g.emoji
  const simplify = req.body?.simplify !== undefined ? (req.body.simplify ? 1 : 0) : g.simplify
  q.run('UPDATE groups SET name = ?, emoji = ?, simplify = ? WHERE id = ?', name, emoji, simplify, g.id)
  res.json(full(g.id, me))
})

/** A leaked invite link stops working: the creator makes a new one. */
api.post('/groups/:id/invite/reset', auth, limit('invite_reset', 20, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', me.group_id)!
  if (g.created_by !== u.id) throw new HttpError(403, 'not_your_call', 'only whoever made the group can reset its invite link')
  q.run('UPDATE groups SET invite_code = ? WHERE id = ?', newToken(9), g.id)
  res.json(full(g.id, me))
})

/**
 * Add someone. By name (they can join later with the invite link), or a friend who already uses the
 * app by their account id: they get a "you were added" card and a push, and say yes with their own key.
 */
api.post('/groups/:id/members', auth, limit('add_member', 120, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  if (s.members.length >= 50) throw new HttpError(400, 'too_many', 'max 50 people per group')
  let friend: UserRow | undefined
  let name: string
  if (req.body?.userId !== undefined) {
    friend = typeof req.body.userId === 'string' ? q.get<UserRow>('SELECT * FROM users WHERE id = ?', req.body.userId) : undefined
    if (!friend) throw new HttpError(404, 'no_user', "couldn't find that person")
    if (s.members.some((m) => m.user_id === friend!.id || m.invited_user === friend!.id)) throw new HttpError(409, 'already_in', `${friend.name} is already in this group`)
    name = joinName(friend.name, s.members.map((m) => m.name))
  } else {
    name = str(req.body?.name, 'name', 32)
    if (s.members.some((m) => m.name.toLowerCase() === name.toLowerCase())) throw new HttpError(409, 'name_taken', `${name} is already in this group`)
  }
  const mid = idFor(u, req.body?.id)
  const data: EntryData = { type: 'member', id: mid, name, position: nextPosition(s.members.map((m) => m.position)), by: me.id }
  const sig = memberSig(u, s.group.id, data, req.body?.signed)
  appendAtomically(s.group.id, [{ data, refId: mid, sig }], () => {
    stillNext(s.group.id, data.position, name)
    q.run('INSERT INTO members (id, group_id, name, user_id, position, created_at, invited_user) VALUES (?,?,?,?,?,?,?)', mid, s.group.id, name, null, data.position, Date.now(), friend?.id ?? null)
  })
  postEvent(s.group.id, me.id, { t: 'added', member: mid }, `${me.name} added ${name}`)
  if (friend) pushMembers([{ user_id: friend.id }], { title: `${me.name} added you to ${s.group.name} ${s.group.emoji}`, body: 'Tap to join and see who owes what.', url: '/', tag: `invite-${s.group.id}` })
  res.status(201).json(full(s.group.id, me))
})

/** Say yes to a friend's "added you": a signed claim on the member they made for you. */
api.post('/groups/:id/accept', auth, (req, res) => {
  const u = (req as Authed).user
  const m = q.get<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', req.body?.memberId, P(req).id)
  if (!m || m.invited_user !== u.id) throw new HttpError(404, 'no_invite', 'that invite is gone')
  if (m.user_id) throw new HttpError(409, 'claimed', `${m.name} already joined`)
  if (q.get('SELECT id FROM members WHERE group_id = ? AND user_id = ?', m.group_id, u.id)) throw new HttpError(409, 'already_in', "you're already in this group")
  claimMember(u, m, req.body?.signed)
  res.json({ groupId: m.group_id, memberId: m.id })
})

api.post('/groups/:id/decline', auth, (req, res) => {
  const u = (req as Authed).user
  q.run('UPDATE members SET invited_user = NULL WHERE id = ? AND group_id = ? AND invited_user = ? AND user_id IS NULL', req.body?.memberId, P(req).id, u.id)
  res.json({ ok: true })
})

/** Bind an account to a member that was added by name. Signed by the account's key when it has one. */
function claimMember(u: UserRow, m: MemberRow, signed: unknown) {
  const data: EntryData | null = u.pubkey ? { type: 'claim', memberId: m.id, pubkey: u.pubkey } : null
  const sig = data ? memberSig(u, m.group_id, data, signed) : undefined
  appendAtomically(m.group_id, data ? [{ data, refId: m.id, sig }] : [], () => {
    if (q.run('UPDATE members SET user_id = ?, pubkey = ?, invited_user = NULL WHERE id = ? AND user_id IS NULL', u.id, u.pubkey, m.id).changes === 0)
      throw new HttpError(409, 'claimed', `${m.name} already joined`)
  })
  joined(m.group_id, m)
}

function joined(groupId: string, m: Pick<MemberRow, 'id' | 'name'>) {
  postEvent(groupId, m.id, { t: 'join', member: m.id }, `${m.name} joined`)
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', groupId)!
  const creator = q.get<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id = ?', groupId, g.created_by)
  if (creator && creator.id !== m.id) pushMembers([creator], { title: `${m.name} joined ${g.name} ${g.emoji}`, body: 'Now they can add bills and see who owes what.', url: `/g/${groupId}` }, `join:${groupId}`, 60_000)
}

// ---------- expenses ----------

api.post('/groups/:id/expenses', auth, limit('expense', 300, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const b = req.body ?? {}
  const description = str(b.description, 'what was it for', 80)
  const category = isCategory(b.category) ? b.category : 'other'
  if (!s.order.includes(b.paidBy)) throw new HttpError(400, 'bad_payer', 'who paid?')
  const kitty = b.kitty === true
  if (kitty && (!s.group.kitty_holder || b.paidBy !== s.group.kitty_holder)) throw new HttpError(400, 'bad_kitty', 'a kitty bill is paid by whoever holds the kitty')
  const split = b.split as SplitInput
  if (!split || typeof split !== 'object') throw new HttpError(400, 'bad_split', 'how should it be split?')
  let result
  try {
    result = computeSplit(split, split.mode === 'itemized' ? null : int(b.amount, 'amount'), s.order)
  } catch (e) {
    if (e instanceof SplitError) throw new HttpError(400, e.code, e.message)
    throw new HttpError(400, 'bad_split', (e as Error).message)
  }
  if (result.total > 10_000_000 * 10 ** CURRENCIES[s.currency].decimals) throw new HttpError(400, 'too_big', 'that bill is too big for one entry')
  const id = idFor(u, b.id)
  const data: EntryData = { type: 'expense', id, description, category, paidBy: b.paidBy, total: result.total, shares: result.shares, mode: split.mode, kitty: kitty || undefined, by: me.id }
  const sig = memberSig(u, s.group.id, data, b.signed)
  if (q.get('SELECT id FROM expenses WHERE id = ?', id)) throw new HttpError(409, 'id_taken', 'already saved')
  appendAtomically(s.group.id, [{ data, refId: id, sig }], () => {
    q.run(
      'INSERT INTO expenses (id, group_id, description, category, amount, paid_by, split_mode, split_json, shares_json, created_by, created_at, from_kitty) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id, s.group.id, description, category, result.total, b.paidBy, split.mode, JSON.stringify(split), JSON.stringify(result.shares), me.id, Date.now(), kitty ? 1 : 0,
    )
  })
  const amt = formatMoney(result.total, s.currency)
  postEvent(s.group.id, me.id, { t: 'expense', id, desc: description, amount: result.total, paidBy: b.paidBy, kitty: kitty || undefined }, `${me.name} added ${description}: ${amt}`)
  const inIt = s.members.filter((m) => m.id !== me.id && (result.shares[m.id] ?? 0) > 0)
  for (const m of inIt)
    pushMembers([m], { title: `${s.group.emoji} ${me.name} added ${description}`, body: `${amt} · your share ${formatMoney(result.shares[m.id], s.currency)}`, url: `/g/${s.group.id}`, tag: `exp-${s.group.id}` }, `exp:${s.group.id}`, 60_000)
  res.status(201).json({ id, ...full(s.group.id, me) })
})

/** The ledger is append-only: deleting an expense appends a void entry. */
api.post('/groups/:id/expenses/:eid/void', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const e = q.get<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', P(req).eid, P(req).id)
  if (!e) throw new HttpError(404, 'not_found', 'expense not found')
  if (e.voided_at) throw new HttpError(409, 'already_voided', 'already removed')
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', P(req).id)!
  if (e.created_by !== me.id && g.created_by !== u.id) throw new HttpError(403, 'not_yours', 'only whoever added it (or the group creator) can remove it')
  const data: EntryData = { type: 'void', expenseId: e.id, by: me.id }
  const sig = memberSig(u, g.id, data, req.body?.signed)
  appendAtomically(g.id, [{ data, refId: e.id, sig }], () => {
    if (q.run('UPDATE expenses SET voided_at = ?, voided_by = ? WHERE id = ? AND voided_at IS NULL', Date.now(), me.id, e.id).changes === 0)
      throw new HttpError(409, 'already_voided', 'already removed')
  })
  postEvent(g.id, me.id, { t: 'void', id: e.id, desc: e.description }, `${me.name} removed ${e.description}`)
  res.json(full(g.id, me))
})

// ---------- settlements recorded by hand: the payee's word ----------

/**
 * "Got it" (cash, UPI), and money into the kitty. It's the payee's word, so it's theirs to give;
 * if the payee never joined they can't confirm anything, so the payer may record it.
 */
api.post('/groups/:id/settlements', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const b = req.body ?? {}
  const method: 'manual' | 'upi' | 'kitty' = b.method === 'upi' || b.method === 'kitty' ? b.method : 'manual'
  const from = s.members.find((m) => m.id === b.from)
  const to = s.members.find((m) => m.id === b.to)
  if (!from || !to || (from.id === to.id && method !== 'kitty')) throw new HttpError(400, 'bad_pair', 'pick who paid whom')
  const amount = int(b.amount, 'amount')
  const note = b.note ? str(b.note, 'note', 60) : undefined
  const ref = b.ref ? cleanRef(b.ref) ?? undefined : undefined
  if (method === 'kitty') {
    if (s.group.kitty_holder !== to.id) throw new HttpError(400, 'bad_kitty', 'kitty money goes to whoever holds the kitty')
    if (to.user_id !== u.id) throw new HttpError(403, 'not_your_call', `only ${to.name}, who holds the kitty, can say money came in`)
    if (amount > 10_000_000 * 10 ** CURRENCIES[s.currency].decimals) throw new HttpError(400, 'too_big', 'that is too much for one entry')
  } else {
    const allowed = to.user_id ? to.user_id === u.id : from.user_id === u.id
    if (!allowed)
      throw new HttpError(403, 'not_your_call', to.user_id ? `only ${to.name} can mark this as paid, since they're the one getting the money` : `only ${from.name} can record paying ${to.name}`)
    const due = owed(s, from.id, to.id)
    if (due <= 0) throw new HttpError(409, 'nothing_owed', `${from.name} doesn't owe ${to.name} anything right now`)
    if (amount > due) throw new HttpError(400, 'too_much', `that's more than the ${formatMoney(due, s.currency)} owed`)
  }
  const id = idFor(u, b.id)
  const data: EntryData = { type: 'settlement', id, from: from.id, to: to.id, amount, method, note, ref, by: me.id }
  const sig = memberSig(u, s.group.id, data, b.signed)
  appendAtomically(s.group.id, [{ data, refId: id, sig }], () => {
    // re-check inside the lock: two "got it" taps at once must not settle more than is owed
    if (method !== 'kitty' && amount > owed(loadGroupState(s.group.id), from.id, to.id)) throw new HttpError(409, 'too_much', 'that was already settled')
    q.run(
      'INSERT INTO settlements (id, group_id, from_member, to_member, amount, method, note, recorded_by, created_at, ref) VALUES (?,?,?,?,?,?,?,?,?,?)',
      id, s.group.id, from.id, to.id, amount, method, note ?? null, me.id, Date.now(), ref ?? null,
    )
  })
  settled(s, from, to, amount, method, me.id)
  res.status(201).json({ id, ...full(s.group.id, me) })
})

/** After any settlement: a card in the chat, and a push to the payer if it wasn't them. */
export function settled(s: GroupState, from: MemberRow, to: MemberRow, amount: number, method: string, actor: string | null) {
  const amt = formatMoney(amount, s.currency)
  postEvent(s.group.id, actor, { t: 'paid', from: from.id, to: to.id, amount, method }, method === 'kitty' ? `${from.name} put ${amt} in the kitty` : `${from.name} paid ${to.name} ${amt}`)
  const tell = [from, to].filter((m) => m.id !== actor)
  for (const m of tell)
    pushMembers([m], {
      title: method === 'kitty' ? `${amt} in the kitty ${s.group.emoji}` : m.id === to.id ? `${from.name} paid you ${amt} 🤑` : `${to.name} confirmed your ${amt} ✅`,
      body: `${s.group.name}`,
      url: `/g/${s.group.id}`,
      tag: `paid-${s.group.id}-${from.id}`,
    })
}

// ---------- pay links ----------

api.post('/groups/:id/paylinks', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const from = s.members.find((m) => m.id === req.body?.from)
  const to = s.members.find((m) => m.id === req.body?.to)
  if (!from || !to || from.id === to.id) throw new HttpError(400, 'bad_pair', 'pick who pays whom')
  let link = q.get<{ token: string }>('SELECT token FROM paylinks WHERE group_id = ? AND from_member = ? AND to_member = ?', s.group.id, from.id, to.id)
  if (!link) {
    const token = newToken(12)
    q.run('INSERT INTO paylinks (token, group_id, from_member, to_member, created_by, created_at) VALUES (?,?,?,?,?,?)', token, s.group.id, from.id, to.id, me.id, Date.now())
    link = { token }
  }
  res.json({ token: link.token, path: `/p/${link.token}`, owed: owed(s, from.id, to.id) })
})

// ---------- history, backup, export ----------

api.get('/groups/:id/ledger', auth, (req, res) => {
  const u = (req as Authed).user
  memberOf(P(req).id, u.id)
  const rows = q.all<LedgerRow>('SELECT * FROM ledger WHERE group_id = ? ORDER BY seq', P(req).id)
  const names = new Map(q.all<MemberRow>('SELECT * FROM members WHERE group_id = ?', P(req).id).filter((m) => m.pubkey).map((m) => [m.pubkey!, m.name]))
  res.json({
    pubkey: serverPubkey,
    relays: config.relays,
    offsite: config.nostrEnabled,
    entries: rows.map((r) => ({
      seq: r.seq,
      type: r.type,
      refId: r.ref_id,
      eventId: r.event_id,
      relaysOk: JSON.parse(r.relays_ok),
      attempts: r.attempts,
      createdAt: r.created_at,
      signer: r.signer,
      signerName: r.signer ? names.get(r.signer) ?? null : null,
    })),
  })
})

api.get('/groups/:id/backup', auth, (req, res) => {
  const u = (req as Authed).user
  memberOf(P(req).id, u.id)
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', P(req).id)!
  res.json({ backup: encodeBackup({ k: g.group_key, pk: serverPubkey, r: config.relays }) })
})

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  // a leading = + - @ makes spreadsheets run it as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

const methodLabel = (x: SettlementRow) =>
  x.method === 'upi' ? 'UPI' : x.method === 'kitty' ? 'kitty' : x.method === 'solana' ? `crypto ${x.asset ?? ''}`.trim() : x.method === 'lightning' ? 'lightning' : 'cash/other'

/** Everything in the group as a spreadsheet. Amounts in major units of the group's currency. */
api.get('/groups/:id/export.csv', auth, (req, res) => {
  const u = (req as Authed).user
  memberOf(P(req).id, u.id)
  const s = loadGroupState(P(req).id)
  const name = new Map(s.members.map((m) => [m.id, m.name]))
  const major = (n: number) => (n / 10 ** CURRENCIES[s.currency].decimals).toFixed(CURRENCIES[s.currency].decimals)
  const rows: unknown[][] = [['date', 'type', 'description', 'category', 'amount', 'currency', 'paid by / from', 'to', 'method', 'reference', 'removed', ...s.members.map((m) => `share: ${m.name}`)]]
  for (const e of [...s.expenses].reverse()) {
    const shares = JSON.parse(e.shares_json) as Record<string, number>
    rows.push([new Date(e.created_at).toISOString(), e.from_kitty ? 'expense (kitty)' : 'expense', e.description, e.category, major(e.amount), s.currency, name.get(e.paid_by), '', e.split_mode, '', e.voided_at ? 'yes' : '', ...s.members.map((m) => (shares[m.id] ? major(shares[m.id]) : ''))])
  }
  for (const x of [...s.settlements].reverse())
    rows.push([new Date(x.created_at).toISOString(), 'payment', x.note ?? '', '', major(x.amount), s.currency, name.get(x.from_member), name.get(x.to_member), methodLabel(x), x.ref ?? x.tx_sig ?? '', '', ...s.members.map(() => '')])
  const file = `${s.group.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'group'}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`)
  res.send('﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'))
})

// ---------- invites: claim your name, or join as someone new ----------

api.get('/invites/:code', limit('invite', 120, 10 * 60_000), (req, res) => {
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', P(req).code)
  if (!g) throw new HttpError(404, 'bad_invite', 'this invite link is broken or old')
  const members = q.all<MemberRow>('SELECT * FROM members WHERE group_id = ? ORDER BY position', g.id)
  const users = usersOf(members)
  res.json({
    group: { id: g.id, name: g.name, emoji: g.emoji, currency: g.currency },
    members: members.map((m) => ({ id: m.id, name: m.name, joined: !!m.user_id, position: m.position, avatar: avatarUrl(m.user_id ? users.get(m.user_id) : null) })),
  })
})

api.post('/invites/:code/join', auth, (req, res) => {
  const u = (req as Authed).user
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', P(req).code)
  if (!g) throw new HttpError(404, 'bad_invite', 'this invite link is broken or old')
  const existing = q.get<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id = ?', g.id, u.id)
  if (existing) return res.json({ groupId: g.id, memberId: existing.id })
  const claim = req.body?.memberId as string | undefined
  let memberId: string
  if (claim) {
    const m = q.get<MemberRow>('SELECT * FROM members WHERE id = ? AND group_id = ?', claim, g.id)
    if (!m) throw new HttpError(404, 'not_found', "that name isn't in this group")
    if (m.user_id) throw new HttpError(409, 'claimed', `${m.name} already joined`)
    claimMember(u, m, req.body?.signed)
    memberId = m.id
  } else {
    const members = q.all<MemberRow>('SELECT * FROM members WHERE group_id = ?', g.id)
    if (members.length >= 50) throw new HttpError(400, 'too_many', 'group is full')
    memberId = idFor(u, req.body?.id)
    const data: EntryData = {
      type: 'member',
      id: memberId,
      name: joinName(u.name, members.map((m) => m.name)),
      position: nextPosition(members.map((m) => m.position)),
      pubkey: u.pubkey ?? undefined,
      by: memberId,
    }
    const sig = memberSig(u, g.id, data, req.body?.signed)
    appendAtomically(g.id, [{ data, refId: memberId, sig }], () => {
      stillNext(g.id, data.position, data.name)
      q.run('INSERT INTO members (id, group_id, name, user_id, position, created_at, pubkey) VALUES (?,?,?,?,?,?,?)', memberId, g.id, data.name, u.id, data.position, Date.now(), u.pubkey)
    })
    joined(g.id, { id: memberId, name: data.name })
  }
  res.json({ groupId: g.id, memberId })
})

// ---------- activity across all my groups ----------

api.get('/activity', auth, (req, res) => {
  const u = (req as Authed).user
  const mine = q.all<MemberRow>('SELECT * FROM members WHERE user_id = ?', u.id)
  if (!mine.length) return res.json({ items: [] })
  const ids = mine.map((m) => m.group_id)
  const ph = ids.map(() => '?').join(',')
  const groups = new Map(q.all<GroupRow>(`SELECT * FROM groups WHERE id IN (${ph})`, ...ids).map((g) => [g.id, g]))
  const names = new Map(q.all<MemberRow>(`SELECT * FROM members WHERE group_id IN (${ph})`, ...ids).map((m) => [m.id, m.name]))
  const meIn = new Map(mine.map((m) => [m.group_id, m.id]))
  const exps = q.all<ExpenseRow>(`SELECT * FROM expenses WHERE group_id IN (${ph}) ORDER BY created_at DESC LIMIT 80`, ...ids)
  const sets = q.all<SettlementRow>(`SELECT * FROM settlements WHERE group_id IN (${ph}) ORDER BY created_at DESC LIMIT 80`, ...ids)
  const items = [
    ...exps.map((e) => {
      const g = groups.get(e.group_id)!
      const me = meIn.get(e.group_id)!
      const shares = JSON.parse(e.shares_json) as Record<string, number>
      return {
        kind: 'expense' as const,
        id: e.id,
        groupId: g.id,
        groupName: g.name,
        groupEmoji: g.emoji,
        currency: g.currency,
        at: e.created_at,
        description: e.description,
        category: e.category,
        amount: e.amount,
        paidBy: names.get(e.paid_by),
        paidByMe: e.paid_by === me,
        myShare: shares[me] ?? 0,
        voided: !!e.voided_at,
        kitty: !!e.from_kitty,
      }
    }),
    ...sets.map((x) => {
      const g = groups.get(x.group_id)!
      const me = meIn.get(x.group_id)!
      return {
        kind: 'settlement' as const,
        id: x.id,
        groupId: g.id,
        groupName: g.name,
        groupEmoji: g.emoji,
        currency: g.currency,
        at: x.created_at,
        amount: x.amount,
        from: names.get(x.from_member),
        to: names.get(x.to_member),
        fromMe: x.from_member === me,
        toMe: x.to_member === me,
        method: x.method,
        note: x.note,
        ref: x.ref,
        sats: x.sats,
        asset: x.asset,
        base: x.base_amount,
        txSig: x.tx_sig,
        demo: !!x.demo,
      }
    }),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 100)
  res.json({ items })
})

// ---------- dues: everything I'm owed / I owe, across every group ----------

api.get('/dues', auth, (req, res) => {
  const u = (req as Authed).user
  const mine = q.all<MemberRow>('SELECT * FROM members WHERE user_id = ?', u.id)
  const groups = mine.flatMap((me) => {
    const s = loadGroupState(me.group_id)
    const users = usersOf(s.members)
    const person = (id: string) => {
      const m = s.members.find((x) => x.id === id)!
      const w = m.user_id ? users.get(m.user_id) : undefined
      return { id: m.id, name: m.name, joined: !!m.user_id, isMe: m.id === me.id, avatar: avatarUrl(w), upi: w?.upi_id ?? null, sol: !!(config.solana.enabled && w?.sol_address) }
    }
    const transfers = s.balances.plan.filter((t) => t.from === me.id || t.to === me.id).map((t) => ({ from: person(t.from), to: person(t.to), amount: t.amount }))
    const claims = q
      .all<ClaimRow>("SELECT * FROM claims WHERE group_id = ? AND status = 'pending' AND (to_member = ? OR from_member = ?) ORDER BY created_at DESC", s.group.id, me.id, me.id)
      .map((c) => ({ ...claimView(c), from: person(c.from_member), to: person(c.to_member) }))
    if (!transfers.length && !claims.length) return []
    return [{ groupId: s.group.id, groupName: s.group.name, emoji: s.group.emoji, currency: s.currency, me: me.id, transfers, claims }]
  })
  res.json({ groups })
})

