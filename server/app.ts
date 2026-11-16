import express, { type NextFunction, type Request, type Response } from 'express'
import compression from 'compression'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatMoney } from '../shared/money'
import { api } from './api'
import { cleanupAuth, flood } from './auth'
import { chat } from './chat'
import { claims } from './claims'
import { config, ROOT } from './config'
import { db, q, type GroupRow, type PaylinkRow, type UserRow } from './db'
import { cleanupLinks, devices } from './devices'
import { media } from './media'
import { serverPubkey, startPublisher, stopPublisher } from './nostr'
import { pay, startQuoteWatcher } from './pay'
import { people } from './people'
import { push } from './push'
import { solana } from './solana'
import { HttpError, loadGroupState, owed } from './state'

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://fonts.gstatic.com",
  "font-src 'self'",
  "media-src 'self' blob:",
  // "check a backup" reads relays straight from the browser; animated emoji come from fonts.gstatic.com
  "connect-src 'self' wss: https://fonts.gstatic.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Pay tokens, invite codes and login codes are capabilities: never write them to a log. */
const redact = (path: string) =>
  path
    .replace(/^\/api\/pay\/[^/]+/, '/api/pay/:token')
    .replace(/^\/api\/invites\/[^/]+/, '/api/invites/:code')
    .replace(/^\/api\/devices\/link\/[^/]+/, '/api/devices/link/:id')
    .replace(/^\/(p|j)\/[^/]+/, '/$1/:token')

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

type Meta = { title: string; description: string }
const DEFAULT_META: Meta = { title: 'Bhai Paise De', description: 'Split bills with friends and get paid back by UPI in a tap. Free.' }

/**
 * What WhatsApp and friends show when a link is shared: "Om, you owe Ria ₹340" beats a bare URL.
 * Only names, the group and the amount, which the person holding the link sees anyway.
 */
function metaFor(path: string): Meta {
  try {
    let m = /^\/p\/([\w-]{8,40})$/.exec(path)
    if (m) {
      const link = q.get<PaylinkRow>('SELECT * FROM paylinks WHERE token = ?', m[1])
      if (!link) return DEFAULT_META
      const s = loadGroupState(link.group_id)
      const from = s.members.find((x) => x.id === link.from_member)!
      const to = s.members.find((x) => x.id === link.to_member)!
      const due = owed(s, from.id, to.id)
      return due > 0
        ? { title: `${from.name}, you owe ${to.name} ${formatMoney(due, s.currency)}`, description: `${s.group.emoji} ${s.group.name}. Tap to pay by UPI in a few seconds. No app needed.` }
        : { title: `${from.name} and ${to.name} are square`, description: `${s.group.emoji} ${s.group.name} on Bhai Paise De` }
    }
    m = /^\/j\/([\w-]{6,40})$/.exec(path)
    if (m) {
      const g = q.get<GroupRow>('SELECT * FROM groups WHERE invite_code = ?', m[1])
      if (!g) return DEFAULT_META
      const n = q.get<{ n: number }>('SELECT COUNT(*) n FROM members WHERE group_id = ?', g.id)?.n ?? 0
      return { title: `Join ${g.emoji} ${g.name}`, description: `${n} people splitting bills on Bhai Paise De. Tap to join. It takes five seconds.` }
    }
    m = /^\/u\/([0-9a-z]{12})$/.exec(path)
    if (m) {
      const u = q.get<UserRow>('SELECT * FROM users WHERE id = ?', m[1])
      if (u) return { title: `${u.name} on Bhai Paise De`, description: `Pay ${u.name} by UPI or split bills together. Free.` }
    }
  } catch {
    // a preview is never worth an error page
  }
  return DEFAULT_META
}

