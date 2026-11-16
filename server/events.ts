import { q, type MemberRow } from './db'
import { notify } from './push'

// Things that happen in a group (a bill, a payment, someone joining) show up in its chat as small
// event cards, and the people they concern get a push. The card's text is rendered on the phone from
// `meta`, in the reader's language; `body` is the English line used for pushes.

export type EventMeta =
  | { t: 'expense'; id: string; desc: string; amount: number; paidBy: string; kitty?: boolean }
  | { t: 'void'; id: string; desc: string }
  | { t: 'paid'; from: string; to: string; amount: number; method: string }
  | { t: 'claim'; id: string; from: string; to: string; amount: number; method: string; s?: 'confirmed' | 'rejected' | 'cancelled' }
  | { t: 'join'; member: string }
  | { t: 'added'; member: string }
  | { t: 'nudge'; from: string; to: string; amount: number }
  | { t: 'kitty'; holder: string | null; target: number | null }

/** `actor` is the member who did it (their own events don't count as unread for them). */
export function postEvent(groupId: string, actor: string | null, meta: EventMeta, body: string) {
  const now = Date.now()
  q.run("INSERT INTO messages (group_id, member_id, kind, body, meta, created_at, updated_at) VALUES (?,?,'event',?,?,?,?)", groupId, actor, body.slice(0, 300), JSON.stringify(meta), now, now)
}

/** A claim card changes once someone decides on it. */
export function markClaimEvent(groupId: string, claimId: string, s: 'confirmed' | 'rejected' | 'cancelled') {
  q.run(
    "UPDATE messages SET meta = json_set(meta, '$.s', ?), updated_at = ? WHERE group_id = ? AND kind = 'event' AND json_extract(meta, '$.t') = 'claim' AND json_extract(meta, '$.id') = ?",
    s, Date.now(), groupId, claimId,
  )
}

type Push = { title: string; body: string; url: string; tag?: string }

/**
 * Push to the accounts behind these members, skipping anyone who never joined. With a `topic`,
 * each person gets at most one push per topic per `everyMs` (chat would buzz all day otherwise).
 */
export function pushMembers(members: (Pick<MemberRow, 'user_id'> | undefined)[], payload: Push, topic?: string, everyMs = 3 * 60_000) {
  const now = Date.now()
  for (const m of members) {
    const uid = m?.user_id
    if (!uid) continue
    if (topic) {
      const r = q.run('INSERT INTO push_log (user_id, topic, at) VALUES (?,?,?) ON CONFLICT(user_id, topic) DO UPDATE SET at = excluded.at WHERE at < ?', uid, topic, now, now - everyMs)
      if (r.changes === 0) continue
    }
    void notify(uid, payload)
  }
}

export const memberById = (id: string) => q.get<MemberRow>('SELECT * FROM members WHERE id = ?', id)
