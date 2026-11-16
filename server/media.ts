import express, { Router } from 'express'
import sharp from 'sharp'
import { auth, limit, type Authed } from './auth'
import { q, type ExpenseRow, type GroupRow } from './db'
import { freshUser, memberOf, P } from './http'
import { HttpError } from './state'

// Profile photos and receipt photos. Every upload is decoded and re-encoded here, so what we serve
// is always a plain image we made: no camera location data, no odd file that only looks like a photo.

export const media = Router()

sharp.cache(false)
sharp.concurrency(1)

const raw = (mb: number) => express.raw({ type: ['image/*', 'application/octet-stream'], limit: `${mb}mb` })

/** Photos only. Vector and document formats (SVG, PDF) can reference other files, so they never get decoded. */
const PHOTO_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'heif', 'avif', 'tiff'])

async function reencode(buf: unknown, size: number, square: boolean) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new HttpError(400, 'no_image', 'send a photo')
  let format: string | undefined
  try {
    format = (await sharp(buf, { limitInputPixels: 50_000_000 }).metadata()).format
  } catch {
    // unreadable: reported below
  }
  if (!format || !PHOTO_FORMATS.has(format)) throw new HttpError(400, 'bad_image', "that file isn't a photo we can read. Try a JPG or PNG")
  try {
    const img = sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error', animated: false }).rotate()
    const resized = square ? img.resize(size, size, { fit: 'cover', position: 'attention' }) : img.resize(size, size, { fit: 'inside', withoutEnlargement: true })
    return await resized.webp({ quality: square ? 82 : 78, effort: 4 }).toBuffer()
  } catch {
    throw new HttpError(400, 'bad_image', "that file isn't a photo we can read. Try a JPG or PNG")
  }
}

const sendImage = (res: express.Response, data: Uint8Array, cache: string) => {
  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('Cache-Control', cache)
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.end(Buffer.from(data))
}

// ---------- profile photos ----------

media.put('/me/avatar', auth, limit('avatar', 20, 60 * 60_000), raw(8), async (req, res) => {
  const u = (req as Authed).user
  const data = await reencode(req.body, 256, true)
  q.run('INSERT INTO avatars (user_id, data, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at', u.id, data, Date.now())
  q.run('UPDATE users SET avatar_v = avatar_v + 1 WHERE id = ?', u.id)
  res.json({ user: freshUser(u.id) })
})

media.delete('/me/avatar', auth, (req, res) => {
  const u = (req as Authed).user
  q.run('DELETE FROM avatars WHERE user_id = ?', u.id)
  q.run('UPDATE users SET avatar_v = 0 WHERE id = ?', u.id)
  res.json({ user: freshUser(u.id) })
})

/** Public by account id (ids are random). The version in the path makes each photo its own URL. */
media.get('/avatars/:uid/:v', (req, res) => {
  const row = q.get<{ data: Uint8Array; v: number }>('SELECT a.data data, u.avatar_v v FROM avatars a JOIN users u ON u.id = a.user_id WHERE a.user_id = ?', P(req).uid)
  if (!row) throw new HttpError(404, 'not_found', 'no photo')
  const current = String(row.v) === P(req).v
  sendImage(res, row.data, current ? 'public, max-age=31536000, immutable' : 'public, max-age=300')
})

// ---------- receipts ----------

function expenseIn(groupId: string, eid: string) {
  const e = q.get<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', eid, groupId)
  if (!e) throw new HttpError(404, 'not_found', 'expense not found')
  return e
}

media.put('/groups/:id/expenses/:eid/receipt', auth, limit('receipt', 60, 60 * 60_000), raw(15), async (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const e = expenseIn(me.group_id, P(req).eid)
  const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', me.group_id)!
  if (e.created_by !== me.id && e.paid_by !== me.id && g.created_by !== u.id) throw new HttpError(403, 'not_yours', 'only whoever added or paid this bill can attach the receipt')
  const data = await reencode(req.body, 1600, false)
  q.run('INSERT INTO receipts (expense_id, group_id, data, created_at) VALUES (?,?,?,?) ON CONFLICT(expense_id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at', e.id, me.group_id, data, Date.now())
  q.run('UPDATE expenses SET has_receipt = 1 WHERE id = ?', e.id)
  res.json({ ok: true })
})

media.get('/groups/:id/expenses/:eid/receipt', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const row = q.get<{ data: Uint8Array }>('SELECT data FROM receipts WHERE expense_id = ? AND group_id = ?', P(req).eid, me.group_id)
  if (!row) throw new HttpError(404, 'not_found', 'no receipt on this bill')
  sendImage(res, row.data, 'private, max-age=3600')
})

media.delete('/groups/:id/expenses/:eid/receipt', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const e = expenseIn(me.group_id, P(req).eid)
  if (e.created_by !== me.id && e.paid_by !== me.id) throw new HttpError(403, 'not_yours', 'only whoever added or paid this bill can remove the receipt')
  q.run('DELETE FROM receipts WHERE expense_id = ?', e.id)
  q.run('UPDATE expenses SET has_receipt = 0 WHERE id = ?', e.id)
  res.json({ ok: true })
})
