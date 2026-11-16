import { Router } from 'express'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { amountReceived, accountKeys, associatedTokenAddress, toBytes, type RpcTransaction } from '../shared/solana'
import { auth, limit } from './auth'
import { config } from './config'
import { HttpError } from './state'

export class RpcError extends Error {
  constructor(message: string, public code?: number) {
    super(message)
  }
}

let seq = 0

/** One JSON-RPC call to the configured Solana node. The URL (and any API key in it) never leaves the server. */
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(config.solana.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new RpcError(`solana rpc http ${res.status}`, res.status)
  const body = (await res.json()) as { result?: T; error?: { message: string; code: number } }
  if (body.error) throw new RpcError(body.error.message, body.error.code)
  return body.result as T
}

/** Many calls, one HTTP request. Each slot is a result or an RpcError. */
export async function rpcBatch<T>(calls: { method: string; params: unknown[] }[]): Promise<(T | RpcError)[]> {
  if (!calls.length) return []
  const base = seq
  seq += calls.length
  const res = await fetch(config.solana.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: base + i + 1, method: c.method, params: c.params }))),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new RpcError(`solana rpc http ${res.status}`, res.status)
  const body = (await res.json()) as { id: number; result?: T; error?: { message: string; code: number } }[]
  const byId = new Map(body.map((r) => [r.id, r]))
  return calls.map((_, i) => {
    const r = byId.get(base + i + 1)
    if (!r) return new RpcError('missing response')
    return r.error ? new RpcError(r.error.message, r.error.code) : (r.result as T)
  })
}

// ---------- finding a Solana Pay payment ----------

type SigInfo = { signature: string; err: unknown; blockTime?: number | null }
export type Found = { signature: string | null; received: bigint; blockTime: number | null }
export type Watch = {
  /** Solana Pay reference: wallets that follow the spec put it in the transaction */
  reference: string
  recipient: string
  mint?: string
  /** exact amount asked for; matches transfers from exchanges, which drop the reference */
  exact: bigint
  /** quote creation time (ms); older transfers are ignored */
  since: number
}

// getTransaction answers never change once confirmed; remember a few hundred
const txCache = new Map<string, RpcTransaction>()
const remember = (sig: string, tx: RpcTransaction) => {
  txCache.set(sig, tx)
  if (txCache.size > 500) txCache.delete(txCache.keys().next().value!)
}

async function fetchTxs(sigs: string[]) {
  const { commitment } = config.solana
  const missing = [...new Set(sigs)].filter((s) => !txCache.has(s))
  const got = await rpcBatch<RpcTransaction | null>(missing.map((sig) => ({ method: 'getTransaction', params: [sig, { encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0 }] })))
  got.forEach((tx, i) => tx && !(tx instanceof RpcError) && remember(missing[i], tx))
  return (sig: string) => txCache.get(sig) ?? null
}

/**
 * For each watched quote, find a confirmed transaction that paid it:
 *  1. by its Solana Pay reference key (any amount; partial payments are counted pro rata), or
 *  2. by the exact amount arriving at the recipient after the quote was made, for people who
 *     copy the address and amount into an exchange withdrawal.
 * Balance deltas decide, so any wallet's transaction shape works.
 */
