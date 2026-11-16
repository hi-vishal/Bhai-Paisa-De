import type { NextFunction, Request, Response } from 'express'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { verifyEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { config } from './config'
import { hashToken, newId, newToken } from './crypto'
import { q, type SessionRow, type UserRow } from './db'
import { HttpError } from './state'

// Sign-in is a signature, not a password. The browser holds a Nostr key derived from the
// recovery phrase; it signs a one-time challenge (NIP-98 style), and we hand back a session.

export const AUTH_KIND = 27235
const CHALLENGE_TTL = 2 * 60_000

export type Authed = Request & { user: UserRow; session: SessionRow | null }

const mac = (s: string) => createHmac('sha256', config.authSecret).update(s).digest('hex')

/** Stateless: `${expires}.${nonce}.${hmac}`. Any worker can check it; used ones are recorded so they work once. */
export function newChallenge() {
  const exp = Date.now() + CHALLENGE_TTL
  const body = `${exp}.${randomBytes(16).toString('hex')}`
  return { challenge: `${body}.${mac(body)}`, expiresAt: exp }
}

function useChallenge(c: unknown) {
  if (typeof c !== 'string') throw new HttpError(400, 'bad_challenge', 'missing challenge')
  const parts = c.split('.')
  if (parts.length !== 3) throw new HttpError(400, 'bad_challenge', 'malformed challenge')
  const [exp, nonce, sig] = parts
  const want = Buffer.from(mac(`${exp}.${nonce}`), 'hex')
  const got = Buffer.from(sig, 'hex')
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new HttpError(400, 'bad_challenge', 'challenge was not issued by this server')
  if (Number(exp) < Date.now()) throw new HttpError(400, 'challenge_expired', 'sign-in took too long, try again')
  const h = createHash('sha256').update(c).digest('hex')
  const r = q.run('INSERT OR IGNORE INTO used_challenges (hash, expires_at) VALUES (?, ?)', h, Number(exp))
  if (r.changes === 0) throw new HttpError(400, 'challenge_used', 'that sign-in was already used')
}

/** Check a signed login event; returns the signer's pubkey. */
export function checkAuthEvent(ev: unknown, path: string): string {
  const e = ev as NostrEvent
  if (!e || typeof e !== 'object' || e.kind !== AUTH_KIND) throw new HttpError(400, 'bad_auth', 'not a sign-in event')
  const tag = (k: string) => e.tags?.find((t) => t[0] === k)?.[1]
  if (!tag('u')?.endsWith(path) || tag('method') !== 'POST') throw new HttpError(400, 'bad_auth', 'sign-in event is for a different request')
  if (Math.abs(e.created_at * 1000 - Date.now()) > CHALLENGE_TTL) throw new HttpError(400, 'bad_auth', "your device clock is off; fix the time and try again")
  if (!verifyEvent(e)) throw new HttpError(401, 'bad_signature', 'signature check failed')
  useChallenge(tag('challenge'))
  return e.pubkey
}

export function createSession(userId: string, label: unknown) {
  const token = newToken(32)
  const now = Date.now()
  const id = newId()
  const name = typeof label === 'string' ? label.slice(0, 60) : null
  q.run('INSERT INTO sessions (id, token_hash, user_id, label, created_at, last_seen, expires_at) VALUES (?,?,?,?,?,?,?)', id, hashToken(token), userId, name, now, now, now + config.sessionDays * 86_400_000)
  return { token, id }
}

const HOUR = 3_600_000

export function auth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization
  const token = h?.startsWith('Bearer ') ? h.slice(7).trim() : null
  if (!token) return next(new HttpError(401, 'no_session', 'not signed in on this device'))
  const th = hashToken(token)
  const now = Date.now()
  const s = q.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', th)
  let user: UserRow | undefined
  if (s) {
    if (s.expires_at < now) return next(new HttpError(401, 'session_expired', 'signed out after a long break. Unlock to sign in again'))
    user = q.get<UserRow>('SELECT * FROM users WHERE id = ?', s.user_id)
    // sliding expiry, written at most once an hour per session so reads stay reads
    if (now - s.last_seen > HOUR) q.run('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?', now, now + config.sessionDays * 86_400_000, s.id)
  } else {
    // accounts made before recovery phrases: a single device key
    user = q.get<UserRow>('SELECT * FROM users WHERE token_hash = ?', th)
  }
  if (!user) return next(new HttpError(401, 'bad_session', "this device key doesn't match any account"))
  ;(req as Authed).user = user
  ;(req as Authed).session = s ?? null
  next()
}

// ---------- rate limits ----------

/**
 * Fixed window per IP and bucket, kept in SQLite so every worker process shares the count.
 * Only on the routes that cost something (sign-up, quotes, wallet checks, RPC).
 */
const SCALE = Math.max(1, Number(process.env.BPD_LIMIT_SCALE ?? 1))

export function limit(bucket: string, maxPerWindow: number, windowMs: number) {
  const max = maxPerWindow * SCALE
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const row = q.get<{ n: number; reset: number }>(
      `INSERT INTO rate_limits (key, n, reset) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET n = CASE WHEN reset < ? THEN 1 ELSE n + 1 END, reset = CASE WHEN reset < ? THEN ? ELSE reset END
       RETURNING n, reset`,
      `${bucket}:${req.ip}`, now + windowMs, now, now, now + windowMs,
    )!
    if (row.n > max) {
      res.setHeader('Retry-After', Math.ceil((row.reset - now) / 1000))
      return next(new HttpError(429, 'slow_down', 'too many tries, wait a minute'))
    }
    next()
  }
}

/** A cheap per-process ceiling on every API call, so one client can't hog a worker. */
export function flood(maxPerMinute: number) {
  const hits = new Map<string, { n: number; reset: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
  }, 60_000).unref()
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now()
    const k = req.ip ?? '?'
    const h = hits.get(k)
    if (!h || h.reset < now) hits.set(k, { n: 1, reset: now + 60_000 })
    else if (++h.n > maxPerMinute) {
      res.setHeader('Retry-After', Math.ceil((h.reset - now) / 1000))
      return next(new HttpError(429, 'slow_down', 'too many requests, give it a minute'))
    }
    next()
  }
}

export function cleanupAuth() {
  const now = Date.now()
  q.run('DELETE FROM used_challenges WHERE expires_at < ?', now)
  q.run('DELETE FROM rate_limits WHERE reset < ?', now)
  q.run('DELETE FROM sessions WHERE expires_at < ?', now)
}
