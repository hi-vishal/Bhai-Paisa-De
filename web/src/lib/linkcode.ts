import { api } from './api'

// "Log in on another phone": the old phone seals the 12 words with a fresh random key and uploads
// only the sealed box. The key rides in the QR after '#', which browsers never send to any server.
// The new phone scans, picks the box up (once, within 10 minutes) and opens it.

const b64u = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
}

type Payload = { m: string; n: string }

export async function makeLinkCode(mnemonic: string, name: string) {
  const raw = crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({ m: mnemonic, n: name } satisfies Payload))))
  const { id, expiresAt } = await api<{ id: string; expiresAt: number }>('/devices/link', { body: { blob: `v1.${b64u.enc(iv)}.${b64u.enc(ct)}` } })
  return { id, expiresAt, url: `${location.origin}/link#${id}.${b64u.enc(raw)}` }
}

/** "abc123.KEY" from a scanned URL, a pasted URL, or the bare fragment. */
export function parseLinkCode(text: string): { id: string; key: string } | null {
  const frag = text.trim().split('#').pop() ?? ''
  const m = /^([\w-]{10,40})\.([\w-]{40,48})$/.exec(frag)
  return m ? { id: m[1], key: m[2] } : null
}

export async function openLinkCode(code: { id: string; key: string }): Promise<Payload> {
  const { blob } = await api<{ blob: string }>(`/devices/link/${code.id}/take`, { method: 'POST', body: {}, auth: false })
  const [v, iv, ct] = blob.split('.')
  if (v !== 'v1') throw new Error('This code is from a newer version. Update the app on both phones.')
  const key = await crypto.subtle.importKey('raw', b64u.dec(code.key) as BufferSource, 'AES-GCM', false, ['decrypt'])
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(iv) as BufferSource }, key, b64u.dec(ct) as BufferSource)
    return JSON.parse(new TextDecoder().decode(plain)) as Payload
  } catch {
    throw new Error('That code didn’t open. Make a fresh one on your other phone and scan again.')
  }
}
