import { Router } from 'express'
import { cleanText } from '../shared/canon'
import { auth, limit, type Authed } from './auth'
import { q, type GroupRow, type MemberRow, type MessageRow } from './db'
import { pushMembers } from './events'
import { memberOf, P } from './http'
import { HttpError } from './state'

// A small chat inside every group. Bills and payments land here as event cards, so the
// conversation and the money sit in one place. Not part of the signed ledger: it's talk, not money.

export const chat = Router()

export const REACTIONS = ['😂', '❤️', '🔥', '👍', '😭', '💸'] as const
const PAGE = 50

type Reaction = { message_id: number; member_id: string; emoji: string }

function view(rows: MessageRow[]) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)
  const reacts = q.all<Reaction>(`SELECT * FROM reactions WHERE message_id IN (${ids.map(() => '?').join(',')})`, ...ids)
  return rows.map((r) => ({
    id: r.id,
    by: r.member_id,
    kind: r.kind,
    text: r.deleted_at ? '' : r.body,
    meta: r.kind === 'event' && r.meta ? JSON.parse(r.meta) : null,
    at: r.created_at,
    deleted: !!r.deleted_at,
    reactions: reacts.filter((x) => x.message_id === r.id).map((x) => ({ by: x.member_id, emoji: x.emoji })),
  }))
}

/**
 * `after`: everything newer than this id (the phone polls with its last id).
 * `before`: an older page, for scrolling up. Neither: the latest page.
 */
chat.get('/groups/:id/chat', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const after = Number(req.query.after)
  const before = Number(req.query.before)
  let rows: MessageRow[]
  if (Number.isSafeInteger(after) && after >= 0 && req.query.after !== undefined)
    rows = q.all<MessageRow>('SELECT * FROM messages WHERE group_id = ? AND id > ? ORDER BY id LIMIT 200', me.group_id, after)
  else if (Number.isSafeInteger(before) && before > 0)
    rows = q.all<MessageRow>('SELECT * FROM messages WHERE group_id = ? AND id < ? ORDER BY id DESC LIMIT ?', me.group_id, before, PAGE).reverse()
  else rows = q.all<MessageRow>('SELECT * FROM messages WHERE group_id = ? ORDER BY id DESC LIMIT ?', me.group_id, PAGE).reverse()
  const read = q.get<{ last_read: number }>('SELECT last_read FROM chat_reads WHERE member_id = ?', me.id)?.last_read ?? 0
  // reactions, deletes and decided payment cards change older messages: send those changed since the last poll
  const since = Number(req.query.since)
  const changed =
    req.query.after !== undefined && Number.isSafeInteger(since) && since > 0
      ? view(q.all<MessageRow>('SELECT * FROM messages WHERE group_id = ? AND updated_at > ? AND id <= ? ORDER BY id DESC LIMIT 100', me.group_id, since, after))
      : []
  res.setHeader('Cache-Control', 'no-store')
  res.json({ messages: view(rows), changed, lastRead: read, more: req.query.after === undefined && rows.length === PAGE, now: Date.now() })
})

chat.post('/groups/:id/chat', auth, limit('chat', 40, 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const raw = req.body?.text
  if (typeof raw !== 'string') throw new HttpError(400, 'bad_input', 'say something')
  // keep line breaks, squash everything else
  const text = raw
    .split('\n')
    .map((l) => cleanText(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!text) throw new HttpError(400, 'bad_input', 'say something')
  if (text.length > 500) throw new HttpError(400, 'too_long', 'keep it under 500 characters')
  const clientId = typeof req.body?.clientId === 'string' && /^[\w-]{6,40}$/.test(req.body.clientId) ? req.body.clientId : null
  const now = Date.now()
  // the same clientId twice (a retry on a bad connection) posts once
  q.run("INSERT OR IGNORE INTO messages (group_id, member_id, kind, body, client_id, created_at, updated_at) VALUES (?,?,'text',?,?,?,?)", me.group_id, me.id, text, clientId, now, now)
  const row = clientId
    ? q.get<MessageRow>('SELECT * FROM messages WHERE group_id = ? AND member_id = ? AND client_id = ?', me.group_id, me.id, clientId)!
    : q.get<MessageRow>('SELECT * FROM messages WHERE group_id = ? AND member_id = ? ORDER BY id DESC LIMIT 1', me.group_id, me.id)!
  q.run('INSERT INTO chat_reads (member_id, last_read) VALUES (?,?) ON CONFLICT(member_id) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)', me.id, row.id)
  if (row.created_at === now) {
    const g = q.get<GroupRow>('SELECT * FROM groups WHERE id = ?', me.group_id)!
    const others = q.all<MemberRow>('SELECT * FROM members WHERE group_id = ? AND user_id IS NOT NULL AND id != ?', me.group_id, me.id)
    pushMembers(others, { title: `${g.emoji} ${g.name}`, body: `${me.name}: ${text.slice(0, 120)}`, url: `/g/${g.id}?tab=chat`, tag: `chat-${g.id}` }, `chat:${g.id}`)
  }
  res.status(201).json({ message: view([row])[0] })
})

chat.post('/groups/:id/chat/:mid/react', auth, limit('react', 120, 60_000), (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const m = q.get<MessageRow>('SELECT * FROM messages WHERE id = ? AND group_id = ?', Number(P(req).mid), me.group_id)
  if (!m || m.deleted_at) throw new HttpError(404, 'not_found', 'message not found')
  const emoji = req.body?.emoji
  if (emoji === null || emoji === '') q.run('DELETE FROM reactions WHERE message_id = ? AND member_id = ?', m.id, me.id)
  else if ((REACTIONS as readonly string[]).includes(emoji))
    q.run('INSERT INTO reactions (message_id, member_id, emoji) VALUES (?,?,?) ON CONFLICT(message_id, member_id) DO UPDATE SET emoji = excluded.emoji', m.id, me.id, emoji)
  else throw new HttpError(400, 'bad_emoji', 'pick one of the reactions')
  q.run('UPDATE messages SET updated_at = ? WHERE id = ?', Date.now(), m.id)
  res.json({ message: view([q.get<MessageRow>('SELECT * FROM messages WHERE id = ?', m.id)!])[0] })
})

chat.delete('/groups/:id/chat/:mid', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const now = Date.now()
  const r = q.run("UPDATE messages SET deleted_at = ?, updated_at = ?, body = '' WHERE id = ? AND group_id = ? AND member_id = ? AND kind = 'text' AND deleted_at IS NULL", now, now, Number(P(req).mid), me.group_id, me.id)
  if (r.changes === 0) throw new HttpError(404, 'not_found', 'you can only delete your own messages')
  res.json({ ok: true })
})

chat.post('/groups/:id/chat/read', auth, (req, res) => {
  const u = (req as Authed).user
  const me = memberOf(P(req).id, u.id)
  const last = Number(req.body?.last)
  if (!Number.isSafeInteger(last) || last < 0) throw new HttpError(400, 'bad_input', 'bad read marker')
  q.run('INSERT INTO chat_reads (member_id, last_read) VALUES (?,?) ON CONFLICT(member_id) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)', me.id, last)
  res.json({ ok: true })
})
