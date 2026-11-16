// UPI is how India pays friends. A upi:// link opens the payer's UPI app with the payee, the
// amount and a note already filled in. The money moves bank to bank; we never see it, so the
// person getting paid confirms it arrived.

/** name@bank, the way UPI apps write it. Stored lowercase. */
export const UPI_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$/

export function cleanUpi(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  return UPI_RE.test(s) ? s : null
}

/** A UPI reference number (UTR) is 12 digits. People paste it with spaces sometimes. */
export function cleanRef(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, '')
  return /^\d{12}$/.test(s) ? s : null
}

/** paise → "340.50" */
export const upiAmount = (paise: number) => (paise / 100).toFixed(2)

export type UpiApp = 'any' | 'gpay' | 'phonepe' | 'paytm'

/**
 * Android shows its own app picker for upi://. iPhones don't, so each app gets its own scheme
 * there; `any` still opens whichever UPI app iOS picks.
 */
const PREFIX: Record<UpiApp, string> = {
  any: 'upi://pay',
  gpay: 'gpay://upi/pay',
  phonepe: 'phonepe://pay',
  paytm: 'paytmmp://pay',
}

/** NPCI's link format: pa (payee address), pn (payee name), am (rupees), cu, tn (note). */
export function upiUrl(p: { pa: string; pn: string; am?: number; tn?: string }, app: UpiApp = 'any') {
  const parts = [`pa=${encodeURIComponent(p.pa)}`, `pn=${encodeURIComponent(p.pn.slice(0, 40))}`]
  if (p.am && p.am > 0) parts.push(`am=${upiAmount(p.am)}`)
  parts.push('cu=INR')
  if (p.tn) parts.push(`tn=${encodeURIComponent(p.tn.slice(0, 40))}`)
  return `${PREFIX[app]}?${parts.join('&')}`
}
