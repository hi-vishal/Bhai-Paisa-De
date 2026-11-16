// The off-site copy of a group's ledger: encrypted, signed, hash-chained entries on public
// relays. Shared by the server (writes it), the browser ("check a backup") and
// `npm run ledger:verify` (rebuilds balances with no server).

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import * as nip44 from 'nostr-tools/nip44'
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { debtsFor, type LedgerExpense, type LedgerSettlement } from './balances'
import { canon } from './canon'
import { isCurrency, type Asset, type CurrencyCode } from './money'

/** 0x1337. A regular (stored, non-replaceable) event kind. */
export const LEDGER_KIND = 4919
/** A member's own signature over one entry. Never published alone: it rides inside the encrypted entry. */
export const MEMBER_SIG_KIND = 4920
export const DEFAULT_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']

/** `by` is the member who made the change. When the entry carries a member signature, it must be theirs. */
export type EntryData =
  | { type: 'group'; id: string; name: string; currency: CurrencyCode; emoji: string; by?: string }
  | { type: 'member'; id: string; name: string; position: number; pubkey?: string; by?: string }
  /** someone claimed a name that was added for them; binds their identity key to that member */
  | { type: 'claim'; memberId: string; pubkey: string }
  | {
      type: 'expense'
      id: string
      description: string
      category: string
      paidBy: string
      total: number
      shares: Record<string, number>
      mode: string
      /** paid out of the group kitty (the kitty holder is the payer) */
      kitty?: boolean
      by?: string
    }
  | { type: 'void'; expenseId: string; by?: string }
  | {
      type: 'settlement'
      id: string
      from: string
      to: string
      amount: number
      /** upi/manual: the payee's word. kitty: money put into the group kitty. solana: on-chain proof. lightning: older entries */
      method: SettlementMethod
      note?: string
      /** UPI reference number (UTR), when the payer gave one */
      ref?: string
      /** Lightning */
      sats?: number
      paymentHash?: string
      preimage?: string
      /** Solana: what moved on chain, in base units, and the transaction that moved it */
      asset?: Asset
      base?: string
      txSig?: string
      demo?: boolean
      by?: string
    }

export type SettlementMethod = 'upi' | 'manual' | 'kitty' | 'solana' | 'lightning'

/** v1: server-signed only. v2 adds `sig`, the member's own signed event over {g, data}. */
export type Entry = { v: 1 | 2; seq: number; prev: string | null; at: number; data: EntryData; sig?: NostrEvent }

/** What a member signs: the group id and the exact entry data, as canonical JSON. */
export const memberSigContent = (groupId: string, data: EntryData) => canon({ app: 'bhai-paise-de', g: groupId, data })

/** Does this signed event say exactly `data`, for this group? Returns the signer pubkey or null. */
export function checkMemberSig(sig: unknown, groupId: string, data: EntryData): string | null {
  const ev = sig as NostrEvent
  if (!ev || typeof ev !== 'object' || ev.kind !== MEMBER_SIG_KIND || typeof ev.content !== 'string') return null
  if (!verifyEvent(ev)) return null
  return ev.content === memberSigContent(groupId, data) ? ev.pubkey : null
}

export function groupKeys(groupKeyHex: string) {
  const key = hexToBytes(groupKeyHex)
  const derive = (label: string) => sha256(new Uint8Array([...utf8ToBytes(label), ...key]))
  return {
    /** what relays see: a per-group tag that reveals nothing about the group */
    tag: bytesToHex(derive('bhai-paise-de/v1/tag')).slice(0, 32),
    convKey: derive('bhai-paise-de/v1/nip44'),
  }
}

export const encryptEntry = (entry: Entry, convKey: Uint8Array) => nip44.v2.encrypt(JSON.stringify(entry), convKey)
export const decryptEntry = (content: string, convKey: Uint8Array) => JSON.parse(nip44.v2.decrypt(content, convKey)) as Entry

export type Backup = { k: string; pk: string; r: string[] }

const b64url = {
  enc: (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)),
}

/** The string the group screen copies. Group key + server pubkey + relays. */
export const encodeBackup = (b: Backup) => 'bpd1' + b64url.enc(JSON.stringify(b))

export function decodeBackup(s: string): Backup {
  const t = s.trim()
  if (!t.startsWith('bpd1')) throw new Error('Not a Bhai Paise De backup key (should start with bpd1)')
  const b = JSON.parse(b64url.dec(t.slice(4))) as Backup
  if (!/^[0-9a-f]{64}$/.test(b.k) || !/^[0-9a-f]{64}$/.test(b.pk) || !Array.isArray(b.r)) throw new Error('Backup key is damaged')
  return b
}

export const sha256Hex = (hex: string) => bytesToHex(sha256(hexToBytes(hex)))

export type CheckedEntry = Entry & { eventId: string; signer: string | null }

export type ChainReport = {
  entries: CheckedEntry[]
  problems: string[]
  /** entries carrying a valid signature from the member who made them */
  memberSigned: number
  ok: boolean
}

