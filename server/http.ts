import type { Request } from 'express'
import type { Event as NostrEvent } from 'nostr-tools/pure'
import { ID_RE, cleanText } from '../shared/canon'
import { checkMemberSig, type EntryData } from '../shared/ledger'
import { nextPosition } from '../shared/rules'
import { newId } from './crypto'
import { q, type MemberRow, type UserRow } from './db'
import { HttpError } from './state'

// Small pieces every router uses: input checks, member signatures, and how people look to others.

export const P = (req: Request) => req.params as Record<string, string>

export const str = (v: unknown, field: string, max: number, min = 1) => {
  if (typeof v !== 'string') throw new HttpError(400, 'bad_input', `${field} is required`)
  const s = cleanText(v)
  if (s.length < min) throw new HttpError(400, 'bad_input', `${field} is required`)
  if (s.length > max) throw new HttpError(400, 'bad_input', `${field} is too long (max ${max})`)
  return s
}

export const int = (v: unknown, field: string) => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new HttpError(400, 'bad_amount', `${field} must be a whole number above zero`)
  return v
}

/** Accounts with an identity key name their own ids (they sign them). Older accounts get one from us. */
export function idFor(u: UserRow, v: unknown) {
  if (v === undefined || v === null) {
    if (u.pubkey) throw new HttpError(400, 'id_required', 'missing id for a signed change')
    return newId()
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'bad_id', 'malformed id')
  return v
}

/**
 * The member's own signature over exactly this change. Required from every account that has an
 * identity key; accounts from before recovery phrases write server-attested entries.
 */
export function memberSig(u: UserRow, groupId: string, data: EntryData, sig: unknown): NostrEvent | undefined {
  if (!u.pubkey) return undefined
  if (!sig) throw new HttpError(400, 'signature_required', 'this change needs your signature. Update the app and try again')
  const signer = checkMemberSig(sig, groupId, data)
  if (!signer) throw new HttpError(409, 'signature_mismatch', "your signature doesn't match this change. Refresh and try again")
  if (signer !== u.pubkey) throw new HttpError(403, 'wrong_key', "that's signed with a key that isn't yours")
  return sig as NostrEvent
}

/** Inside a write: someone may have joined since we read. A signed position can't be renumbered, so ask again. */
export function stillNext(groupId: string, position: number, name: string) {
  const rows = q.all<{ position: number; name: string }>('SELECT position, name FROM members WHERE group_id = ?', groupId)
  if (nextPosition(rows.map((r) => r.position)) !== position || rows.some((r) => r.name.toLowerCase() === name.toLowerCase()))
    throw new HttpError(409, 'group_changed', 'the group changed while you were typing. Try again')
}

export function memberOf(groupId: string, userId: string) {
  const m = q.get<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id = ?', groupId, userId)
  if (!m) throw new HttpError(403, 'not_member', "you're not in this group")
  return m
}

/** Versioned, so a new photo is a new URL and the old one can be cached forever. */
export const avatarUrl = (u: Pick<UserRow, 'id' | 'avatar_v'> | null | undefined) => (u && u.avatar_v > 0 ? `/api/avatars/${u.id}/${u.avatar_v}` : null)

export const userView = (u: UserRow) => ({
  id: u.id,
  name: u.name,
  createdAt: u.created_at,
  pubkey: u.pubkey,
  solAddress: u.sol_address,
  upi: u.upi_id,
  avatar: avatarUrl(u),
})

export const freshUser = (id: string) => userView(q.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!)

type Face = Pick<UserRow, 'id' | 'name' | 'avatar_v' | 'upi_id' | 'sol_address'>

/** The accounts behind a group's joined members, in one query. */
export function usersOf(members: Pick<MemberRow, 'user_id'>[]) {
  const ids = [...new Set(members.map((m) => m.user_id).filter(Boolean) as string[])]
  if (!ids.length) return new Map<string, Face>()
  const rows = q.all<Face>(`SELECT id, name, avatar_v, upi_id, sol_address FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)
  return new Map(rows.map((r) => [r.id, r]))
}
