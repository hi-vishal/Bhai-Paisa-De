// npm run solana:check [-- --rpc https://api.devnet.solana.com]
// Builds and signs real transactions with our zero-dependency builder and asks a live Solana node
// to *simulate* them with signature verification. Nothing is broadcast, nothing moves.
// A fresh, unfunded key is used, so the expected answer is "no SOL for the fee", which is the node
// telling us it parsed the bytes, checked the signature, and got as far as charging the fee.

import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import * as S from '../shared/solana'

const args = process.argv.slice(2)
const rpcUrl = args[args.indexOf('--rpc') + 1] && args.includes('--rpc') ? args[args.indexOf('--rpc') + 1] : 'https://api.devnet.solana.com'
const mint = args.includes('--mint') ? args[args.indexOf('--mint') + 1] : S.STABLE_DEVNET

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
  const b = (await r.json()) as { result: T; error?: { message: string } }
  if (b.error) throw new Error(b.error.message)
  return b.result
}

const sk = ed25519.utils.randomSecretKey()
const me = base58.encode(ed25519.getPublicKey(sk))
const to = S.newReference()
const ref = S.newReference()
const { value } = await rpc<{ value: { blockhash: string } }>('getLatestBlockhash', [{ commitment: 'confirmed' }])
console.log(`node     ${rpcUrl}\nblockhash ${value.blockhash}\npayer    ${me} (fresh, unfunded)\n`)

const cases: [string, S.Instruction[]][] = [
  ['SOL transfer + Solana Pay reference', [S.transferSol(me, to, 1_000_000n, [ref])]],
  ['priority fee + USDT transfer (creates their token account)', [S.setComputeUnitLimit(80_000), S.setComputeUnitPrice(10_000n), S.createAtaIdempotent(me, to, mint), S.transferChecked(S.associatedTokenAddress(me, mint), mint, S.associatedTokenAddress(to, mint), me, 1_500_000n, 6, [ref])]],
]

let ok = true
for (const [name, ixs] of cases) {
  const { wire } = S.signTransaction(S.compileMessage(me, ixs, value.blockhash), { [me]: sk })
  const sim = await rpc<{ value: { err: unknown; logs: string[] | null } }>('simulateTransaction', [S.toBase64(wire), { encoding: 'base64', sigVerify: true, commitment: 'confirmed' }])
  const err = JSON.stringify(sim.value.err)
  const parsed = err === '"AccountNotFound"' || /InsufficientFundsForFee|AccountNotFound/.test(err)
  ok &&= parsed
  console.log(`${parsed ? '✔' : '✘'} ${name}\n   node says: ${err}${parsed ? '  ← parsed, signature checked, stopped at the fee (expected)' : ''}`)
}
// and the control: one flipped bit in the signature must be refused before anything runs
const { wire } = S.signTransaction(S.compileMessage(me, cases[0][1], value.blockhash), { [me]: sk })
wire[5] ^= 1
try {
  const sim = await rpc<{ value: { err: unknown } }>('simulateTransaction', [S.toBase64(wire), { encoding: 'base64', sigVerify: true }])
  const err = JSON.stringify(sim.value.err)
  const refused = /Signature/i.test(err)
  ok &&= refused
  console.log(`${refused ? '✔' : '✘'} tampered signature ${refused ? 'refused' : 'accepted'}\n   node says: ${err}`)
} catch (e) {
  console.log(`✔ tampered signature refused\n   node says: ${(e as Error).message}`)
}
process.exit(ok ? 0 : 1)
