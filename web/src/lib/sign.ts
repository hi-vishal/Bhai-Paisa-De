import type { Event as NostrEvent } from 'nostr-tools/pure'
import type { EntryData } from '@shared/ledger'
import type { Identity } from '@shared/keys'
import { identitySecret, needsPin, unlock, unlocked } from './vault'

// Every change you make to a group is signed by your own key before it leaves the phone.
// The server can store and relay it, but it can't write one in your name.

type Prompter = (reason: 'sign' | 'spend') => Promise<Identity>
let prompter: Prompter | null = null
/** The PIN sheet registers itself here, so code outside React can ask for an unlock. */
export const setUnlockPrompter = (p: Prompter | null) => void (prompter = p)

/** The spending key. Asks for the PIN if there is one and the wallet is locked. */
export async function requireUnlocked(): Promise<Identity> {
  const id = unlocked()
  if (id) return id
  if (!needsPin()) return unlock()
  if (!prompter) throw new Error('wallet is locked')
  return prompter('spend')
}

async function identityKey(): Promise<Uint8Array> {
  const sk = await identitySecret()
  if (sk) return sk
  if (!needsPin()) return (await unlock()).nostrSecret
  if (!prompter) throw new Error('wallet is locked')
  return (await prompter('sign')).nostrSecret
}

// secp256k1 + the ledger format load on first signature, not on first paint
const lib = async () => {
  const [{ finalizeEvent }, { MEMBER_SIG_KIND, memberSigContent }] = await Promise.all([import('nostr-tools/pure'), import('@shared/ledger')])
  return { finalizeEvent, MEMBER_SIG_KIND, memberSigContent }
}

export async function signEntry(groupId: string, data: EntryData): Promise<NostrEvent> {
  const sk = await identityKey()
  const { finalizeEvent, MEMBER_SIG_KIND, memberSigContent } = await lib()
  return finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: memberSigContent(groupId, data) }, sk)
}

/** Request-body fields for a signed change. Accounts from before recovery phrases send none. */
export async function sigFields(pubkey: string | null | undefined, groupId: string, data: EntryData): Promise<{ signed?: NostrEvent }> {
  if (!pubkey) return {}
  return { signed: await signEntry(groupId, data) }
}

export async function signAll(groupId: string, entries: EntryData[]) {
  const sk = await identityKey()
  const { finalizeEvent, MEMBER_SIG_KIND, memberSigContent } = await lib()
  const at = Math.floor(Date.now() / 1000)
  return entries.map((data) => finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: at, tags: [], content: memberSigContent(groupId, data) }, sk))
}

/** NIP-98 style: sign "POST <this url>" plus the server's one-time challenge. */
export async function authEvent(path: string, challenge: string, sk: Uint8Array) {
  const { finalizeEvent } = await lib()
  return finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', `${location.origin}${path}`],
        ['method', 'POST'],
        ['challenge', challenge],
      ],
      content: '',
    },
    sk,
  )
}

/** "iPhone · Safari (home screen)": how this device shows up in Me → Devices. */
export function deviceLabel() {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device'
  const br = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const pwa = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone
  return `${os} · ${br}${pwa ? ' (home screen)' : ''}`
}
