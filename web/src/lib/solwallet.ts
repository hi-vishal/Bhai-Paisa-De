import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import type { Identity } from '@shared/keys'
import {
  amountReceived,
  associatedTokenAddress,
  compileMessage,
  createAtaIdempotent,
  setComputeUnitLimit,
  setComputeUnitPrice,
  signTransaction,
  toBase64,
  transferChecked,
  transferSol,
  type Instruction,
  type RpcTransaction,
} from '@shared/solana'
import { api, ApiError } from './api'
import { serverInfo } from './server'
import type { User } from './types'
export type { ServerInfo } from './types'

// The in-app Solana wallet. Keys come from your recovery phrase and stay on this device;
// the server only relays JSON-RPC (so a paid RPC key never ships to browsers) and can't spend.

export { serverInfo }

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await api<{ result: T }>('/sol/rpc', { body: { method, params } })
  return r.result
}

/** Prove the address is ours (sign a fixed message), so SOL/USDT pay links can send money to it. */
export async function registerAddress(id: Identity) {
  const { message } = await api<{ message: string }>(`/me/solana/message?address=${id.solAddress}`)
  const signature = base58.encode(ed25519.sign(new TextEncoder().encode(message), id.solSecret))
  return api<{ user: User }>('/me/solana', { method: 'PUT', body: { address: id.solAddress, signature } })
}

export type Balances = { sol: bigint; usdt: bigint; usdtAccount: boolean }

export async function balances(address: string): Promise<Balances> {
  const s = await serverInfo()
  const [lamports, tokens] = await Promise.all([
    rpc<{ value: number }>('getBalance', [address, { commitment: 'confirmed' }]),
    rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] }>('getTokenAccountsByOwner', [
      address,
      { mint: s.solana.stableMint },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
  ])
  const usdt = tokens.value.reduce((a, t) => a + BigInt(t.account.data.parsed.info.tokenAmount.amount), 0n)
  return { sol: BigInt(lamports.value), usdt, usdtAccount: tokens.value.length > 0 }
}

/** Rent-exempt minimum for a token account: what creating the recipient's USDT account costs, once. */
const ATA_RENT = 2_039_280n
const BASE_FEE = 5_000n
const CU_LIMIT = 80_000

export type SendPlan = { instructions: Instruction[]; feeLamports: bigint; createsAccount: boolean }

export class WalletError extends Error {
  constructor(public code: 'no_sol_for_fee' | 'not_enough' | 'bad_address' | 'send_failed' | 'timeout', message: string) {
    super(message)
  }
}

/** Build a transfer (with an optional Solana Pay reference) and check the balance covers it, fees included. */
export async function planSend(from: string, to: string, asset: 'SOL' | 'USDT', amount: bigint, reference?: string): Promise<SendPlan> {
  const s = await serverInfo()
  const refs = reference ? [reference] : []
  const prio = BigInt(s.solana.priorityMicroLamports)
  const ixs: Instruction[] = []
  if (prio > 0n) ixs.push(setComputeUnitLimit(CU_LIMIT), setComputeUnitPrice(prio))
  let createsAccount = false
  if (asset === 'SOL') ixs.push(transferSol(from, to, amount, refs))
  else {
    const mint = s.solana.stableMint
    const destAta = associatedTokenAddress(to, mint)
    const exists = await rpc<{ value: unknown }>('getAccountInfo', [destAta, { encoding: 'base64', commitment: 'confirmed' }])
    if (!exists.value) {
      createsAccount = true
      ixs.push(createAtaIdempotent(from, to, mint))
    }
    ixs.push(transferChecked(associatedTokenAddress(from, mint), mint, destAta, from, amount, s.solana.stableDecimals, refs))
  }
  const priorityFee = (prio * BigInt(CU_LIMIT) + 999_999n) / 1_000_000n
  const feeLamports = BASE_FEE + priorityFee + (createsAccount ? ATA_RENT : 0n)
  const bal = await balances(from)
  const needSol = feeLamports + (asset === 'SOL' ? amount : 0n)
  if (asset === 'USDT' && bal.usdt < amount) throw new WalletError('not_enough', 'not enough USDT')
  if (bal.sol < needSol) throw new WalletError(asset === 'SOL' ? 'not_enough' : 'no_sol_for_fee', asset === 'SOL' ? 'not enough SOL (counting the network fee)' : 'you need a little SOL to pay the network fee')
  return { instructions: ixs, feeLamports, createsAccount }
}

/** Sign locally, send through the relay, wait until the network confirms it. Returns the signature. */
export async function send(id: Identity, plan: SendPlan, onSent?: (sig: string) => void): Promise<string> {
  const { value } = await rpc<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])
  const compiled = compileMessage(id.solAddress, plan.instructions, value.blockhash)
  const { wire, signature } = signTransaction(compiled, { [id.solAddress]: id.solSecret })
  try {
    await rpc<string>('sendTransaction', [toBase64(wire), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }])
  } catch (e) {
    throw new WalletError('send_failed', e instanceof ApiError ? e.message.replace(/^.*?:\s*/, '') : 'the network refused the transaction')
  }
  onSent?.(signature)
  const until = Date.now() + 75_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200))
    const st = await rpc<{ value: ({ confirmationStatus?: string; err: unknown } | null)[] }>('getSignatureStatuses', [[signature]]).catch(() => null)
    const v = st?.value[0]
    if (v?.err) throw new WalletError('send_failed', 'the transaction failed on chain')
    if (v && (v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized')) return signature
  }
  throw new WalletError('timeout', 'sent, but not confirmed yet. Check the explorer in a minute')
}

export type HistoryItem = { signature: string; at: number | null; ok: boolean; sol: bigint; usdt: bigint }

/** Last few transactions with what each did to this wallet. */
export async function history(address: string, limit = 8): Promise<HistoryItem[]> {
  const s = await serverInfo()
  const sigs = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>('getSignaturesForAddress', [address, { limit, commitment: 'confirmed' }])
  const sigsUsdt = await rpc<{ signature: string; blockTime: number | null; err: unknown }[]>('getSignaturesForAddress', [associatedTokenAddress(address, s.solana.stableMint), { limit, commitment: 'confirmed' }]).catch(() => [])
  const all = [...new Map([...sigs, ...sigsUsdt].map((x) => [x.signature, x])).values()].sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0)).slice(0, limit)
  const txs = await Promise.all(
    all.map((x) => rpc<RpcTransaction | null>('getTransaction', [x.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null)),
  )
  return all.map((x, i) => {
    const tx = txs[i]
    return {
      signature: x.signature,
      at: x.blockTime ? x.blockTime * 1000 : null,
      ok: !x.err,
      sol: tx ? amountReceived(tx, address) : 0n,
      usdt: tx ? amountReceived(tx, address, s.solana.stableMint) : 0n,
    }
  })
}
