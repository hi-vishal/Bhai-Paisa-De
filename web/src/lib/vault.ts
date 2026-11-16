// Your account key never leaves this device (except, sealed, when you link a new phone).
//
//  • Sign-up makes 12 words on the phone. With no crypto turned on, they're kept AES-256-GCM
//    encrypted under a non-extractable WebCrypto key in IndexedDB ("device" mode): no PIN to set,
//    and a copied localStorage alone can't open them.
//  • Turning on the crypto wallet moves them under a PIN instead (PBKDF2-SHA256, 600,000 rounds,
//    random salt). Unlocking puts the spending keys in memory only, and they lock again after
//    5 idle minutes or when the app sits in the background.
//  • The identity key (login + signing your changes) is kept separately under the device key,
//    so everyday actions never need the PIN.

import type { Identity } from '@shared/keys'

// the BIP39/BIP32/SLIP-10 code loads only when a wallet is made or unlocked
const keys = () => import('@shared/keys')

const VAULT = 'bpd.vault'
const IDKEY = 'bpd.idkey'
const FAILS = 'bpd.vault.fails'
const ITER = 600_000
const IDLE_MS = 5 * 60_000

export type VaultFile = {
  v: 1
  kdf: 'pbkdf2-sha256'
  iter: number
  salt: string
  iv: string
  ct: string
  /** public bits, readable while locked */
  sol: string
  npub: string
  createdAt: number
  backedUp?: boolean
  /** 'device' (no PIN: sealed by this browser), 'pin' (6 digits) or 'pass' (longer passphrase) */
  secret: 'device' | 'pin' | 'pass'
}

export type SecretKind = VaultFile['secret']

const b64 = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  dec: (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
}
const enc = new TextEncoder()
const dec = new TextDecoder()

const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, v)
    } catch {
      // storage blocked
    }
  },
}

export function readVault(): VaultFile | null {
  const raw = ls.get(VAULT)
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as VaultFile
    return v.v === 1 ? v : null
  } catch {
    return null
  }
}

async function pinKey(pin: string, salt: Uint8Array, iter: number) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

// ---------- the device key: non-extractable, in IndexedDB ----------

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bpd', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('keys')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

async function deviceKey(create: boolean): Promise<CryptoKey | null> {
  const db = await idb()
  const get = () =>
    new Promise<CryptoKey | undefined>((res, rej) => {
      const t = db.transaction('keys').objectStore('keys').get('device')
      t.onsuccess = () => res(t.result as CryptoKey | undefined)
      t.onerror = () => rej(t.error)
    })
  let key = await get()
  if (!key && create) {
    key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await new Promise<void>((res, rej) => {
      const t = db.transaction('keys', 'readwrite').objectStore('keys').put(key!, 'device')
      t.onsuccess = () => res()
      t.onerror = () => rej(t.error)
    })
  }
  db.close()
  return key ?? null
}

async function saveIdentitySecret(secret: Uint8Array) {
  try {
    const key = await deviceKey(true)
    if (!key) return
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, secret as BufferSource))
    ls.set(IDKEY, `${b64.enc(iv)}.${b64.enc(ct)}`)
  } catch {
    // no IndexedDB (some private modes): the identity key lives in memory, PIN each visit
  }
}

let identityCache: Uint8Array | null = null

/** The Nostr identity secret, without asking for the PIN. Null if this device never stored it. */
export async function identitySecret(): Promise<Uint8Array | null> {
  if (identityCache) return identityCache
  if (unlockedId) return unlockedId.nostrSecret
  const raw = ls.get(IDKEY)
  if (!raw) return null
  try {
    const key = await deviceKey(false)
    if (!key) return null
    const [iv, ct] = raw.split('.').map(b64.dec)
    identityCache = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource))
    return identityCache
  } catch {
    return null
  }
}

// ---------- unlocked state (memory only) ----------

let unlockedId: Identity | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

export const onVaultChange = (f: () => void) => {
  listeners.add(f)
  return () => listeners.delete(f)
}

function touch() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(lock, IDLE_MS)
}

export function lock() {
  unlockedId = null
  if (idleTimer) clearTimeout(idleTimer)
  emit()
}

if (typeof document !== 'undefined') {
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > 60_000) lock()
  })
}

export const isUnlocked = () => !!unlockedId

/** The spending keys, if unlocked. Every use pushes the auto-lock back. */
export function unlocked(): Identity | null {
  if (unlockedId) touch()
  return unlockedId
}

// ---------- create, unlock, reveal ----------

async function seal(words: string, secret: string | null, kind: SecretKind) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  if (kind === 'device') {
    const key = await deviceKey(true)
    if (!key) throw new VaultError('no_vault', 'this browser can’t store keys (private mode?)')
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(words)))
    return { kdf: 'pbkdf2-sha256' as const, iter: 0, salt: '', iv: b64.enc(iv), ct: b64.enc(ct) }
  }
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await pinKey(secret ?? '', salt, ITER)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(words)))
  return { kdf: 'pbkdf2-sha256' as const, iter: ITER, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) }
}

