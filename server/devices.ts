import { Router } from 'express'
import { auth, limit, type Authed } from './auth'
import { newToken } from './crypto'
import { q } from './db'
import { P } from './http'
import { HttpError } from './state'

// Log in on a new phone by scanning a QR on the old one. The old phone encrypts the account key with
// a fresh random key and uploads only the ciphertext; the random key travels in the QR's #fragment,
// which browsers never send to a server. The new phone fetches the ciphertext once and decrypts it.
// We hold a sealed box we can't open, for ten minutes, for one pickup.

export const devices = Router()

const TTL = 10 * 60_000

devices.post('/devices/link', auth, limit('link', 10, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const blob = req.body?.blob
  if (typeof blob !== 'string' || !/^[\w.-]{40,4000}$/.test(blob)) throw new HttpError(400, 'bad_input', 'bad link data')
  const now = Date.now()
  q.run('DELETE FROM device_links WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)', u.id, now)
  if ((q.get<{ n: number }>('SELECT COUNT(*) n FROM device_links WHERE user_id = ?', u.id)?.n ?? 0) >= 3)
    throw new HttpError(429, 'too_many_links', 'you have a few open already. Wait for them to expire')
  const id = newToken(12)
  q.run('INSERT INTO device_links (id, user_id, blob, created_at, expires_at) VALUES (?,?,?,?,?)', id, u.id, blob, now, now + TTL)
  res.status(201).json({ id, expiresAt: now + TTL })
})

/** The new phone picks it up. Works once. */
devices.post('/devices/link/:id/take', limit('link_take', 30, 10 * 60_000), (req, res) => {
  const now = Date.now()
  const row = q.get<{ blob: string }>('UPDATE device_links SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ? RETURNING blob', now, P(req).id, now)
  if (!row) throw new HttpError(410, 'link_used', 'this login code was already used or ran out. Make a new one on your other phone')
  res.setHeader('Cache-Control', 'no-store')
  res.json({ blob: row.blob })
})

/** The old phone waits on this to say "done". */
devices.get('/devices/link/:id', auth, (req, res) => {
  const u = (req as Authed).user
  const row = q.get<{ used_at: number | null; expires_at: number }>('SELECT used_at, expires_at FROM device_links WHERE id = ? AND user_id = ?', P(req).id, u.id)
  if (!row) throw new HttpError(404, 'not_found', 'no such login code')
  res.setHeader('Cache-Control', 'no-store')
  res.json({ used: !!row.used_at, expired: !row.used_at && row.expires_at < Date.now() })
})

devices.delete('/devices/link/:id', auth, (req, res) => {
  const u = (req as Authed).user
  q.run('DELETE FROM device_links WHERE id = ? AND user_id = ?', P(req).id, u.id)
  res.json({ ok: true })
})

export function cleanupLinks() {
  q.run('DELETE FROM device_links WHERE expires_at < ?', Date.now() - TTL)
}
