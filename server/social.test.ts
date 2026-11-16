// End to end: UPI IDs and "I've paid" claims (confirm, reject, limits), the kitty, group chat,
// photos and receipts, logging in on a second phone, adding friends, nudges, repeating bills,
// and link previews. Against the real app and a throwaway database.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import sharp from 'sharp'
import { newId } from '../shared/canon'
import { claimSettlement } from '../shared/claims'
import { identityFromMnemonic, newMnemonic, type Identity } from '../shared/keys'
import { verifyChain, type EntryData } from '../shared/ledger'
import { joinName } from '../shared/rules'
import { computeSplit } from '../shared/split'
import { client, sign, startApp, testEnv } from './testkit'

const env = testEnv()
let app: Awaited<ReturnType<typeof startApp>>
let api: ReturnType<typeof client>
let ria: Identity, om: Identity, kabir: Identity
const t: Record<string, string> = {}
const g = { id: '', invite: '', ria: '', om: '', zoya: '' }
const users: Record<string, string> = {}

before(async () => {
  app = await startApp()
  api = client(app.base)
  ;[ria, om, kabir] = await Promise.all([identityFromMnemonic(newMnemonic()), identityFromMnemonic(newMnemonic()), identityFromMnemonic(newMnemonic())])
})

after(() => {
  app.close()
  env.cleanup()
})

const call = (...a: Parameters<ReturnType<typeof client>['call']>) => api.call(...a)

async function addExpense(who: Identity, token: string, by: string, desc: string, amount: number, ids: string[], extra: { kitty?: boolean; paidBy?: string } = {}) {
  const split = { mode: 'equal' as const, memberIds: ids }
  const id = newId()
  const r = computeSplit(split, amount, [g.ria, g.om, g.zoya])
  const paidBy = extra.paidBy ?? by
  const data: EntryData = { type: 'expense', id, description: desc, category: 'food', paidBy, total: r.total, shares: r.shares, mode: 'equal', kitty: extra.kitty || undefined, by }
  return call(`/groups/${g.id}/expenses`, { token, body: { id, description: desc, category: 'food', paidBy, amount, split, kitty: extra.kitty, signed: sign(who, g.id, data) } })
}

test('sign up with a UPI ID; a bad one is refused', async () => {
  assert.equal((await api.login(ria, 'Ria', { upi: 'not a upi' })).body.error, 'bad_upi')
  const r = await api.login(ria, 'Ria', { upi: ' Ria.Sharma@OkHDFCBank ' })
  assert.equal(r.status, 201)
  assert.equal(r.body.user.upi, 'ria.sharma@okhdfcbank')
  t.ria = r.body.token
  users.ria = r.body.user.id
  const o = await api.login(om, 'Om')
  t.om = o.body.token
  users.om = o.body.user.id
  const k = await api.login(kabir, 'Kabir')
  t.kabir = k.body.token
  users.kabir = k.body.user.id
  const patched = await call('/me', { method: 'PATCH', token: t.om, body: { upi: 'om@ybl' } })
  assert.equal(patched.body.user.upi, 'om@ybl')
  assert.equal((await call('/me', { method: 'PATCH', token: t.om, body: { upi: 'om' } })).body.error, 'bad_upi')
  const info = await call('/server')
  assert.equal(info.body.tip, null)
})