/** `kind: 'device'` needs no secret: the 12 words are sealed by this browser. */
export async function createVault(mnemonic: string, secret: string | null, kind: SecretKind): Promise<Identity> {
  const { identityFromMnemonic, normalizeMnemonic } = await keys()
  const words = normalizeMnemonic(mnemonic)
  const id = await identityFromMnemonic(words)
  const sealed = await seal(words, secret, kind)
  const file: VaultFile = { v: 1, ...sealed, sol: id.solAddress, npub: id.nostrPubkey, createdAt: Date.now(), secret: kind }
  ls.set(VAULT, JSON.stringify(file))
  ls.set(FAILS, null)
  await saveIdentitySecret(id.nostrSecret)
  identityCache = id.nostrSecret
  unlockedId = kind === 'device' ? null : id
  if (unlockedId) touch()
  emit()
  return id
}

/**
 * Put the 12 words under a PIN (turning on the crypto wallet), or change the PIN.
 * `current` is the old PIN; device-sealed vaults don't need one.
 */
export async function setVaultSecret(secret: string, kind: 'pin' | 'pass', current?: string) {
  const v = readVault()
  if (!v) throw new VaultError('no_vault', 'no account on this device')
  const words = await decryptPhrase(current)
  const sealed = await seal(words, secret, kind)
  ls.set(VAULT, JSON.stringify({ ...v, ...sealed, secret: kind }))
  const { identityFromMnemonic } = await keys()
  unlockedId = await identityFromMnemonic(words)
  touch()
  emit()
}

export class VaultError extends Error {
  constructor(public code: 'wrong_pin' | 'cooldown' | 'no_vault' | 'device_lost', message: string, public waitMs = 0) {
    super(message)
  }
}

/** After 5 wrong tries: wait 30 s, then 1 min, 2 min… Slows down someone guessing at your unlocked phone. */
function cooldown() {
  const f = JSON.parse(ls.get(FAILS) ?? '{"n":0,"until":0}') as { n: number; until: number }
  return f
}

async function decryptPhrase(secret?: string): Promise<string> {
  const v = readVault()
  if (!v) throw new VaultError('no_vault', 'no account on this device')
  if (v.secret === 'device') {
    try {
      const key = await deviceKey(false)
      if (!key) throw new Error('gone')
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(v.iv) as BufferSource }, key, b64.dec(v.ct) as BufferSource)
      return dec.decode(plain)
    } catch {
      throw new VaultError('device_lost', 'this browser lost its key. Use your 12 words or log in from your other phone')
    }
  }
  if (secret === undefined) throw new VaultError('wrong_pin', 'PIN needed')
  const f = cooldown()
  if (f.until > Date.now()) throw new VaultError('cooldown', 'too many wrong tries', f.until - Date.now())
  try {
    const key = await pinKey(secret, b64.dec(v.salt), v.iter)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(v.iv) as BufferSource }, key, b64.dec(v.ct) as BufferSource)
    ls.set(FAILS, null)
    return dec.decode(plain)
  } catch {
    const n = f.n + 1
    const until = n >= 5 ? Date.now() + 30_000 * 2 ** (n - 5) : 0
    ls.set(FAILS, JSON.stringify({ n, until }))
    throw new VaultError(until ? 'cooldown' : 'wrong_pin', 'wrong PIN', until ? until - Date.now() : 0)
  }
}

/** No PIN on this device: the words are sealed by the browser. */
export const needsPin = () => {
  const v = readVault()
  return !!v && v.secret !== 'device'
}

export async function unlock(secret?: string): Promise<Identity> {
  const words = await decryptPhrase(secret)
  const { identityFromMnemonic } = await keys()
  const id = await identityFromMnemonic(words)
  unlockedId = id
  identityCache = id.nostrSecret
  if (!ls.get(IDKEY)) await saveIdentitySecret(id.nostrSecret)
  touch()
  emit()
  return id
}

/** Show the 12 words again. Asks for the PIN when there is one, even if unlocked. */
export const revealPhrase = (secret?: string) => decryptPhrase(secret)

export function markBackedUp() {
  const v = readVault()
  if (!v) return
  ls.set(VAULT, JSON.stringify({ ...v, backedUp: true }))
  emit()
}

/** Remove the wallet from this device. The account and funds are fine if the phrase is written down. */
export function wipeVault() {
  ls.set(VAULT, null)
  ls.set(IDKEY, null)
  ls.set(FAILS, null)
  identityCache = null
  lock()
  void idb()
    .then((db) => {
      db.transaction('keys', 'readwrite').objectStore('keys').delete('device')
      db.close()
    })
    .catch(() => {})
}
