import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, tokenStore } from './api'
import { authEvent, deviceLabel } from './sign'
import type { User } from './types'
import { createVault, identitySecret, lock, needsPin, onVaultChange, readVault, setVaultSecret, unlock, wipeVault, type VaultFile } from './vault'

export type Status = 'loading' | 'out' | 'locked' | 'in'

type Ctx = {
  user: User | null
  ready: boolean
  status: Status
  vault: VaultFile | null
  /** New account in one step: a key made on this phone, no PIN, no password. */
  createAccount: (name: string, upi?: string) => Promise<User>
  /** Bring an account back from its 12 words (or a login code from another phone). 'needs_name' if the key has no account yet. */
  restoreAccount: (mnemonic: string, name?: string) => Promise<User | 'needs_name'>
  /** Signed out, account still on this phone: sign back in (PIN only if the crypto wallet is on). */
  unlockAndSignIn: (secret?: string) => Promise<User>
  /** Turn on USDT/SOL: puts the key under a PIN and registers the wallet address. */
  enableCrypto: (secret: string | null, kind: 'pin' | 'pass') => Promise<User>
  disableCrypto: () => Promise<User>
  /** accounts from before keys: make one and attach it */
  upgradeLegacy: () => Promise<User>
  signInWithKey: (token: string) => Promise<User>
  setUser: (u: User) => void
  signOut: () => Promise<void>
  forgetDevice: () => Promise<void>
}

const SessionCtx = createContext<Ctx>(null as unknown as Ctx)

/** Signed-in data the service worker kept for offline use: gone when you leave. */
async function dropOfflineCopies() {
  try {
    if ('caches' in window) await caches.delete('api-reads')
  } catch {
    // no cache storage here
  }
}
const WHO = 'bpd.who'

/** Who was last signed in on this phone (name and photo only). */
export function lastWho(): { name: string; avatar: string | null } | null {
  try {
    return JSON.parse(localStorage.getItem(WHO) ?? 'null')
  } catch {
    return null
  }
}

async function login(sk: Uint8Array, signup?: { name: string; upi?: string }) {
  const { challenge } = await api<{ challenge: string }>('/auth/challenge', { method: 'POST', auth: false })
  const event = await authEvent('/api/auth/login', challenge, sk)
  return api<{ token: string; user: User; created: boolean }>('/auth/login', { body: { event, name: signup?.name, upi: signup?.upi || undefined, label: deviceLabel() }, auth: false })
}

async function registerSol(user: User) {
  try {
    const { registerAddress } = await import('./solwallet')
    const { requireUnlocked } = await import('./sign')
    const id = await requireUnlocked()
    if (user.solAddress === id.solAddress) return user
    return (await registerAddress(id)).user
  } catch (e) {
    if (e instanceof ApiError && e.code === 'crypto_off') return user
    throw e
  }
}