test('a group; Om claims his name; a bill', async () => {
  const id = newId()
  const memberIds = [newId(), newId(), newId()]
  const by = memberIds[0]
  const entries: EntryData[] = [
    { type: 'group', id, name: 'Flat 4B', currency: 'INR', emoji: '🏠', by },
    { type: 'member', id: memberIds[0], name: 'Ria', position: 0, pubkey: ria.nostrPubkey, by },
    { type: 'member', id: memberIds[1], name: 'Om', position: 1, by },
    { type: 'member', id: memberIds[2], name: 'Zoya', position: 2, by },
  ]
  const r = await call('/groups', { token: t.ria, body: { name: 'Flat 4B', emoji: '🏠', currency: 'INR', members: ['Om', 'Zoya'], id, memberIds, signed: entries.map((d) => sign(ria, id, d)) } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  Object.assign(g, { id, invite: r.body.group.inviteCode, ria: memberIds[0], om: memberIds[1], zoya: memberIds[2] })
  const j = await call(`/invites/${g.invite}/join`, { token: t.om, body: { memberId: g.om, signed: sign(om, g.id, { type: 'claim', memberId: g.om, pubkey: om.nostrPubkey }) } })
  assert.equal(j.body.memberId, g.om)
  const e = await addExpense(ria, t.ria, g.ria, 'Groceries', 90000, [g.ria, g.om, g.zoya])
  assert.equal(e.status, 201, JSON.stringify(e.body))
  assert.equal(e.body.balances.net[g.om], -30000)
  const om2 = e.body.members.find((m: { id: string }) => m.id === g.om)
  assert.equal(om2.upi, 'om@ybl')
  assert.equal(om2.joined, true)
})

test('pay link: UPI rail, "I’ve paid", and only the payee can confirm', async () => {
  const link = await call(`/groups/${g.id}/paylinks`, { token: t.ria, body: { from: g.om, to: g.ria } })
  const token = link.body.token
  const page = await call(`/pay/${token}`)
  assert.deepEqual(page.body.to.rails, { UPI: true, USDT: false, SOL: false })
  assert.equal(page.body.to.upi, 'ria.sharma@okhdfcbank')
  assert.equal(page.body.owed, 30000)
  assert.equal((await call(`/pay/${token}/claims`, { body: { amount: 40000, method: 'upi' } })).body.error, 'too_much')
  const c = await call(`/pay/${token}/claims`, { body: { amount: 30000, method: 'upi', ref: '1234 5678 9012' } })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  assert.equal(c.body.claim.ref, '123456789012')
  assert.equal((await call(`/pay/${token}/claims`, { body: { amount: 100, method: 'upi' } })).body.error, 'already_claimed')
  assert.equal((await call(`/pay/${token}`)).body.claim.status, 'pending')

  const grp = await call(`/groups/${g.id}`, { token: t.ria })
  const claim = grp.body.claims[0]
  assert.equal(claim.amount, 30000)
  const sid = newId()
  const data = claimSettlement({ from: g.om, to: g.ria, amount: 30000, method: 'upi', ref: '123456789012' }, sid, g.ria)
  // Om can't confirm his own payment, and Ria's signature has to be over exactly the settlement
  assert.equal((await call(`/groups/${g.id}/claims/${claim.id}/confirm`, { token: t.om, body: { id: sid, signed: sign(om, g.id, data) } })).body.error, 'not_your_call')
  const tampered = { ...data, amount: 1 } as EntryData
  assert.equal((await call(`/groups/${g.id}/claims/${claim.id}/confirm`, { token: t.ria, body: { id: sid, signed: sign(ria, g.id, tampered) } })).body.error, 'signature_mismatch')
  const ok = await call(`/groups/${g.id}/claims/${claim.id}/confirm`, { token: t.ria, body: { id: sid, signed: sign(ria, g.id, data) } })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))
  assert.equal(ok.body.balances.net[g.om], 0)
  const s = ok.body.settlements.find((x: { id: string }) => x.id === sid)
  assert.equal(s.method, 'upi')
  assert.equal(s.ref, '123456789012')
  assert.equal(ok.body.claims.length, 0)
  assert.equal((await call(`/groups/${g.id}/claims/${claim.id}/confirm`, { token: t.ria, body: { id: newId(), signed: sign(ria, g.id, data) } })).body.error, 'claim_done')
  assert.equal((await call(`/pay/${token}`)).body.claim.status, 'confirmed')
})

