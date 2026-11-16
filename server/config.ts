import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { availableParallelism } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_RELAYS } from '../shared/ledger'
import { STABLE_DEVNET, USDT_MAINNET, isAddress, type Cluster } from '../shared/solana'

export const ROOT = resolve(import.meta.dirname, '..')
export const DATA_DIR = resolve(process.env.BPD_DATA_DIR ?? join(ROOT, 'data'))
mkdirSync(DATA_DIR, { recursive: true })

const prod = process.env.NODE_ENV === 'production'
const env = (k: string) => process.env[k]?.trim() || undefined
const flag = (k: string, dflt: boolean) => (env(k) === undefined ? dflt : !['0', 'false', 'off', 'no'].includes(env(k)!.toLowerCase()))

/**
 * Create a file once, atomically: write a temp file, then hard-link it into place, which fails if
 * the file already exists. Whoever loses the race reads the winner's file, never a half-written one,
 * so every process ends up with the same secret.
 */
export function createOnce(file: string, make: () => string): string {
  const p = join(DATA_DIR, file)
  try {
    return readFileSync(p, 'utf8')
  } catch {
    // not there yet
  }
  const tmp = `${p}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(tmp, make(), { mode: 0o600 })
  try {
    linkSync(tmp, p)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  } finally {
    unlinkSync(tmp)
  }
  return readFileSync(p, 'utf8')
}

/** Read a 32-byte hex secret from env, or from a file in data/, creating it on first boot. */
function secretFile(envName: string, file: string): string {
  const fromEnv = env(envName)
  if (fromEnv) {
    if (!/^[0-9a-f]{64}$/i.test(fromEnv)) throw new Error(`${envName} must be 64 hex characters`)
    return fromEnv.toLowerCase()
  }
  return createOnce(file, () => randomBytes(32).toString('hex') + '\n').trim()
}

// Crypto is opt-in. In production it stays off until you pick a network on purpose:
// mainnet-beta for real money, devnet for free test money. Development defaults to devnet.
const clusterRaw = env('BPD_SOLANA_CLUSTER') ?? (prod ? undefined : 'devnet')
if (clusterRaw && !['mainnet-beta', 'devnet', 'testnet'].includes(clusterRaw)) throw new Error(`BPD_SOLANA_CLUSTER must be mainnet-beta, devnet or testnet (got ${clusterRaw})`)
const cluster = (clusterRaw ?? 'devnet') as Cluster
const mainnet = cluster === 'mainnet-beta'
const stableMint = env('BPD_USDT_MINT') ?? (mainnet ? USDT_MAINNET : STABLE_DEVNET)
if (!isAddress(stableMint)) throw new Error('BPD_USDT_MINT is not a Solana address')

const demoWallet = flag('BPD_DEMO_WALLET', !prod)
if (demoWallet && mainnet) console.warn('[config] demo payments are ON with mainnet. Fake payments will clear real debts. Set BPD_DEMO_WALLET=0.')

const tipUpi = env('BPD_TIP_UPI')?.toLowerCase()
if (tipUpi && !/^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/.test(tipUpi)) throw new Error('BPD_TIP_UPI is not a UPI ID (like name@okhdfcbank)')

export const config = {
  port: Number(env('BPD_API_PORT') ?? env('PORT') ?? 8787),
  host: env('BPD_HOST') ?? '0.0.0.0',
  prod,
  /** HTTP worker processes sharing one SQLite file (WAL). Background jobs run in exactly one. */
  workers: Math.max(1, Number(env('BPD_WORKERS') ?? (prod ? Math.min(availableParallelism(), 4) : 1))),
  /** the server's Nostr identity; signs every ledger entry */
  nostrSecret: secretFile('BPD_NOSTR_SECRET', 'nostr.key'),
  /** HMAC key for stateless login challenges */
  authSecret: secretFile('BPD_AUTH_SECRET', 'auth.key'),
  relays: env('BPD_RELAYS')?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_RELAYS,
  nostrEnabled: flag('BPD_NOSTR', true),
  /** "simulate payment" buttons on crypto quotes, so people can try the flow without money. Off in production. */
  demoWallet,
  /** the "Support Vishal" tip jar: a UPI ID, or unset to hide it */
  tip: { upi: tipUpi, name: env('BPD_TIP_NAME') ?? 'Vishal' },
  quoteSeconds: 90,
  rateCacheMs: 30_000,
  /** refuse to quote volatile assets on a rate older than this */
  rateMaxAgeMs: 10 * 60_000,
  sessionDays: 90,
  publicUrl: env('BPD_PUBLIC_URL')?.replace(/\/$/, ''),
  solana: {
    enabled: !!clusterRaw && flag('BPD_SOLANA', true),
    cluster,
    mainnet,
    rpc: env('BPD_SOLANA_RPC') ?? (mainnet ? 'https://api.mainnet-beta.solana.com' : `https://api.${cluster}.solana.com`),
    stableMint,
    stableDecimals: 6,
    /** on devnet the "USDT" rail uses Circle's devnet USDC so you can test with free faucet tokens */
    stableLabel: mainnet || env('BPD_USDT_MINT') ? 'USDT' : 'USDT (devnet USDC)',
    commitment: (env('BPD_SOLANA_COMMITMENT') === 'finalized' ? 'finalized' : 'confirmed') as 'confirmed' | 'finalized',
    /** priority fee for transactions the in-app wallet sends, in micro-lamports per compute unit */
    priorityMicroLamports: BigInt(env('BPD_SOLANA_PRIORITY') ?? (mainnet ? '50000' : '0')),
    /** after a quote's 90 seconds, keep looking for a late on-chain payment this long */
    lateWindowMs: 24 * 60 * 60_000,
  },
}

export type Config = typeof config
