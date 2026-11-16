// Just enough Solana to send and check a payment, with no web3.js:
// base58 addresses, program-derived addresses, a legacy transaction builder,
// Solana Pay transfer-request URLs, and "did this transaction pay that address?".
// The tests check every byte of it against @solana/web3.js and @solana/spl-token.

import { base58 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { ed25519 } from '@noble/curves/ed25519.js'

export const PROGRAMS = {
  system: '11111111111111111111111111111111',
  token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  computeBudget: 'ComputeBudget111111111111111111111111111111',
} as const

/** Tether on Solana mainnet (6 decimals). */
export const USDT_MAINNET = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'
/** Circle's devnet USDC: free from faucet.circle.com, stands in for USDT on devnet. */
export const STABLE_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'

export type Cluster = 'mainnet-beta' | 'devnet' | 'testnet'

// ---------- addresses ----------

export function toBytes(address: string): Uint8Array {
  const b = base58.decode(address)
  if (b.length !== 32) throw new Error(`not a Solana address: ${address}`)
  return b
}

export const toAddress = (b: Uint8Array) => base58.encode(b)

export function isAddress(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 32 || s.length > 44) return false
  try {
    return base58.decode(s).length === 32
  } catch {
    return false
  }
}

export function isOnCurve(b: Uint8Array) {
  try {
    ed25519.Point.fromBytes(b)
    return true
  } catch {
    return false
  }
}

const PDA_MARKER = utf8ToBytes('ProgramDerivedAddress')

/** findProgramAddress: the first bump (255 down) whose hash lands off the curve. */
export function findPda(seeds: Uint8Array[], programId: string): [string, number] {
  const program = toBytes(programId)
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(concat(...seeds, new Uint8Array([bump]), program, PDA_MARKER))
    if (!isOnCurve(h)) return [toAddress(h), bump]
  }
  throw new Error('no viable bump seed')
}

/** The token account a wallet uses for a mint. */
export const associatedTokenAddress = (owner: string, mint: string) => findPda([toBytes(owner), toBytes(PROGRAMS.token), toBytes(mint)], PROGRAMS.ata)[0]

/** A fresh random public key, used as a Solana Pay `reference` to find a payment on chain. */
export const newReference = () => toAddress(ed25519.getPublicKey(ed25519.utils.randomSecretKey()))

// ---------- instructions ----------

export type AccountMeta = { pubkey: string; signer: boolean; writable: boolean }
export type Instruction = { programId: string; keys: AccountMeta[]; data: Uint8Array }

const ro = (pubkey: string): AccountMeta => ({ pubkey, signer: false, writable: false })

function bytes(n: number, fill: (v: DataView) => void) {
  const out = new Uint8Array(n)
  fill(new DataView(out.buffer))
  return out
}

/** System program Transfer (index 2). Extra read-only keys are Solana Pay references. */
export function transferSol(from: string, to: string, lamports: bigint, references: string[] = []): Instruction {
  return {
    programId: PROGRAMS.system,
    keys: [{ pubkey: from, signer: true, writable: true }, { pubkey: to, signer: false, writable: true }, ...references.map(ro)],
    data: bytes(12, (v) => {
      v.setUint32(0, 2, true)
      v.setBigUint64(4, lamports, true)
    }),
  }
}

/** SPL Token TransferChecked (index 12): checks mint and decimals on chain. */
export function transferChecked(source: string, mint: string, dest: string, owner: string, amount: bigint, decimals: number, references: string[] = []): Instruction {
  return {
    programId: PROGRAMS.token,
    keys: [
      { pubkey: source, signer: false, writable: true },
      ro(mint),
      { pubkey: dest, signer: false, writable: true },
      { pubkey: owner, signer: true, writable: false },
      ...references.map(ro),
    ],
    data: bytes(10, (v) => {
      v.setUint8(0, 12)
      v.setBigUint64(1, amount, true)
      v.setUint8(9, decimals)
    }),
  }
}

/** Associated Token Account CreateIdempotent (index 1): makes the recipient's token account if it's missing. */
export function createAtaIdempotent(payer: string, owner: string, mint: string): Instruction {
  return {
    programId: PROGRAMS.ata,
    keys: [
      { pubkey: payer, signer: true, writable: true },
      { pubkey: associatedTokenAddress(owner, mint), signer: false, writable: true },
      ro(owner),
      ro(mint),
      ro(PROGRAMS.system),
      ro(PROGRAMS.token),
    ],
    data: new Uint8Array([1]),
  }
}

export const setComputeUnitLimit = (units: number): Instruction => ({
  programId: PROGRAMS.computeBudget,
  keys: [],
  data: bytes(5, (v) => {
    v.setUint8(0, 2)
    v.setUint32(1, units, true)
  }),
})

export const setComputeUnitPrice = (microLamports: bigint): Instruction => ({
  programId: PROGRAMS.computeBudget,
  keys: [],
  data: bytes(9, (v) => {
    v.setUint8(0, 3)
    v.setBigUint64(1, microLamports, true)
  }),
})

// ---------- legacy transaction ----------

function shortvec(n: number): number[] {
  const out: number[] = []
  let rem = n
  for (;;) {
    let elem = rem & 0x7f
    rem >>= 7
    if (rem === 0) {
      out.push(elem)
      return out
    }
    elem |= 0x80
    out.push(elem)
  }
}

function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(len)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

export type Compiled = { message: Uint8Array; signers: string[] }

/**
 * Compile a legacy message. Account order is what the runtime requires:
 * fee payer, other writable signers, read-only signers, writable non-signers, read-only non-signers.
 */