test('in-app claim, rejected by the payee; and a cancel', async () => {
  await addExpense(ria, t.ria, g.ria, 'Wifi', 30000, [g.ria, g.om, g.zoya])
  const r = await call(`/groups/${g.id}/claims`, { token: t.om, body: { to: g.ria, amount: 10000, method: 'cash' } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  const cid = r.body.claims[0].id
  assert.equal((await call(`/groups/${g.id}/claims/${cid}/reject`, { token: t.om, body: {} })).body.error, 'not_your_call')
  const rej = await call(`/groups/${g.id}/claims/${cid}/reject`, { token: t.ria, body: {} })
  assert.equal(rej.body.claims.length, 0)
  assert.equal(rej.body.balances.net[g.om], -10000)
  const again = await call(`/groups/${g.id}/claims`, { token: t.om, body: { to: g.ria, amount: 10000, method: 'upi' } })
  const cancel = await call(`/groups/${g.id}/claims/${again.body.claims[0].id}/cancel`, { token: t.om, body: {} })
  assert.equal(cancel.body.claims.length, 0)
  // Zoya never joined: nobody can confirm, so a claim makes no sense
  assert.equal((await call(`/groups/${g.id}/claims`, { token: t.om, body: { to: g.zoya, amount: 100 } })).body.error, 'payee_not_joined')
})

test('kitty: money in (claimed and recorded), a bill out of it, and what is left', async () => {
  assert.equal((await call(`/groups/${g.id}/kitty`, { method: 'PATCH', token: t.ria, body: { holder: g.zoya } })).body.error, 'holder_not_joined')
  const on = await call(`/groups/${g.id}/kitty`, { method: 'PATCH', token: t.ria, body: { holder: g.ria, target: 300000 } })
  assert.equal(on.body.group.kitty.holder, g.ria)
  // Om can't take it over
  assert.equal((await call(`/groups/${g.id}/kitty`, { method: 'PATCH', token: t.om, body: { holder: g.om } })).body.error, 'not_your_call')

  const c = await call(`/groups/${g.id}/claims`, { token: t.om, body: { to: g.ria, amount: 100000, method: 'kitty' } })
  assert.equal(c.status, 201, JSON.stringify(c.body))
  const claim = c.body.claims.find((x: { method: string }) => x.method === 'kitty')
  const sid = newId()
  const data = claimSettlement({ from: g.om, to: g.ria, amount: 100000, method: 'kitty', ref: null }, sid, g.ria)
  const ok = await call(`/groups/${g.id}/claims/${claim.id}/confirm`, { token: t.ria, body: { id: sid, signed: sign(ria, g.id, data) } })
  assert.equal(ok.status, 200, JSON.stringify(ok.body))

  // the holder's own money in: from and to are both Ria
  const mid = newId()
  const mine: EntryData = { type: 'settlement', id: mid, from: g.ria, to: g.ria, amount: 100000, method: 'kitty', by: g.ria }
  const own = await call(`/groups/${g.id}/settlements`, { token: t.ria, body: { id: mid, from: g.ria, to: g.ria, amount: 100000, method: 'kitty', signed: sign(ria, g.id, mine) } })
  assert.equal(own.status, 201, JSON.stringify(own.body))
  assert.equal(own.body.group.kitty.collected, 200000)

  assert.equal((await addExpense(ria, t.ria, g.ria, 'Cylinder', 150000, [g.ria, g.om], { kitty: true, paidBy: g.om })).body.error, 'bad_kitty')
  const spent = await addExpense(om, t.om, g.om, 'Cylinder', 150000, [g.ria, g.om], { kitty: true, paidBy: g.ria })
  assert.equal(spent.status, 201, JSON.stringify(spent.body))
  const k = spent.body.group.kitty
  assert.deepEqual([k.collected, k.spent, k.left], [200000, 150000, 50000])
  assert.equal(k.byMember[g.om], 100000)
  // Om put in 1000 and used 750 of it: Ria holds 250 of his
  assert.equal(spent.body.balances.net[g.om], -10000 + 100000 - 75000)
})

test('chat: messages, retries post once, reactions, reads, deletes', async () => {
  const m1 = await call(`/groups/${g.id}/chat`, { token: t.om, body: { text: '  paise   bhej diye \n\n\n\n check kar ', clientId: 'om-1-abcdef' } })
  assert.equal(m1.status, 201)
  assert.equal(m1.body.message.text, 'paise bhej diye\n\ncheck kar')
  const dup = await call(`/groups/${g.id}/chat`, { token: t.om, body: { text: 'paise bhej diye', clientId: 'om-1-abcdef' } })
  assert.equal(dup.body.message.id, m1.body.message.id)
  assert.equal((await call(`/groups/${g.id}/chat`, { token: t.om, body: { text: 'x'.repeat(501) } })).body.error, 'too_long')

  const home = await call('/groups', { token: t.ria })
  const mine = home.body.groups.find((x: { id: string }) => x.id === g.id)
  assert.ok(mine.unread >= 1)

  const page = await call(`/groups/${g.id}/chat`, { token: t.ria })
  const kinds = page.body.messages.map((m: { kind: string; meta: { t: string } | null }) => (m.kind === 'event' ? m.meta!.t : 'text'))
  for (const k of ['join', 'expense', 'claim', 'paid', 'kitty', 'text']) assert.ok(kinds.includes(k), `chat should have a ${k} card: ${kinds}`)
  const confirmed = page.body.messages.find((m: { meta: { t: string; s?: string } | null }) => m.meta?.t === 'claim' && m.meta.s === 'confirmed')
  assert.ok(confirmed, 'the first claim card shows it was confirmed')

  const last = page.body.messages.at(-1).id
  const since = page.body.now
  await call(`/groups/${g.id}/chat/${m1.body.message.id}/react`, { token: t.ria, body: { emoji: '🔥' } })
  assert.equal((await call(`/groups/${g.id}/chat/${m1.body.message.id}/react`, { token: t.ria, body: { emoji: '🍆' } })).body.error, 'bad_emoji')
  const poll = await call(`/groups/${g.id}/chat?after=${last}&since=${since}`, { token: t.ria })
  assert.equal(poll.body.messages.length, 0)
  assert.deepEqual(poll.body.changed.find((m: { id: number }) => m.id === m1.body.message.id).reactions, [{ by: g.ria, emoji: '🔥' }])

  await call(`/groups/${g.id}/chat/read`, { token: t.ria, body: { last } })
  const home2 = await call('/groups', { token: t.ria })
  assert.equal(home2.body.groups.find((x: { id: string }) => x.id === g.id).unread, 0)

  assert.equal((await call(`/groups/${g.id}/chat/${m1.body.message.id}`, { method: 'DELETE', token: t.ria })).status, 404)
  assert.equal((await call(`/groups/${g.id}/chat/${m1.body.message.id}`, { method: 'DELETE', token: t.om })).status, 200)
  assert.equal((await call(`/groups/${g.id}/chat`, { token: t.kabir })).status, 403)
})

test('profile photo and receipt: re-encoded, sized, and private where they should be', async () => {
  const png = await sharp({ create: { width: 900, height: 500, channels: 3, background: '#ff3d8b' } }).png().toBuffer()
  assert.equal((await call('/me/avatar', { method: 'PUT', token: t.ria, raw: new Uint8Array([1, 2, 3, 4]) })).body.error, 'bad_image')
  const up = await call('/me/avatar', { method: 'PUT', token: t.ria, raw: new Uint8Array(png) })
  assert.equal(up.status, 200, JSON.stringify(up.body))
  assert.match(up.body.user.avatar, new RegExp(`^/api/avatars/${users.ria}/1$`))
  const img = await call(up.body.user.avatar)
  assert.equal(img.headers.get('content-type'), 'image/webp')
  assert.match(img.headers.get('cache-control') ?? '', /immutable/)
  const meta = await sharp(Buffer.from(img.body as Uint8Array)).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height], ['webp', 256, 256])
  const grp = await call(`/groups/${g.id}`, { token: t.om })
  assert.equal(grp.body.members.find((m: { id: string }) => m.id === g.ria).avatar, up.body.user.avatar)

  const eid = grp.body.expenses[0].id
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()
  assert.equal((await call(`/groups/${g.id}/expenses/${eid}/receipt`, { method: 'PUT', token: t.kabir, raw: new Uint8Array(big), type: 'image/jpeg' })).status, 403)
  const rc = await call(`/groups/${g.id}/expenses/${eid}/receipt`, { method: 'PUT', token: t.om, raw: new Uint8Array(big), type: 'image/jpeg' })
  assert.equal(rc.status, 200, JSON.stringify(rc.body))
  const got = await call(`/groups/${g.id}/expenses/${eid}/receipt`, { token: t.ria })
  const rm = await sharp(Buffer.from(got.body as Uint8Array)).metadata()
  assert.equal(rm.width, 1600)
  assert.equal((await call(`/groups/${g.id}/expenses/${eid}/receipt`, { token: t.kabir })).status, 403)
  assert.equal((await call(`/groups/${g.id}`, { token: t.ria })).body.expenses[0].receipt, true)
  // vector formats can point at other files: refused before they're ever decoded
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="file:///etc/passwd"/></svg>')
  assert.equal((await call('/me/avatar', { method: 'PUT', token: t.ria, raw: svg, type: 'image/svg+xml' })).body.error, 'bad_image')
})

