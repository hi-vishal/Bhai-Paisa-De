import { formatMoney, type CurrencyCode } from '@shared/money'
import type { Lang } from './i18n'

export const money = (minor: number, c: CurrencyCode, sign = false) => formatMoney(minor, c, { sign })

export function ago(ts: number, lang: Lang) {
  const s = Math.round((Date.now() - ts) / 1000)
  const hi = lang === 'hi'
  if (s < 45) return hi ? 'abhi abhi' : 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return hi ? `${m} min pehle` : `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return hi ? `${h} ghante pehle` : `${h}h ago`
  const d = Math.round(h / 24)
  if (d === 1) return hi ? 'kal' : 'yesterday'
  if (d < 7) return hi ? `${d} din pehle` : `${d}d ago`
  return new Date(ts).toLocaleDateString(hi ? 'en-IN' : undefined, { day: 'numeric', month: 'short' })
}

export function dayLabel(ts: number, lang: Lang) {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return lang === 'hi' ? 'Aaj' : 'Today'
  if (same(d, y)) return lang === 'hi' ? 'Kal' : 'Yesterday'
  return d.toLocaleDateString(lang === 'hi' ? 'en-IN' : undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export const firstName = (n: string) => n.split(' ')[0]

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  }
}

/** The little icon for how a payment was made. */
export const methodIcon = (s: { method: string; asset?: string | null }) =>
  s.method === 'upi' ? '📲' : s.method === 'kitty' ? '🏦' : s.method === 'solana' ? (s.asset === 'USDT' ? '₮' : '◎') : s.method === 'lightning' ? '⚡' : '✋'

/** Where to go after signing in: a path inside this app, never another site or a sign-in page. */
export function safeNext(raw: string | null) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /^\/(welcome|unlock|link)\b/.test(raw)) return '/'
  return raw
}