export async function findPayments(watches: Watch[], taken: (sig: string) => boolean = () => false): Promise<(Found | null)[]> {
  const { commitment } = config.solana
  const out: (Found | null)[] = watches.map(() => null)
  if (!watches.length) return out

  const byRef = await rpcBatch<SigInfo[]>(watches.map((w) => ({ method: 'getSignaturesForAddress', params: [w.reference, { limit: 10, commitment }] })))
  const refSigs = byRef.flatMap((l, i) => (l instanceof RpcError ? [] : l.filter((x) => !x.err).map((x) => ({ i, sig: x.signature }))))
  const tx1 = await fetchTxs(refSigs.map((r) => r.sig))
  for (const { i, sig } of refSigs) {
    const tx = tx1(sig)
    const w = watches[i]
    if (!tx || out[i] || taken(sig) || !accountKeys(tx).includes(w.reference)) continue
    const received = amountReceived(tx, w.recipient, w.mint)
    if (received > 0n) out[i] = { signature: sig, received, blockTime: tx.blockTime }
  }

  // exact-amount fallback, one address listing per recipient
  const open = watches.map((w, i) => ({ w, i })).filter(({ i }) => !out[i])
  if (!open.length) return out
  const addrOf = (w: Watch) => (w.mint ? associatedTokenAddress(w.recipient, w.mint) : w.recipient)
  const addrs = [...new Set(open.map(({ w }) => addrOf(w)))]
  const lists = await rpcBatch<SigInfo[]>(addrs.map((a) => ({ method: 'getSignaturesForAddress', params: [a, { limit: 25, commitment }] })))
  const recent = new Map(addrs.map((a, k) => [a, lists[k] instanceof RpcError ? [] : (lists[k] as SigInfo[]).filter((x) => !x.err)]))
  const oldest = Math.min(...open.map(({ w }) => w.since)) / 1000 - 60
  const cand = [...recent.values()].flat().filter((x) => (x.blockTime ?? Infinity) >= oldest)
  const tx2 = await fetchTxs(cand.map((x) => x.signature))
  const used = new Set(out.filter(Boolean).map((f) => f!.signature))
  for (const { w, i } of open.sort((a, b) => a.w.since - b.w.since)) {
    for (const x of recent.get(addrOf(w)) ?? []) {
      if (used.has(x.signature) || taken(x.signature) || (x.blockTime ?? Infinity) < w.since / 1000 - 60) continue
      const tx = tx2(x.signature)
      if (!tx || amountReceived(tx, w.recipient, w.mint) !== w.exact) continue
      out[i] = { signature: x.signature, received: w.exact, blockTime: tx.blockTime }
      used.add(x.signature)
      break
    }
  }
  return out
}

// ---------- proving you own an address ----------

export const addressProofMessage = (userId: string, address: string) => `Bhai Paise De: payments for account ${userId} go to ${address}`

/** The wallet signs a fixed message with its ed25519 key; that's proof the address is really yours. */
export function checkAddressProof(userId: string, address: string, signature: string) {
  try {
    return ed25519.verify(base58.decode(signature), utf8ToBytes(addressProofMessage(userId, address)), toBytes(address))
  } catch {
    return false
  }
}

// ---------- the in-app wallet talks to Solana through us ----------

// Read-only calls plus sendTransaction. Nothing that lets a caller spend through the server:
// transactions arrive already signed by the user's own key.
const ALLOWED = new Set([
  'getBalance',
  'getTokenAccountsByOwner',
  'getLatestBlockhash',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getTransaction',
  'getAccountInfo',
  'getMinimumBalanceForRentExemption',
  'getFeeForMessage',
  'simulateTransaction',
  'sendTransaction',
])

export const solana = Router()

solana.post('/rpc', auth, limit('sol-rpc', 240, 60_000), async (req, res) => {
  if (!config.solana.enabled) throw new HttpError(404, 'solana_off', 'Solana is turned off on this server')
  const { method, params } = req.body ?? {}
  if (typeof method !== 'string' || !ALLOWED.has(method)) throw new HttpError(400, 'rpc_method', `method not allowed: ${String(method).slice(0, 40)}`)
  if (!Array.isArray(params) || JSON.stringify(params).length > 8_000) throw new HttpError(400, 'rpc_params', 'bad params')
  try {
    res.json({ result: await rpc(method, params) })
  } catch (e) {
    if (e instanceof RpcError) return res.status(e.code && e.code >= 400 && e.code < 600 ? 502 : 400).json({ error: 'rpc_error', message: e.message, code: e.code })
    throw new HttpError(502, 'rpc_unreachable', "couldn't reach the Solana network")
  }
})
