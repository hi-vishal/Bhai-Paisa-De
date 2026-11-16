import { Router } from 'express'
import { auth, limit, type Authed } from './auth'
import { newId } from './crypto'
import { q, type ExpenseRow, type MemberRow, type RecurringRow, type UserRow } from './db'
import { avatarUrl, memberOf, P } from './http'
import { HttpError } from './state'

// Friends (people you already split with), your shareable card, and bills that come back every month.

export const people = Router()

/** Everyone who shares a group with you and is on the app, most-shared first. */
people.get('/friends', auth, (req, res) => {
  const u = (req as Authed).user
  const rows = q.all<Pick<UserRow, 'id' | 'name' | 'avatar_v' | 'upi_id'> & { shared: number }>(
    `SELECT u.id, u.name, u.avatar_v, u.upi_id, COUNT(DISTINCT m2.group_id) shared
     FROM members m1
     JOIN members m2 ON m2.group_id = m1.group_id AND m2.user_id IS NOT NULL AND m2.user_id != m1.user_id
     JOIN users u ON u.id = m2.user_id
     WHERE m1.user_id = ?
     GROUP BY u.id ORDER BY shared DESC, u.name LIMIT 200`,
    u.id,
  )
  res.json({ friends: rows.map((f) => ({ id: f.id, name: f.name, avatar: avatarUrl(f), upi: !!f.upi_id, shared: f.shared })) })
})

/** The card behind your "share my profile" link: photo, name, and the UPI ID to pay you on. */
people.get('/users/:id/card', limit('card', 120, 10 * 60_000), (req, res) => {
  const u = q.get<UserRow>('SELECT * FROM users WHERE id = ?', P(req).id)
  if (!u) throw new HttpError(404, 'no_user', "this profile link doesn't work anymore")
  res.setHeader('Cache-Control', 'private, max-age=60')
  res.json({ id: u.id, name: u.name, avatar: avatarUrl(u), upi: u.upi_id, since: u.created_at })
})

// ---------- repeating bills ----------
// The server only keeps the template and the date. When it's due, your phone shows "add it?" and you
// add it with one tap, signed by you like any other bill.

const DAY = 86_400_000

export function nextDate(from: number, every: 'week' | 'month') {
  if (every === 'week') return from + 7 * DAY
  const d = new Date(from)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()))
  return d.getTime()
}

type Template = { description: string; category: string; amount: number; paidBy: string; split: unknown; kitty: boolean }

people.post('/groups/:id/recurring', auth, limit('recurring', 30, 60 * 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const e = q.get<ExpenseRow>('SELECT * FROM expenses WHERE id = ? AND group_id = ?', req.body?.expenseId, me.group_id)
  if (!e) throw new HttpError(404, 'not_found', 'expense not found')
  if (e.created_by !== me.id) throw new HttpError(403, 'not_yours', 'only whoever added the bill can make it repeat')
  const every = req.body?.every === 'week' ? 'week' : 'month'
  if (q.get("SELECT id FROM recurring WHERE member_id = ? AND stopped_at IS NULL AND json_extract(template, '$.description') = ?", me.id, e.description))
    throw new HttpError(409, 'already_repeats', `${e.description} already repeats`)
  const t: Template = { description: e.description, category: e.category, amount: e.amount, paidBy: e.paid_by, split: JSON.parse(e.split_json), kitty: !!e.from_kitty }
  const id = newId()
  q.run('INSERT INTO recurring (id, group_id, member_id, template, every, next_at, created_at) VALUES (?,?,?,?,?,?,?)', id, me.group_id, me.id, JSON.stringify(t), every, nextDate(e.created_at, every), Date.now())
  res.status(201).json({ id })
})

/** Your repeating bills across groups; `due` ones get the "add it?" card on Home. */
people.get('/recurring', auth, (req, res) => {
  const u = (req as Authed).user
  const now = Date.now()
  const rows = q.all<RecurringRow & { g_name: string; g_emoji: string; g_currency: string }>(
    `SELECT r.*, g.name g_name, g.emoji g_emoji, g.currency g_currency FROM recurring r
     JOIN members m ON m.id = r.member_id JOIN groups g ON g.id = r.group_id
     WHERE m.user_id = ? AND r.stopped_at IS NULL ORDER BY r.next_at`,
    u.id,
  )
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      groupName: r.g_name,
      emoji: r.g_emoji,
      currency: r.g_currency,
      every: r.every,
      nextAt: r.next_at,
      due: r.next_at <= now,
      template: JSON.parse(r.template) as Template,
    })),
  })
})

function mine(u: UserRow, rid: string) {
  const r = q.get<RecurringRow>('SELECT * FROM recurring WHERE id = ? AND stopped_at IS NULL', rid)
  const m = r && q.get<MemberRow>('SELECT * FROM members WHERE id = ?', r.member_id)
  if (!r || !m || m.user_id !== u.id) throw new HttpError(404, 'not_found', 'that repeating bill is gone')
  return r
}

/** Added (or skipped) this time: move to the next date after today. */
people.post('/recurring/:rid/next', auth, (req, res) => {
  const r = mine((req as Authed).user, P(req).rid)
  let next = r.next_at
  const now = Date.now()
  while (next <= now) next = nextDate(next, r.every)
  q.run('UPDATE recurring SET next_at = ? WHERE id = ?', next, r.id)
  res.json({ nextAt: next })
})

people.delete('/recurring/:rid', auth, (req, res) => {
  const r = mine((req as Authed).user, P(req).rid)
  q.run('UPDATE recurring SET stopped_at = ? WHERE id = ?', Date.now(), r.id)
  res.json({ ok: true })
})
