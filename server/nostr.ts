import { finalizeEvent, getPublicKey, type Event as NostrEvent } from 'nostr-tools/pure'
import { SimplePool, useWebSocketImplementation } from 'nostr-tools/pool'
import WebSocket from 'ws'
import { hexToBytes } from '@noble/hashes/utils.js'
import { encryptEntry, groupKeys, LEDGER_KIND, type Entry, type EntryData } from '../shared/ledger'
import { config } from './config'
import { q, tx, type GroupRow, type LedgerRow } from './db'

// Node's built-in WebSocket fires 'error' again, synchronously, when a socket that never connected
// is closed; the relay library closes on error, so one unreachable relay recursed until the stack
// overflowed and took the process down. The `ws` package doesn't do that.
useWebSocketImplementation(WebSocket)

const sk = hexToBytes(config.nostrSecret)
export const serverPubkey = getPublicKey(sk)
const pool = new SimplePool()

// group_key never changes, so the derived tag/conversation key are computed once per group
const keyCache = new Map<string, ReturnType<typeof groupKeys>>()
function keysFor(groupId: string, groupKey?: string) {
  let k = keyCache.get(groupId)
  if (!k) {
    const hex = groupKey ?? q.get<GroupRow>('SELECT group_key FROM groups WHERE id = ?', groupId)?.group_key
    if (!hex) throw new Error('group not found')
    k = groupKeys(hex)
    if (keyCache.size > 5000) keyCache.clear()
    keyCache.set(groupId, k)
  }
  return k
}

export type NewEntry = { data: EntryData; refId?: string | null; sig?: NostrEvent }
type Pending = { groupId: string; seq: number; prev: string | null; at: number; type: string; refId: string | null; ev: NostrEvent; signer: string | null }

/** Someone else extended this group's chain between our read and our write. */
export class ChainMoved extends Error {}

/**
 * Build, encrypt and sign entries against the chain head as it is right now. This is the slow
 * part (a Schnorr signature is ~1.5 ms of pure CPU), so it runs before any write lock is taken.
 */
function prepare(groupId: string, items: NewEntry[], groupKey?: string): Pending[] {
  const { tag, convKey } = keysFor(groupId, groupKey)
  const last = q.get<{ seq: number; event_id: string }>('SELECT seq, event_id FROM ledger WHERE group_id = ? ORDER BY seq DESC LIMIT 1', groupId)
  let seq = last ? last.seq + 1 : 0
  let prev = last?.event_id ?? null
  return items.map(({ data, refId = null, sig }) => {
    const at = Date.now()
    const entry: Entry = { v: 2, seq, prev, at, data, sig }
    const ev = finalizeEvent(
      {
        kind: LEDGER_KIND,
        created_at: Math.floor(at / 1000),
        tags: [
          ['t', tag],
          ['alt', 'Encrypted group ledger entry'],
        ],
        content: encryptEntry(entry, convKey),
      },
      sk,
    )
    const p: Pending = { groupId, seq, prev, at, type: data.type, refId, ev, signer: sig?.pubkey ?? null }
    prev = ev.id
    seq++
    return p
  })
}

/** Inside the write transaction: a compare-and-swap on the chain head, then the inserts. */
function commit(pending: Pending[]) {
  if (!pending.length) return
  const head = q.get<{ event_id: string }>('SELECT event_id FROM ledger WHERE group_id = ? ORDER BY seq DESC LIMIT 1', pending[0].groupId)
  if ((head?.event_id ?? null) !== pending[0].prev) throw new ChainMoved()
  for (const p of pending)
    q.run(
      'INSERT INTO ledger (group_id, seq, type, ref_id, event_id, event_json, created_at, signer) VALUES (?,?,?,?,?,?,?,?)',
      p.groupId, p.seq, p.type, p.refId, p.ev.id, JSON.stringify(p.ev), p.at, p.signer,
    )
}

/**
 * Write rows and append their ledger entries atomically, with optimistic concurrency:
 * sign outside the lock, then inside one short transaction run `write` and append only if the
 * chain head is still the one we signed against; if another writer got there first, re-sign
 * and retry. Writes to different groups never conflict. `write` returning false skips the
 * append (and its rows), e.g. when a payment turned out to be settled already.
 *
 * `groupKey` is for a group being created in this same write.
 */
export function appendAtomically<T>(groupId: string, items: NewEntry[], write: () => T | false, groupKey?: string): T | false {
  for (let attempt = 0; ; attempt++) {
    const pending = prepare(groupId, items, groupKey)
    try {
      const out = tx(() => {
        const r = write()
        if (r !== false) commit(pending)
        return r
      })
      if (out !== false && publisherHere) setImmediate(kick)
      return out
    } catch (e) {
      if (!(e instanceof ChainMoved) || attempt >= 6) throw e
    }
  }
}

// Only one process publishes. Other workers just write rows; the publisher polls for them.
let publisherHere = false
let running = false
let again = false
let fails = 0
let quietUntil = 0
async function kick() {
  if (!config.nostrEnabled || Date.now() < quietUntil) return
  if (running) return void (again = true)
  running = true
  again = false
  try {
    const rows = q.all<LedgerRow>("SELECT * FROM ledger WHERE relays_ok = '[]' AND attempts < 200 ORDER BY id LIMIT 50")
    let landed = 0
    for (const row of rows) {
      const ev = JSON.parse(row.event_json) as NostrEvent
      const results = await Promise.allSettled(pool.publish(config.relays, ev, { maxWait: 6000 }))
      const ok = config.relays.filter((_, i) => results[i]?.status === 'fulfilled')
      if (ok.length) landed++
      q.run('UPDATE ledger SET relays_ok = ?, attempts = attempts + 1 WHERE id = ?', JSON.stringify(ok), row.id)
    }
    // every relay refusing everything: back off (3s, 6s, 12s … 5 min) instead of hammering them
    if (rows.length && !landed) quietUntil = Date.now() + Math.min(300_000, 3000 * 2 ** Math.min(fails++, 7))
    else fails = 0
  } catch (e) {
    console.warn('[nostr] publish round failed:', (e as Error).message)
  } finally {
    running = false
    if (again) setImmediate(kick)
  }
}

export function startPublisher() {
  if (!config.nostrEnabled) return
  publisherHere = true
  setInterval(kick, 3_000).unref()
  setTimeout(kick, 500)
}

export function stopPublisher() {
  pool.close(config.relays)
}