function withMeta(html: string, meta: Meta, origin: string, path: string) {
  const t = esc(meta.title)
  const d = esc(meta.description)
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${d}`)
    .replace(/(<meta property="og:title" content=")[^"]*/, `$1${t}`)
    .replace(/(<meta property="og:description" content=")[^"]*/, `$1${d}`)
    .replace(/(<meta property="og:image" content=")[^"]*/, `$1${esc(origin)}/og.png`)
    .replace(/(<meta property="og:url" content=")[^"]*/, `$1${esc(origin + path)}`)
}


export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', Number(process.env.BPD_TRUST_PROXY ?? 1))
  app.use(compression({ threshold: 1024 }))

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()')
    res.setHeader('Content-Security-Policy', CSP)
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    const t0 = performance.now()
    res.on('finish', () => {
      const ms = performance.now() - t0
      if (res.statusCode >= 500 || ms > 1500) console.warn(`[http] ${req.method} ${redact(req.path)} ${res.statusCode} ${ms.toFixed(0)}ms`)
    })
    next()
  })

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, pid: process.pid, uptime: Math.round(process.uptime()) })
  })
  app.get('/readyz', (_req, res) => {
    const v = db.prepare('PRAGMA user_version').get() as { user_version: number }
    res.json({ ok: true, schema: v.user_version, crypto: config.solana.enabled ? config.solana.cluster : 'off', offsite: config.nostrEnabled })
  })

  app.use('/api', flood(Number(process.env.BPD_FLOOD_PER_MIN ?? 900)), express.json({ limit: '64kb' }))
  app.use('/api/pay', pay)
  app.use('/api/sol', solana)
  app.use('/api/push', push)
  app.use('/api', api, claims, chat, media, devices, people)
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'no such endpoint')))

  const dist = join(ROOT, 'dist')
  if (existsSync(dist)) {
    // Android app links / Play Store TWA verification (express.static skips dot-folders by default)
    app.use('/.well-known', express.static(join(dist, '.well-known'), { maxAge: '1h' }))
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, p) => {
          // hashed build output never changes; everything else must be re-checked so updates land
          if (/[/\\]assets[/\\]/.test(p)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
          else if (/(sw|registerSW|workbox-[\w]+)\.js$|\.webmanifest$|\.html$/.test(p)) res.setHeader('Cache-Control', 'no-cache')
          else res.setHeader('Cache-Control', 'public, max-age=86400')
        },
      }),
    )
    const index = readFileSync(join(dist, 'index.html'), 'utf8')
    const pages = flood(Number(process.env.BPD_FLOOD_PER_MIN ?? 900))
    app.get(/^(?!\/api\/).*/, pages, (req, res) => {
      // prefer the configured URL; a Host header is only trusted if it looks like a host
      const host = req.get('host') ?? ''
      const origin = config.publicUrl ?? (/^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${req.protocol}://${host}` : '')
      res.setHeader('Cache-Control', 'private, no-cache')
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.send(withMeta(index, metaFor(req.path), origin, req.path))
    })
  }

  // Errors carry a code the app can translate. Request bodies are never logged.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message })
    const type = err && typeof err === 'object' && 'type' in err ? (err as { type: string }).type : ''
    if (type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json', message: 'request body is not valid JSON' })
    if (type === 'entity.too.large') return res.status(413).json({ error: 'too_large', message: 'request is too big' })
    console.error(`[api] ${req.method} ${redact(req.path)}:`, (err as Error)?.message ?? err)
    res.status(500).json({ error: 'server_error', message: 'something broke on our side' })
  })
  return app
}

/** Run one HTTP worker. `jobs`: also run the background work (publisher, payment watcher, cleanup). */
export function start({ jobs }: { jobs: boolean }) {
  const app = createApp()
  const server = app.listen(config.port, config.host, () => {
    if (jobs) {
      console.log(`\n  🤑 Bhai Paise De on http://localhost:${config.port}  (${config.prod ? 'production' : 'dev'}, ${config.workers} worker${config.workers > 1 ? 's' : ''})`)
      console.log(`  ledger signer ${serverPubkey.slice(0, 16)}…  relays: ${config.nostrEnabled ? config.relays.join(', ') : 'off'}`)
      console.log(`  crypto ${config.solana.enabled ? `${config.solana.cluster} · ${config.solana.stableLabel}` : 'off'}  ·  demo payments ${config.demoWallet ? 'on' : 'off'}  ·  tip jar ${config.tip.upi ? 'on' : 'off'}\n`)
    }
  })
  // behind a proxy/load balancer: keep idle sockets a bit longer than it does, and cap slow requests
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 30_000

  const timers: NodeJS.Timeout[] = []
  if (jobs) {
    startPublisher()
    startQuoteWatcher()
    cleanupAuth()
    timers.push(setInterval(() => (cleanupAuth(), cleanupLinks()), 10 * 60_000))
    timers.push(setInterval(() => db.exec('PRAGMA optimize'), 6 * 60 * 60_000))
  }

  let closing = false
  const stop = (signal: string) => {
    if (closing) return
    closing = true
    console.log(`[${process.pid}] ${signal}: finishing requests…`)
    timers.forEach(clearInterval)
    server.close(() => {
      if (jobs) stopPublisher()
      db.close()
      process.exit(0)
    })
    server.closeIdleConnections()
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  return server
}
