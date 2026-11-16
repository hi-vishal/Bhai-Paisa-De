// End to end against the real Express app and a throwaway SQLite file:
// sign-up by signature, member-signed writes (and forgeries refused), manual settlement rules,
// a USDT pay link settled through the demo path, and the resulting chain verified offline.

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { ed25519 } from '@noble/curves/ed25519.js'
import { base58 } from '@scure/base'
import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import { newId } from '../shared/canon'
import { identityFromMnemonic, newMnemonic, type Identity } from '../shared/keys'
import { MEMBER_SIG_KIND, memberSigContent, verifyChain, type EntryData } from '../shared/ledger'
import { computeSplit } from '../shared/split'

const dir = mkdtempSync(join(tmpdir(), 'bpd-test-'))
Object.assign(process.env, { BPD_DATA_DIR: dir, BPD_NOSTR: '0', BPD_DEMO_WALLET: '1', BPD_SOLANA_CLUSTER: 'devnet', BPD_FLOOD_PER_MIN: '100000' })

let base = ''
let close: () => void
let ria: Identity, om: Identity, mallory: Identity

before(async () => {
  const { createApp } = await import('./app')
  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
  ;[ria, om, mallory] = await Promise.all([identityFromMnemonic(newMnemonic()), identityFromMnemonic(newMnemonic()), identityFromMnemonic(newMnemonic())])
})

after(() => {
  close()
  rmSync(dir, { recursive: true, force: true })
})