/**
 * Check server signatures, decrypt, and walk the hash chain: a missing or swapped entry shows
 * up as a problem. Then check member signatures: an entry that claims to be signed by a member
 * must be signed by the key that member registered when they joined.
 */
export function verifyChain(events: NostrEvent[], backup: Backup): ChainReport {
  const { convKey } = groupKeys(backup.k)
  const problems: string[] = []
  const bySeq = new Map<number, CheckedEntry>()
  for (const ev of events) {
    if (ev.pubkey !== backup.pk) continue
    if (!verifyEvent(ev)) {
      problems.push(`event ${ev.id.slice(0, 8)} has a bad signature`)
      continue
    }
    let entry: Entry
    try {
      entry = decryptEntry(ev.content, convKey)
    } catch {
      problems.push(`event ${ev.id.slice(0, 8)} could not be decrypted with this key`)
      continue
    }
    const seen = bySeq.get(entry.seq)
    if (seen && seen.eventId !== ev.id) problems.push(`two different entries claim position #${entry.seq}`)
    else bySeq.set(entry.seq, { ...entry, eventId: ev.id, signer: null })
  }
  const entries = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  const head = entries.length ? entries[entries.length - 1].seq : -1
  for (let s = 0; s <= head; s++) {
    const e = bySeq.get(s)
    if (!e) {
      problems.push(`entry #${s} is missing from every relay`)
      continue
    }
    const prev = bySeq.get(s - 1)
    if (s === 0 && e.prev !== null) problems.push('first entry points at something before it')
    if (s > 0 && prev && e.prev !== prev.eventId) problems.push(`entry #${s} doesn't link to entry #${s - 1}`)
  }
  if (!entries.length) problems.push('no entries found on these relays')

  // member signatures: first learn which key belongs to which member, then check every signed entry
  const g = entries.find((e) => e.data.type === 'group')?.data
  const gid = g?.type === 'group' ? g.id : ''
  const keyOf = new Map<string, string>()
  for (const e of entries) {
    const d = e.data
    if (d.type === 'member' && d.pubkey && !keyOf.has(d.id)) keyOf.set(d.id, d.pubkey)
    if (d.type === 'claim') {
      if (keyOf.has(d.memberId)) problems.push(`entry #${e.seq} claims a member who already has a key`)
      else keyOf.set(d.memberId, d.pubkey)
    }
  }
  let memberSigned = 0
  for (const e of entries) {
    if (!e.sig) continue
    const d = e.data
    const signer = checkMemberSig(e.sig, gid, d)
    if (!signer) {
      problems.push(`entry #${e.seq} carries a member signature that doesn't match its contents`)
      continue
    }
    const actor = d.type === 'claim' ? d.memberId : d.by
    if (!actor || keyOf.get(actor) !== signer) {
      problems.push(`entry #${e.seq} is signed by a key that doesn't belong to the member who made it`)
      continue
    }
    e.signer = signer
    memberSigned++
  }
  return { entries, problems, memberSigned, ok: problems.length === 0 }
}

export type Rebuilt = {
  group: { id: string; name: string; currency: CurrencyCode; emoji: string } | null
  members: { id: string; name: string; position: number }[]
  expenses: (LedgerExpense & { description: string; category: string; kitty?: boolean; at: number })[]
  settlements: (LedgerSettlement & { method: string; note?: string; ref?: string; sats?: number; asset?: Asset; base?: string; txSig?: string; demo?: boolean; at: number })[]
}

export function rebuild(entries: Entry[]): Rebuilt & ReturnType<typeof debtsFor> {
  const r: Rebuilt = { group: null, members: [], expenses: [], settlements: [] }
  const voided = new Set<string>()
  for (const { data, at } of entries) {
    if (data.type === 'group') r.group = { id: data.id, name: data.name, currency: isCurrency(data.currency) ? data.currency : 'INR', emoji: data.emoji }
    else if (data.type === 'member') r.members.push({ id: data.id, name: data.name, position: data.position })
    else if (data.type === 'expense')
      r.expenses.push({ id: data.id, paidBy: data.paidBy, total: data.total, shares: data.shares, description: data.description, category: data.category, kitty: data.kitty, at })
    else if (data.type === 'void') voided.add(data.expenseId)
    else if (data.type === 'settlement')
      r.settlements.push({
        id: data.id,
        from: data.from,
        to: data.to,
        amount: data.amount,
        method: data.method,
        note: data.note,
        ref: data.ref,
        sats: data.sats,
        asset: data.asset,
        base: data.base,
        txSig: data.txSig,
        demo: data.demo,
        at,
      })
  }
  for (const e of r.expenses) e.voided = voided.has(e.id)
  r.members.sort((a, b) => a.position - b.position)
  const order = r.members.map((m) => m.id)
  return { ...r, ...debtsFor(true, order, r.expenses, r.settlements) }
}
