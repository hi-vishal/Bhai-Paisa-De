import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure'
import { bytesToHex } from '@noble/hashes/utils.js'
import { allocate, formatMoney, parseMoney, minorToSats } from './money'
import { computeSplit } from './split'
import { netBalances, pairwiseDebts, simplifyDebts, type LedgerExpense } from './balances'
import { encodeBackup, decodeBackup, encryptEntry, groupKeys, verifyChain, rebuild, LEDGER_KIND, type Entry } from './ledger'

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

test('allocate: leftover paise go out one at a time in order', () => {
  assert.deepEqual(allocate(1000, [1, 1, 1]), [334, 333, 333])
  assert.deepEqual(allocate(1001, [1, 1, 1]), [334, 334, 333])
  assert.deepEqual(allocate(100, [0, 1, 1]), [0, 50, 50])
  assert.deepEqual(allocate(5, [1, 0, 1, 1]), [2, 0, 2, 1])
  for (let t = 0; t < 500; t++) {
    const w = [1 + (t % 7), 3, (t * 13) % 5, 2]
    assert.equal(sum(allocate(t * 37 + 11, w)), t * 37 + 11)
  }
})

test('money parse/format', () => {
  assert.equal(parseMoney('1,700.5', 'INR'), 170050)
  assert.equal(parseMoney('₹ 12', 'INR'), 1200)
  assert.equal(parseMoney('1.234', 'INR'), null)
  assert.equal(formatMoney(170050, 'INR'), '₹1,700.50')
  assert.equal(formatMoney(170000, 'INR'), '₹1,700')
  assert.equal(formatMoney(-50, 'INR'), '−₹0.50')
  assert.equal(minorToSats(100, 'USD', 100_000), 1000)
})

test('splits always add up', () => {
  const order = ['a', 'b', 'c']
  assert.deepEqual(computeSplit({ mode: 'equal', memberIds: ['a', 'b', 'c'] }, 170000, order).shares, { a: 56667, b: 56667, c: 56666 })
  assert.deepEqual(computeSplit({ mode: 'shares', shares: { a: 2, b: 1 } }, 1000, order).shares, { a: 667, b: 333 })
  assert.throws(() => computeSplit({ mode: 'percent', percents: { a: 50, b: 40 } }, 1000, order))
  assert.throws(() => computeSplit({ mode: 'exact', amounts: { a: 10, b: 20 } }, 31, order))
  const it = computeSplit(
    { mode: 'itemized', items: [{ name: 'biryani', amount: 30000, memberIds: ['a', 'b'] }, { name: 'coke', amount: 5000, memberIds: ['c'] }], taxPercent: 5, tip: 1001 },
    null,
    order,
  )
  assert.equal(it.total, 30000 + 5000 + 1750 + 1001)
  assert.equal(sum(Object.values(it.shares)), it.total)
})

test('balances: simplify keeps every net balance', () => {
  const order = ['a', 'b', 'c', 'd']
  const expenses: LedgerExpense[] = [
    { id: '1', paidBy: 'a', total: 1200, shares: { a: 300, b: 300, c: 300, d: 300 } },
    { id: '2', paidBy: 'b', total: 800, shares: { c: 400, d: 400 } },
    { id: '3', paidBy: 'c', total: 999, shares: { a: 333, b: 333, c: 333 } },
  ]
  const settlements = [{ id: 's', from: 'd', to: 'a', amount: 100 }]
  const net = netBalances(order, expenses, settlements)
  assert.equal(sum(Object.values(net)), 0)
  for (const plan of [simplifyDebts(order, net), pairwiseDebts(order, expenses, settlements)]) {
    const after = { ...net }
    for (const t of plan) {
      after[t.from] += t.amount
      after[t.to] -= t.amount
    }
    assert.ok(Object.values(after).every((v) => v === 0), JSON.stringify(plan))
  }
  assert.ok(simplifyDebts(order, net).length <= order.length - 1)
})

