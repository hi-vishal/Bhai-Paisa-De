// Deterministic JSON: keys sorted, undefined dropped. Two parties that build the same
// object get the same string, so a signature over it means the same thing to both.

export function canon(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'
  const o = v as Record<string, unknown>
  return (
    '{' +
    Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canon(o[k]))
      .join(',') +
    '}'
  )
}

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
export const ID_RE = /^[0-9a-hjkmnp-tv-z]{12}$/

/** short random id, Crockford-ish base32. Works in the browser and in Node. */
export function newId(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  let s = ''
  for (const b of bytes) s += ALPHABET[b & 31]
  return s
}

/**
 * Control characters and text-direction overrides (U+202A–202E, U+2066–2069) let a name or message
 * display as something it isn't ("Ria" that reads "aiR", invisible padding). They go.
 */
const SPOOF = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** The one way free text is cleaned, so the browser and the server sign the same string. */
export const cleanText = (s: string) => s.replace(SPOOF, '').trim().replace(/\s+/g, ' ')