test('invite links: only the creator can reset one, and the old one dies', async () => {
  assert.equal((await call(`/groups/${g.id}/invite/reset`, { token: t.om, body: {} })).body.error, 'not_your_call')
  const r = await call(`/groups/${g.id}/invite/reset`, { token: t.ria, body: {} })
  assert.notEqual(r.body.group.inviteCode, g.invite)
  assert.equal((await call(`/invites/${g.invite}`)).status, 404)
  assert.equal((await call(`/invites/${r.body.group.inviteCode}`)).status, 200)
  g.invite = r.body.group.inviteCode
})

test('second phone: a sealed blob, picked up once', async () => {
  const blob = 'v1.' + 'A'.repeat(80)
  const made = await call('/devices/link', { token: t.ria, body: { blob } })
  assert.equal(made.status, 201)
  assert.equal((await call(`/devices/link/${made.body.id}`, { token: t.ria })).body.used, false)
  assert.equal((await call(`/devices/link/${made.body.id}`, { token: t.om })).status, 404)
  const took = await call(`/devices/link/${made.body.id}/take`, { body: {} })
  assert.equal(took.body.blob, blob)
  assert.equal((await call(`/devices/link/${made.body.id}/take`, { body: {} })).status, 410)
  assert.equal((await call(`/devices/link/${made.body.id}`, { token: t.ria })).body.used, true)
})