test('ledger: chain verifies, and a missing entry shows', () => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const k = bytesToHex(generateSecretKey())
  const { tag, convKey } = groupKeys(k)
  const datas: Entry['data'][] = [
    { type: 'group', id: 'g', name: 'Goa', currency: 'INR', emoji: '🏖️' },
    { type: 'member', id: 'a', name: 'Ria', position: 0 },
    { type: 'member', id: 'b', name: 'Om', position: 1 },
    { type: 'expense', id: 'e', description: 'dinner', category: 'food', paidBy: 'a', total: 340000, shares: { a: 170000, b: 170000 }, mode: 'equal' },
    { type: 'settlement', id: 's', from: 'b', to: 'a', amount: 100000, method: 'manual', note: 'UPI' },
  ]
  let prev: string | null = null
  const events = datas.map((data, seq) => {
    const ev = finalizeEvent({ kind: LEDGER_KIND, created_at: 1, tags: [['t', tag]], content: encryptEntry({ v: 1, seq, prev, at: seq, data }, convKey) }, sk)
    prev = ev.id
    return ev
  })
  const backup = decodeBackup(encodeBackup({ k, pk, r: [] }))
  const ok = verifyChain(events, backup)
  assert.ok(ok.ok, ok.problems.join())
  const r = rebuild(ok.entries)
  assert.deepEqual(r.simplified, [{ from: 'b', to: 'a', amount: 70000 }])
  const broken = verifyChain([events[0], events[1], events[2], events[4]], backup)
  assert.equal(broken.ok, false)
  assert.match(broken.problems.join(), /#3 is missing/)
})

test('ledger: member signatures bind to the key each member registered', async () => {
  const { MEMBER_SIG_KIND, memberSigContent } = await import('./ledger')
  const server = generateSecretKey()
  const ria = generateSecretKey()
  const om = generateSecretKey()
  const mallory = generateSecretKey()
  const k = bytesToHex(generateSecretKey())
  const { convKey } = groupKeys(k)
  const sign = (sk: Uint8Array, data: Entry['data']) =>
    finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: 1, tags: [], content: memberSigContent('g', data) }, sk)
  const build = (rows: [Entry['data'], Uint8Array | null][]) => {
    let prev: string | null = null
    return rows.map(([data, sk], seq) => {
      const entry: Entry = { v: 2, seq, prev, at: seq, data, sig: sk ? sign(sk, data) : undefined }
      const ev = finalizeEvent({ kind: LEDGER_KIND, created_at: 1, tags: [], content: encryptEntry(entry, convKey) }, server)
      prev = ev.id
      return ev
    })
  }
  const backup = { k, pk: getPublicKey(server), r: [] }
  const base: [Entry['data'], Uint8Array | null][] = [
    [{ type: 'group', id: 'g', name: 'Goa', currency: 'INR', emoji: '🏖️', by: 'a' }, ria],
    [{ type: 'member', id: 'a', name: 'Ria', position: 0, pubkey: getPublicKey(ria), by: 'a' }, ria],
    [{ type: 'member', id: 'b', name: 'Om', position: 1, by: 'a' }, ria],
    [{ type: 'claim', memberId: 'b', pubkey: getPublicKey(om) }, om],
    [{ type: 'expense', id: 'e', description: 'dinner', category: 'food', paidBy: 'b', total: 200, shares: { a: 100, b: 100 }, mode: 'equal', by: 'b' }, om],
  ]
  const good = verifyChain(build(base), backup)
  assert.ok(good.ok, good.problems.join())
  assert.equal(good.memberSigned, 5)
  assert.equal(good.entries[4].signer, getPublicKey(om))

  // the server (or anyone) can't put words in Om's mouth
  const forged = verifyChain(build([...base.slice(0, 4), [base[4][0], mallory]]), backup)
  assert.equal(forged.ok, false)
  assert.match(forged.problems.join(), /doesn't belong to the member/)

  // nor change what Om signed
  const evs = build(base)
  const tampered = { ...(base[4][0] as Extract<Entry['data'], { type: 'expense' }>), total: 999 }
  const swapped: Entry = { v: 2, seq: 4, prev: evs[3].id, at: 4, data: tampered, sig: sign(om, base[4][0]) }
  evs[4] = finalizeEvent({ kind: LEDGER_KIND, created_at: 1, tags: [], content: encryptEntry(swapped, convKey) }, server)
  assert.match(verifyChain(evs, backup).problems.join(), /doesn't match its contents/)

  // and a second claim on an already-bound member is flagged
  const reclaim = verifyChain(build([...base, [{ type: 'claim', memberId: 'b', pubkey: getPublicKey(mallory) }, mallory]]), backup)
  assert.match(reclaim.problems.join(), /already has a key/)
})