export function compileMessage(feePayer: string, instructions: Instruction[], recentBlockhash: string): Compiled {
  const metas = new Map<string, { signer: boolean; writable: boolean; order: number }>()
  const add = (pubkey: string, signer: boolean, writable: boolean) => {
    const m = metas.get(pubkey)
    if (m) {
      m.signer ||= signer
      m.writable ||= writable
    } else metas.set(pubkey, { signer, writable, order: metas.size })
  }
  add(feePayer, true, true)
  for (const ix of instructions) {
    for (const k of ix.keys) add(k.pubkey, k.signer, k.writable)
    add(ix.programId, false, false)
  }
  const rank = (m: { signer: boolean; writable: boolean }) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3)
  const keys = [...metas.entries()].sort(([a, x], [b, y]) => (a === feePayer ? -1 : b === feePayer ? 1 : rank(x) - rank(y) || x.order - y.order))
  const index = new Map(keys.map(([k], i) => [k, i]))
  const signers = keys.filter(([, m]) => m.signer).map(([k]) => k)
  const header = [signers.length, keys.filter(([, m]) => m.signer && !m.writable).length, keys.filter(([, m]) => !m.signer && !m.writable).length]
  const ixBytes = instructions.map((ix) =>
    concat([index.get(ix.programId)!], shortvec(ix.keys.length), ix.keys.map((k) => index.get(k.pubkey)!), shortvec(ix.data.length), ix.data),
  )
  const message = concat(header, shortvec(keys.length), ...keys.map(([k]) => toBytes(k)), toBytes(recentBlockhash), shortvec(instructions.length), ...ixBytes)
  return { message, signers }
}

/** Sign with every required key and return the wire bytes plus the transaction id (first signature). */
export function signTransaction(compiled: Compiled, secrets: Record<string, Uint8Array>) {
  const sigs = compiled.signers.map((pk) => {
    const sk = secrets[pk]
    if (!sk) throw new Error(`missing signer ${pk}`)
    return ed25519.sign(compiled.message, sk)
  })
  return { wire: concat(shortvec(sigs.length), ...sigs, compiled.message), signature: toAddress(sigs[0]) }
}

export const toBase64 = (b: Uint8Array) => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

// ---------- amounts ----------

/** 1234500n, 6 → "1.2345". Never scientific notation, never trailing zeros. */
export function toDecimal(base: bigint, decimals: number) {
  const neg = base < 0n
  const abs = neg ? -base : base
  const s = abs.toString().padStart(decimals + 1, '0')
  const whole = s.slice(0, s.length - decimals)
  const frac = s.slice(s.length - decimals).replace(/0+$/, '')
  return (neg ? '-' : '') + whole + (frac ? '.' + frac : '')
}

/** "1.2345", 6 → 1234500n. null if it isn't a clean amount with at most `decimals` places. */
export function fromDecimal(s: string, decimals: number): bigint | null {
  const t = s.trim().replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return null
  const [whole, frac = ''] = t.split('.')
  if (frac.length > decimals) return null
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + '0'.repeat(decimals)).slice(0, decimals) || '0')
}

// ---------- Solana Pay ----------

export type TransferRequest = { recipient: string; amount: bigint; decimals: number; splToken?: string; reference: string; label?: string; message?: string }

/** solana:<recipient>?amount=…&spl-token=…&reference=…  (Solana Pay transfer request spec) */
export function solanaPayUrl(r: TransferRequest) {
  const q: string[] = [`amount=${toDecimal(r.amount, r.decimals)}`]
  if (r.splToken) q.push(`spl-token=${r.splToken}`)
  q.push(`reference=${r.reference}`)
  if (r.label) q.push(`label=${encodeURIComponent(r.label)}`)
  if (r.message) q.push(`message=${encodeURIComponent(r.message)}`)
  return `solana:${r.recipient}?${q.join('&')}`
}

// ---------- reading a confirmed transaction (getTransaction, encoding "jsonParsed") ----------

type TokenBalance = { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number } }
export type RpcTransaction = {
  slot: number
  blockTime: number | null
  meta: { err: unknown; fee: number; preBalances: number[]; postBalances: number[]; preTokenBalances?: TokenBalance[] | null; postTokenBalances?: TokenBalance[] | null } | null
  transaction: { signatures: string[]; message: { accountKeys: (string | { pubkey: string })[] } }
}

/**
 * How much `recipient` received in this transaction: lamports for SOL, or base units of `mint`.
 * Looks at balance changes, not at instructions, so it works for any wallet's way of building
 * the transfer (versioned transactions, lookup tables, priority-fee instructions, memos).
 */
export function amountReceived(tx: RpcTransaction, recipient: string, mint?: string): bigint {
  if (!tx.meta || tx.meta.err) return 0n
  if (!mint) {
    const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey))
    const i = keys.indexOf(recipient)
    if (i < 0) return 0n
    return BigInt(tx.meta.postBalances[i] ?? 0) - BigInt(tx.meta.preBalances[i] ?? 0)
  }
  const sum = (list?: TokenBalance[] | null) => (list ?? []).filter((b) => b.owner === recipient && b.mint === mint).reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n)
  return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances)
}

export const accountKeys = (tx: RpcTransaction) => tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey))

export function explorerTx(signature: string, cluster: Cluster) {
  return `https://explorer.solana.com/tx/${signature}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`
}
export function explorerAddress(address: string, cluster: Cluster) {
  return `https://explorer.solana.com/address/${address}${cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`}`
}