test('friends: add someone you know by account; they say yes with their own key', async () => {
  const fr = await call('/friends', { token: t.ria })
  assert.deepEqual(fr.body.friends.map((f: { name: string }) => f.name), ['Om'])
  // a second group with Ria only, then add Om (a friend) and Kabir (from his card link)
  const id = newId()
  const rm = newId()
  const entries: EntryData[] = [
    { type: 'group', id, name: 'Goa', currency: 'INR', emoji: '🏖️', by: rm },
    { type: 'member', id: rm, name: 'Ria', position: 0, pubkey: ria.nostrPubkey, by: rm },
  ]
  const grp = await call('/groups', { token: t.ria, body: { name: 'Goa', emoji: '🏖️', currency: 'INR', members: [], id, memberIds: [rm], signed: entries.map((d) => sign(ria, id, d)) } })
  assert.equal(grp.status, 201, JSON.stringify(grp.body))
  const card = await call(`/users/${users.kabir}/card`)
  assert.equal(card.body.name, 'Kabir')
  const add = async (userId: string, name: string, position: number) => {
    const mid = newId()
    const data: EntryData = { type: 'member', id: mid, name: joinName(name, ['Ria', 'Om'].slice(0, position)), position, by: rm }
    const r = await call(`/groups/${id}/members`, { token: t.ria, body: { userId, id: mid, signed: sign(ria, id, data) } })
    return { r, mid }
  }
  const a = await add(users.om, 'Om', 1)
  assert.equal(a.r.status, 201, JSON.stringify(a.r.body))
  assert.equal(a.r.body.members[1].invited, true)
  assert.equal((await call(`/groups/${id}/members`, { token: t.ria, body: { userId: users.om, id: newId(), signed: {} } })).body.error, 'already_in')
  const b = await add(users.kabir, 'Kabir', 2)
  assert.equal(b.r.status, 201)

  const omHome = await call('/groups', { token: t.om })
  assert.deepEqual(omHome.body.invites.map((i: { groupName: string }) => i.groupName), ['Goa'])
  assert.equal((await call(`/groups/${id}/accept`, { token: t.kabir, body: { memberId: a.mid } })).body.error, 'no_invite')
  const acc = await call(`/groups/${id}/accept`, { token: t.om, body: { memberId: a.mid, signed: sign(om, id, { type: 'claim', memberId: a.mid, pubkey: om.nostrPubkey }) } })
  assert.equal(acc.status, 200, JSON.stringify(acc.body))
  assert.equal((await call(`/groups/${id}`, { token: t.om })).status, 200)
  await call(`/groups/${id}/decline`, { token: t.kabir, body: { memberId: b.mid } })
  assert.equal((await call('/groups', { token: t.kabir })).body.invites.length, 0)
})