async function call<T = any>(path: string, opts: { body?: unknown; token?: string; method?: string } = {}): Promise<{ status: number; body: T; headers: Headers }> {
  const res = await fetch(base + '/api' + path, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let body: any = text
  try {
    body = JSON.parse(text)
  } catch {
    // csv
  }
  return { status: res.status, body, headers: res.headers }
}

async function login(id: Identity, name?: string) {
  const { body: ch } = await call('/auth/challenge', { body: {} })
  const event = finalizeEvent(
    { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${base}/api/auth/login`], ['method', 'POST'], ['challenge', ch.challenge]], content: '' },
    id.nostrSecret,
  )
  return call('/auth/login', { body: { event, name, label: 'test' } })
}

const sign = (id: Identity, groupId: string, data: EntryData): NostrEvent =>
  finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: memberSigContent(groupId, data) }, id.nostrSecret)

const tokens: Record<string, string> = {}
const g = { id: '', invite: '', ria: '', om: '', zoya: '' }

test('sign up and sign in with a signature, never a password', async () => {
  assert.equal((await login(ria)).body.error, 'no_account')
  const r = await login(ria, 'Ria')
  assert.equal(r.status, 201)
  assert.equal(r.body.user.pubkey, ria.nostrPubkey)
  tokens.ria = r.body.token
  const again = await login(ria)
  assert.equal(again.status, 200)
  assert.equal(again.body.user.id, r.body.user.id)
  tokens.om = (await login(om, 'Om')).body.token

  // a challenge works once
  const { body: ch } = await call('/auth/challenge', { body: {} })
  const ev = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${base}/api/auth/login`], ['method', 'POST'], ['challenge', ch.challenge]], content: '' }, ria.nostrSecret)
  assert.equal((await call('/auth/login', { body: { event: ev } })).status, 200)
  assert.equal((await call('/auth/login', { body: { event: ev } })).body.error, 'challenge_used')
  // and a forged challenge never does
  const fake = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${base}/api/auth/login`], ['method', 'POST'], ['challenge', `${Date.now() + 60000}.00.00`]], content: '' }, ria.nostrSecret)
  assert.equal((await call('/auth/login', { body: { event: fake } })).body.error, 'bad_challenge')
})

test('Solana address needs a signature from that address', async () => {
  const me = await call('/me', { token: tokens.ria })
  const { body } = await call(`/me/solana/message?address=${ria.solAddress}`, { token: tokens.ria })
  const bad = base58.encode(ed25519.sign(new TextEncoder().encode(body.message), mallory.solSecret))
  assert.equal((await call('/me/solana', { method: 'PUT', token: tokens.ria, body: { address: ria.solAddress, signature: bad } })).body.error, 'bad_proof')
  const good = base58.encode(ed25519.sign(new TextEncoder().encode(body.message), ria.solSecret))
  const r = await call('/me/solana', { method: 'PUT', token: tokens.ria, body: { address: ria.solAddress, signature: good } })
  assert.equal(r.body.user.solAddress, ria.solAddress)
  assert.equal(me.body.user.solAddress, null)
})

test('a group is created only with the creator’s signatures over every entry', async () => {
  const id = newId()
  const memberIds = [newId(), newId(), newId()]
  const by = memberIds[0]
  const entries: EntryData[] = [
    { type: 'group', id, name: 'Goa trip', currency: 'INR', emoji: '🏖️', by },
    { type: 'member', id: memberIds[0], name: 'Ria', position: 0, pubkey: ria.nostrPubkey, by },
    { type: 'member', id: memberIds[1], name: 'Om', position: 1, by },
    { type: 'member', id: memberIds[2], name: 'Zoya', position: 2, by },
  ]
  const body = { name: '  Goa   trip ', emoji: '🏖️', currency: 'INR', members: ['Om', 'zoya'.replace('z', 'Z'), 'ria'], id, memberIds }
  assert.equal((await call('/groups', { token: tokens.ria, body })).body.error, 'signature_required')
  const tampered = entries.map((d, i) => sign(ria, id, i === 0 ? { ...d, name: 'Goa trip!!' } as EntryData : d))
  assert.equal((await call('/groups', { token: tokens.ria, body: { ...body, signed: tampered } })).body.error, 'signature_mismatch')
  const r = await call('/groups', { token: tokens.ria, body: { ...body, signed: entries.map((d) => sign(ria, id, d)) } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.deepEqual(r.body.members.map((m: { name: string }) => m.name), ['Ria', 'Om', 'Zoya'])
  Object.assign(g, { id, invite: r.body.group.inviteCode, ria: memberIds[0], om: memberIds[1], zoya: memberIds[2] })
})

test('expenses carry the member’s signature; someone else’s key is refused', async () => {
  const split = { mode: 'equal' as const, memberIds: [g.ria, g.om, g.zoya] }
  const id = newId()
  const res = computeSplit(split, 510001, [g.ria, g.om, g.zoya])
  const data: EntryData = { type: 'expense', id, description: 'Beach shack', category: 'food', paidBy: g.ria, total: res.total, shares: res.shares, mode: 'equal', by: g.ria }
  const body = { id, description: 'Beach shack', category: 'food', paidBy: g.ria, amount: 510001, split }
  assert.equal((await call(`/groups/${g.id}/expenses`, { token: tokens.ria, body: { ...body, signed: sign(mallory, g.id, data) } })).body.error, 'wrong_key')
  const r = await call(`/groups/${g.id}/expenses`, { token: tokens.ria, body: { ...body, signed: sign(ria, g.id, data) } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  // ₹5,100.01 three ways: the leftover paisa goes to the first person in order (Ria, who paid)
  assert.deepEqual(r.body.balances.net, { [g.ria]: 340000, [g.om]: -170000, [g.zoya]: -170000 })
  // replaying the same signed entry doesn't add it twice
  assert.equal((await call(`/groups/${g.id}/expenses`, { token: tokens.ria, body: { ...body, signed: sign(ria, g.id, data) } })).status, 409)
})

test('Om claims his name with his own key', async () => {
  const inv = await call(`/invites/${g.invite}`)
  assert.equal(inv.body.group.id, g.id)
  const r = await call(`/invites/${g.invite}/join`, { token: tokens.om, body: { memberId: g.om, signed: sign(om, g.id, { type: 'claim', memberId: g.om, pubkey: om.nostrPubkey }) } })
  assert.equal(r.body.memberId, g.om)
})

test('manual settlements: only the payee can say they were paid', async () => {
  const id = newId()
  const data: EntryData = { type: 'settlement', id, from: g.om, to: g.ria, amount: 70000, method: 'manual', note: 'UPI', by: g.om }
  const denied = await call(`/groups/${g.id}/settlements`, { token: tokens.om, body: { id, from: g.om, to: g.ria, amount: 70000, note: 'UPI', signed: sign(om, g.id, data) } })
  assert.equal(denied.body.error, 'not_your_call')
  const ok: EntryData = { ...data, by: g.ria }
  const r = await call(`/groups/${g.id}/settlements`, { token: tokens.ria, body: { id, from: g.om, to: g.ria, amount: 70000, note: 'UPI', signed: sign(ria, g.id, ok) } })
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal(r.body.balances.net[g.om], -100000)
})

test('USDT pay link: Solana Pay request, settled on proof, recorded on the chain', async () => {
  const link = await call(`/groups/${g.id}/paylinks`, { token: tokens.ria, body: { from: g.om, to: g.ria } })
  const page = await call(`/pay/${link.body.token}`)
  assert.deepEqual(page.body.to.rails, { UPI: false, USDT: true, SOL: true })
  assert.equal(page.body.owed, 100000)
  const q = await call(`/pay/${link.body.token}/quote`, { body: { asset: 'USDT' } })
  assert.equal(q.status, 201, JSON.stringify(q.body))
  const quote = q.body.quote
  assert.match(quote.invoice, new RegExp(`^solana:${ria.solAddress}\\?amount=\\d+(\\.\\d+)?&spl-token=\\w+&reference=\\w+&label=`))
  assert.equal(quote.recipient, ria.solAddress)
  assert.ok(BigInt(quote.base) > 0n)
  const paid = await call(`/pay/${link.body.token}/quote/${quote.id}/demo-pay`, { body: {} })
  assert.equal(paid.body.quote.status, 'paid')
  const after = await call(`/groups/${g.id}`, { token: tokens.ria })
  const s = after.body.settlements.find((x: { method: string }) => x.method === 'solana')
  assert.equal(s.asset, 'USDT')
  assert.equal(s.amount, 100000)
  assert.equal(after.body.balances.net[g.om], 0)
})

test('the stored chain verifies offline, with member signatures bound to the right keys', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(dir, 'bhai.sqlite'))
  const rows = db.prepare('SELECT event_json FROM ledger WHERE group_id = ? ORDER BY seq').all(g.id) as { event_json: string }[]
  const grp = db.prepare('SELECT group_key FROM groups WHERE id = ?').get(g.id) as { group_key: string }
  const { serverPubkey } = await import('./nostr')
  db.close()
  const report = verifyChain(rows.map((r) => JSON.parse(r.event_json)), { k: grp.group_key, pk: serverPubkey, r: [] })
  assert.ok(report.ok, report.problems.join('; '))
  // group + 3 members + expense + claim + manual settlement are member-signed; the USDT settlement is server-written with its proof
  assert.equal(report.entries.length, 8)
  assert.equal(report.memberSigned, 7)
  assert.equal(report.entries.find((e) => e.data.type === 'claim')?.signer, om.nostrPubkey)
})

test('export, headers, and errors', async () => {
  const csv = await call(`/groups/${g.id}/export.csv`, { token: tokens.ria })
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/)
  assert.match(String(csv.body), /Beach shack/)
  assert.match(String(csv.body), /crypto USDT/)
  assert.equal((await call(`/groups/${g.id}/export.csv`, { token: tokens.om })).status, 200)
  assert.equal((await call(`/groups/${g.id}`)).status, 401)
  const nf = await call('/nope')
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error, 'not_found')
  const h = await fetch(base + '/healthz')
  assert.match(h.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(h.headers.get('x-frame-options'), 'DENY')
  const rpc = await call('/sol/rpc', { token: tokens.ria, body: { method: 'requestAirdrop', params: [] } })
  assert.equal(rpc.body.error, 'rpc_method')
})