/** Your account is a key that only this phone knows. Signing in is a signature, never a password. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [vault, setVault] = useState<VaultFile | null>(readVault)

  useEffect(() => {
    const off = onVaultChange(() => setVault(readVault()))
    return () => {
      off()
    }
  }, [])

  useEffect(() => {
    let dead = false
    const boot = async () => {
      if (tokenStore.get()) {
        try {
          const r = await api<{ user: User }>('/me')
          if (!dead) {
            setUser(r.user)
            setStatus('in')
          }
          return
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401)) {
            // offline: the service worker serves cached reads
            if (!dead) setStatus(readVault() ? 'locked' : 'out')
            return
          }
          tokenStore.set(null)
        }
      }
      if (!readVault()) return void (!dead && setStatus('out'))
      // the session ran out but this phone still has the key: sign back in quietly
      let sk = await identitySecret()
      if (!sk && !needsPin()) sk = await unlock().then((id) => id.nostrSecret).catch(() => null)
      if (sk) {
        try {
          const r = await login(sk)
          tokenStore.set(r.token)
          if (!dead) {
            setUser(r.user)
            setStatus('in')
          }
          return
        } catch {
          // fall through to the welcome-back screen
        }
      }
      if (!dead) setStatus('locked')
    }
    void boot()
    return () => {
      dead = true
    }
  }, [])

  const finish = useCallback((token: string, u: User) => {
    tokenStore.set(token)
    setUser(u)
    setStatus('in')
    return u
  }, [])

  // remembered for the "welcome back, Ria" screen after signing out
  useEffect(() => {
    if (!user) return
    try {
      localStorage.setItem(WHO, JSON.stringify({ name: user.name, avatar: user.avatar }))
    } catch {
      // storage blocked
    }
  }, [user])

  const createAccount = useCallback(
    async (name: string, upi?: string) => {
      const mnemonic = (await import('@shared/keys')).newMnemonic()
      const id = await createVault(mnemonic, null, 'device')
      const r = await login(id.nostrSecret, { name, upi })
      return finish(r.token, r.user)
    },
    [finish],
  )

  const restoreAccount = useCallback(
    async (mnemonic: string, name?: string) => {
      const id = await createVault(mnemonic, null, 'device')
      let r
      try {
        r = await login(id.nostrSecret, name ? { name } : undefined)
      } catch (e) {
        if (e instanceof ApiError && e.code === 'no_account') return 'needs_name' as const
        throw e
      }
      return finish(r.token, r.user)
    },
    [finish],
  )

  const unlockAndSignIn = useCallback(
    async (secret?: string) => {
      const id = await unlock(secret)
      const r = await login(id.nostrSecret)
      return finish(r.token, r.user)
    },
    [finish],
  )

  const enableCrypto = useCallback(
    async (secret: string | null, kind: 'pin' | 'pass') => {
      if (!user) throw new Error('signed out')
      if (secret !== null && !needsPin()) await setVaultSecret(secret, kind)
      const u = await registerSol(user)
      setUser(u)
      return u
    },
    [user],
  )

  const disableCrypto = useCallback(async () => {
    const r = await api<{ user: User }>('/me/solana', { method: 'DELETE' })
    setUser(r.user)
    lock()
    return r.user
  }, [])

  const upgradeLegacy = useCallback(async () => {
    const mnemonic = (await import('@shared/keys')).newMnemonic()
    const id = await createVault(mnemonic, null, 'device')
    const { challenge } = await api<{ challenge: string }>('/auth/challenge', { method: 'POST', auth: false })
    const event = await authEvent('/api/auth/link', challenge, id.nostrSecret)
    const r = await api<{ token: string; user: User }>('/auth/link', { body: { event, label: deviceLabel() } })
    return finish(r.token, r.user)
  }, [finish])

  const signInWithKey = useCallback(async (token: string) => {
    const prev = tokenStore.get()
    tokenStore.set(token.trim())
    try {
      const r = await api<{ user: User }>('/me')
      setUser(r.user)
      setStatus('in')
      return r.user
    } catch (e) {
      tokenStore.set(prev)
      throw e
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // the session dies on its own eventually
    }
    tokenStore.set(null)
    lock()
    await dropOfflineCopies()
    setUser(null)
    setStatus(readVault() ? 'locked' : 'out')
  }, [])

  const forgetDevice = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // ignore
    }
    tokenStore.set(null)
    wipeVault()
    await dropOfflineCopies()
    try {
      localStorage.removeItem(WHO)
    } catch {
      // ignore
    }
    setUser(null)
    setStatus('out')
  }, [])

  return (
    <SessionCtx.Provider
      value={{ user, ready: status !== 'loading', status, vault, createAccount, restoreAccount, unlockAndSignIn, enableCrypto, disableCrypto, upgradeLegacy, signInWithKey, setUser, signOut, forgetDevice }}
    >
      {children}
    </SessionCtx.Provider>
  )
}

export const useSession = () => useContext(SessionCtx)