test('nudges: only to someone who owes you, at most twice a day', async () => {
  // Om pays for pizza for both: now Ria owes Om, and Zoya (never joined) owes Om too
  const p = await addExpense(om, t.om, g.om, 'Pizza', 60000, [g.ria, g.om])
  assert.equal(p.status, 201, JSON.stringify(p.body))
  assert.equal((await call(`/groups/${g.id}/nudge`, { token: t.om, body: { to: g.ria } })).status, 200)
  assert.equal((await call(`/groups/${g.id}/nudge`, { token: t.om, body: { to: g.ria } })).body.error, 'nudged_recently')
  assert.equal((await call(`/groups/${g.id}/nudge`, { token: t.om, body: { to: g.zoya } })).body.error, 'not_joined')
  assert.equal((await call(`/groups/${g.id}/nudge`, { token: t.ria, body: { to: g.om } })).body.error, 'nothing_owed')
})

test('repeating bills: a template and a date; the phone adds the bill', async () => {
  const grp = await call(`/groups/${g.id}`, { token: t.ria })
  const wifi = grp.body.expenses.find((e: { description: string }) => e.description === 'Wifi')
  assert.equal((await call(`/groups/${g.id}/recurring`, { token: t.om, body: { expenseId: wifi.id } })).body.error, 'not_yours')
  const r = await call(`/groups/${g.id}/recurring`, { token: t.ria, body: { expenseId: wifi.id, every: 'month' } })
  assert.equal(r.status, 201)
  assert.equal((await call(`/groups/${g.id}/recurring`, { token: t.ria, body: { expenseId: wifi.id } })).body.error, 'already_repeats')
  const list = await call('/recurring', { token: t.ria })
  assert.equal(list.body.items.length, 1)
  assert.equal(list.body.items[0].template.amount, 30000)
  assert.equal(list.body.items[0].due, false)
  assert.ok(list.body.items[0].nextAt > Date.now() + 25 * 86_400_000)
  assert.equal((await call(`/recurring/${r.body.id}`, { method: 'DELETE', token: t.om })).status, 404)
  assert.equal((await call(`/recurring/${r.body.id}`, { method: 'DELETE', token: t.ria })).status, 200)
  assert.equal((await call('/recurring', { token: t.ria })).body.items.length, 0)
})

test('everything above is on the signed chain, and it verifies', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(env.dir, 'bhai.sqlite'))
  const rows = db.prepare('SELECT event_json FROM ledger WHERE group_id = ? ORDER BY seq').all(g.id) as { event_json: string }[]
  const grp = db.prepare('SELECT group_key FROM groups WHERE id = ?').get(g.id) as { group_key: string }
  const { serverPubkey } = await import('./nostr')
  db.close()
  const report = verifyChain(rows.map((r) => JSON.parse(r.event_json)), { k: grp.group_key, pk: serverPubkey, r: [] })
  assert.ok(report.ok, report.problems.join('; '))
  assert.equal(report.memberSigned, report.entries.length)
  const methods = report.entries.filter((e) => e.data.type === 'settlement').map((e) => (e.data as { method: string }).method)
  assert.deepEqual(methods, ['upi', 'kitty', 'kitty'])
})

test('link previews name the people and the amount', { skip: !existsSync(join(import.meta.dirname, '..', 'dist', 'index.html')) }, async () => {
  // with debts simplified, Zoya (never joined) pays both Ria and Om
  const link = await call(`/groups/${g.id}/paylinks`, { token: t.ria, body: { from: g.zoya, to: g.om } })
  const page = await call(`/p/${link.body.token}`)
  assert.match(String(page.body), /<title>Zoya, you owe Om ₹400<\/title>/)
  const inv = await call(`/j/${g.invite}`)
  assert.match(String(inv.body), /<title>Join 🏠 Flat 4B<\/title>/)
  const evil = await call('/j/<script>')
  assert.doesNotMatch(String(evil.body), /<script>alert/)
  // a forged Host header doesn't end up in the page
  const forged = await fetch(app.base + '/j/' + g.invite, { headers: { host: 'evil.example"><script>' } }).then((x) => x.text())
  assert.doesNotMatch(forged, /evil\.example/)
})
