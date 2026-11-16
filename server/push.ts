import { Router } from 'express'
import webpush from 'web-push'
import { auth, limit, type Authed } from './auth'
import { config, createOnce } from './config'
import { q } from './db'
import { HttpError } from './state'

// "Om paid you ₹1,275" on your lock screen, even with the app closed. Standard Web Push (VAPID);
// works on Android, desktop, and iOS 16.4+ once the app is on the home screen.

export function vapidKeys(): { publicKey: string; privateKey: string } {
  if (process.env.BPD_VAPID_PUBLIC && process.env.BPD_VAPID_PRIVATE) return { publicKey: process.env.BPD_VAPID_PUBLIC, privateKey: process.env.BPD_VAPID_PRIVATE }
  return JSON.parse(createOnce('vapid.json', () => JSON.stringify(webpush.generateVAPIDKeys())))
}

const keys = vapidKeys()
webpush.setVapidDetails(process.env.BPD_VAPID_SUBJECT ?? (config.publicUrl?.startsWith('https://') ? config.publicUrl : 'mailto:hello@bhaipaisede.app'), keys.publicKey, keys.privateKey)

// We POST to whatever endpoint a browser hands us, so only accept the real push services.
// Anything else (an internal IP, a metadata URL) would turn us into someone's proxy.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/, /^android\.googleapis\.com$/]

function checkEndpoint(v: unknown): string {
  if (typeof v !== 'string' || v.length > 1000) throw new HttpError(400, 'bad_push', 'bad push endpoint')
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new HttpError(400, 'bad_push', 'bad push endpoint')
  }
  if (u.protocol !== 'https:' || !PUSH_HOSTS.some((re) => re.test(u.hostname))) throw new HttpError(400, 'bad_push', 'push endpoint is not a known push service')
  return v
}

export const push = Router()

push.get('/key', (_req, res) => {
  res.json({ publicKey: keys.publicKey })
})

push.post('/subscribe', auth, limit('push', 30, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const endpoint = checkEndpoint(req.body?.endpoint)
  const p256dh = req.body?.keys?.p256dh
  const authKey = req.body?.keys?.auth
  if (typeof p256dh !== 'string' || typeof authKey !== 'string' || p256dh.length > 200 || authKey.length > 100) throw new HttpError(400, 'bad_push', 'missing push keys')
  q.run(
    'INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth',
    endpoint, u.id, p256dh, authKey, Date.now(),
  )
  res.json({ ok: true })
})

push.post('/unsubscribe', auth, (req, res) => {
  const u = (req as Authed).user
  if (typeof req.body?.endpoint === 'string') q.run('DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?', req.body.endpoint, u.id)
  res.json({ ok: true })
})

type Payload = { title: string; body: string; url?: string; tag?: string }

/** Best effort: a dead subscription is dropped, anything else is ignored. Never throws. */
export async function notify(userId: string, payload: Payload) {
  const subs = q.all<{ endpoint: string; p256dh: string; auth: string }>('SELECT endpoint, p256dh, auth FROM push_subs WHERE user_id = ?', userId)
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600, urgency: 'high', timeout: 8000 })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) q.run('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint)
      }
    }),
  )
}
