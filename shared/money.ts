// Money lives in whole minor units (paise for INR). Floats never touch a balance.

export type CurrencyCode = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | 'SGD' | 'CAD' | 'AUD' | 'JPY'

export const CURRENCIES: Record<CurrencyCode, { symbol: string; decimals: number; locale: string; name: string; fallbackBtcPrice: number }> = {
  INR: { symbol: '₹', decimals: 2, locale: 'en-IN', name: 'Indian rupee', fallbackBtcPrice: 9_500_000 },
  USD: { symbol: '$', decimals: 2, locale: 'en-US', name: 'US dollar', fallbackBtcPrice: 110_000 },
  EUR: { symbol: '€', decimals: 2, locale: 'de-DE', name: 'Euro', fallbackBtcPrice: 95_000 },
  GBP: { symbol: '£', decimals: 2, locale: 'en-GB', name: 'British pound', fallbackBtcPrice: 82_000 },
  AED: { symbol: 'AED ', decimals: 2, locale: 'en-AE', name: 'UAE dirham', fallbackBtcPrice: 400_000 },
  SGD: { symbol: 'S$', decimals: 2, locale: 'en-SG', name: 'Singapore dollar', fallbackBtcPrice: 142_000 },
  CAD: { symbol: 'C$', decimals: 2, locale: 'en-CA', name: 'Canadian dollar', fallbackBtcPrice: 152_000 },
  AUD: { symbol: 'A$', decimals: 2, locale: 'en-AU', name: 'Australian dollar', fallbackBtcPrice: 168_000 },
  JPY: { symbol: '¥', decimals: 0, locale: 'ja-JP', name: 'Japanese yen', fallbackBtcPrice: 16_500_000 },
}

export const isCurrency = (c: unknown): c is CurrencyCode => typeof c === 'string' && c in CURRENCIES

/** Format minor units as a human amount, e.g. 170050 INR -> "₹1,700.50". Drops ".00". */
export function formatMoney(minor: number, currency: CurrencyCode, opts: { sign?: boolean; keepZeros?: boolean } = {}): string {
  const c = CURRENCIES[currency]
  const neg = minor < 0
  const abs = Math.abs(minor)
  const factor = 10 ** c.decimals
  const major = Math.floor(abs / factor)
  const frac = abs % factor
  const majorStr = major.toLocaleString(c.locale)
  const fracStr = c.decimals > 0 && (frac > 0 || opts.keepZeros) ? '.' + String(frac).padStart(c.decimals, '0') : ''
  const prefix = neg ? '−' : opts.sign && minor > 0 ? '+' : ''
  return `${prefix}${c.symbol}${majorStr}${fracStr}`
}

/** Parse "1,700.5" into minor units. Returns null when it isn't a clean amount. */
export function parseMoney(input: string, currency: CurrencyCode): number | null {
  const c = CURRENCIES[currency]
  const clean = input.replace(/[,\s]/g, '').replace(/^[^\d.]+/, '')
  if (!clean) return null
  const re = c.decimals > 0 ? new RegExp(`^\\d+(\\.\\d{0,${c.decimals}})?$`) : /^\d+$/
  if (!re.test(clean)) return null
  const [whole, frac = ''] = clean.split('.')
  const minor = Number(whole) * 10 ** c.decimals + Number((frac + '0'.repeat(c.decimals)).slice(0, c.decimals) || 0)
  return Number.isSafeInteger(minor) ? minor : null
}

/**
 * Split `total` minor units by integer `weights`.
 * Each share is floor(total * w / W); the leftover units go out one at a time,
 * in the order the weights are given, to entries with a positive weight.
 * Shares are whole numbers and always add up to the total.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total)) throw new Error('total must be an integer')
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new Error('weights must be non-negative integers')
  if (total < 0) return allocate(-total, weights).map((s) => (s === 0 ? 0 : -s))
  const W = weights.reduce((a, b) => a + b, 0)
  if (W === 0) {
    if (total === 0) return weights.map(() => 0)
    throw new Error('nobody to split with')
  }
  const T = BigInt(total)
  const BW = BigInt(W)
  const shares = weights.map((w) => Number((T * BigInt(w)) / BW))
  let leftover = total - shares.reduce((a, b) => a + b, 0)
  const order = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0)
  for (let k = 0; leftover > 0; k++, leftover--) shares[order[k % order.length]] += 1
  return shares
}

// ---------- crypto assets ----------

export type Asset = 'BTC' | 'SOL' | 'USDT'
export const ASSETS: Record<Asset, { decimals: number; symbol: string; name: string; unit: string }> = {
  BTC: { decimals: 8, symbol: '₿', name: 'Bitcoin (Lightning)', unit: 'sats' },
  SOL: { decimals: 9, symbol: '◎', name: 'Solana', unit: 'SOL' },
  USDT: { decimals: 6, symbol: '₮', name: 'Tether USD', unit: 'USDT' },
}
export const isAsset = (a: unknown): a is Asset => typeof a === 'string' && a in ASSETS

// Prices arrive as floats (₹ per 1 SOL). Scale to integer micro-units once, then stay in BigInt.
const PRICE_SCALE = 1_000_000n
const scaled = (price: number) => {
  if (!(price > 0) || !Number.isFinite(price)) throw new Error('price must be positive')
  return BigInt(Math.round(price * 1e6))
}

/**
 * Fiat minor units → asset base units (sats, lamports, USDT micro-units) at `price`
 * (fiat per 1 whole asset). Rounds up, so the payee is never short.
 */
export function minorToBase(minor: number, currency: CurrencyCode, asset: Asset, price: number): bigint {
  const num = BigInt(minor) * 10n ** BigInt(ASSETS[asset].decimals) * PRICE_SCALE
  const den = scaled(price) * 10n ** BigInt(CURRENCIES[currency].decimals)
  return (num + den - 1n) / den
}

/** Asset base units → fiat minor units at `price`. Rounds down (used to value a late or partial payment). */
export function baseToMinor(base: bigint, currency: CurrencyCode, asset: Asset, price: number): number {
  const v = (base * scaled(price) * 10n ** BigInt(CURRENCIES[currency].decimals)) / (10n ** BigInt(ASSETS[asset].decimals) * PRICE_SCALE)
  return Number(v)
}

/** sats for an amount at a BTC price quoted in the same currency. Rounds up so the payee is never short. */
export function minorToSats(minor: number, currency: CurrencyCode, btcPrice: number): number {
  return Math.max(1, Number(minorToBase(minor, currency, 'BTC', btcPrice)))
}

/** 1234500n USDT → "1.2345 USDT"; trims to `maxFrac` places for display. */
export function formatBase(base: bigint, asset: Asset, maxFrac = asset === 'USDT' ? 2 : 6): string {
  if (asset === 'BTC') return formatSats(Number(base))
  const d = ASSETS[asset].decimals
  const neg = base < 0n
  const abs = neg ? -base : base
  const unit = 10n ** BigInt(d)
  const whole = abs / unit
  let frac = (abs % unit).toString().padStart(d, '0').slice(0, maxFrac).replace(/0+$/, '')
  if (!frac && abs % unit !== 0n && whole === 0n) frac = (abs % unit).toString().padStart(d, '0').replace(/0+$/, '')
  return `${neg ? '−' : ''}${whole.toLocaleString('en-US')}${frac ? '.' + frac : ''} ${ASSETS[asset].unit}`
}

export function formatSats(sats: number): string {
  return sats.toLocaleString('en-US') + ' sats'
}
