import { CURRENCIES, type Asset, type CurrencyCode } from '../shared/money'
import { config } from './config'
import { HttpError } from './state'

export type Rate = { price: number; source: 'live' | 'last-known' | 'fixed'; at: number }

type Priced = Exclude<Asset, 'BTC'>
const COINGECKO: Record<Priced, string> = { SOL: 'solana', USDT: 'tether' }
/** only used if CoinGecko has never answered since boot; quotes refuse them outside demo mode */
const FALLBACK_USD: Record<Priced, number> = { SOL: 180, USDT: 1 }

const live = new Map<string, Rate>()
const k = (a: Priced, c: CurrencyCode) => `${a}:${c}`
let inflight: Promise<void> | null = null

async function refresh() {
  const ids = Object.values(COINGECKO).join(',')
  const vs = Object.keys(CURRENCIES).map((c) => c.toLowerCase()).join(',')
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${vs}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`coingecko ${res.status}`)
  const body = (await res.json()) as Record<string, Record<string, number>>
  const now = Date.now()
  for (const a of Object.keys(COINGECKO) as Priced[])
    for (const c of Object.keys(CURRENCIES) as CurrencyCode[]) {
      const p = body[COINGECKO[a]]?.[c.toLowerCase()]
      if (typeof p === 'number' && p > 0) live.set(k(a, c), { price: p, source: 'live', at: now })
    }
}

/**
 * Price of one `asset` in `currency`. Live CoinGecko rate cached 30s; if CoinGecko stops
 * answering, the last rate we got; if we never got one, a fixed fallback.
 */
export async function price(a: Asset, currency: CurrencyCode): Promise<Rate> {
  if (a === 'BTC') throw new HttpError(400, 'bad_asset', 'Lightning is no longer supported')
  const asset: Priced = a
  const cached = live.get(k(asset, currency))
  if (cached && Date.now() - cached.at < config.rateCacheMs) return cached
  try {
    inflight ??= refresh().finally(() => (inflight = null))
    await inflight
    const fresh = live.get(k(asset, currency))
    if (fresh && Date.now() - fresh.at < config.rateCacheMs) return fresh
  } catch {
    // fall through to the fallbacks below
  }
  if (cached) return { ...cached, source: 'last-known' }
  const fx = CURRENCIES[currency].fallbackBtcPrice / CURRENCIES.USD.fallbackBtcPrice
  return { price: FALLBACK_USD[asset] * fx, source: 'fixed', at: Date.now() }
}

export async function prices(currency: CurrencyCode) {
  const [SOL, USDT] = await Promise.all([price('SOL', currency), price('USDT', currency)])
  return { SOL, USDT }
}

/** Real money is never priced off a made-up or stale number. Demo payments may be. */
export function assertUsable(rate: Rate, demo: boolean) {
  if (demo) return
  if (rate.source === 'fixed' || Date.now() - rate.at > config.rateMaxAgeMs)
    throw new HttpError(503, 'rate_unavailable', "can't get a fresh exchange rate right now, so we won't guess. Try again in a minute.")
}
