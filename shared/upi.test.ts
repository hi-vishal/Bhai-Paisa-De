import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanText } from './canon'
import { claimSettlement } from './claims'
import { cleanRef, cleanUpi, upiUrl } from './upi'

test('UPI IDs: trimmed, lowercased, and nothing that isn’t one', () => {
  assert.equal(cleanUpi(' Ria.Sharma@OkAxis '), 'ria.sharma@okaxis')
  for (const bad of ['ria', 'ria@', '@okaxis', 'ria@1bank', 'r i a@okaxis', 'ria@ok axis', 42, null]) assert.equal(cleanUpi(bad), null, String(bad))
  assert.equal(cleanRef('4321 8765 0099'), '432187650099')
  assert.equal(cleanRef('12345'), null)
})

test('UPI links follow the NPCI format and escape what they carry', () => {
  assert.equal(upiUrl({ pa: 'ria@okaxis', pn: 'Ria S', am: 34050, tn: 'Goa & back' }), 'upi://pay?pa=ria%40okaxis&pn=Ria%20S&am=340.50&cu=INR&tn=Goa%20%26%20back')
  assert.equal(upiUrl({ pa: 'ria@okaxis', pn: 'Ria' }, 'gpay'), 'gpay://upi/pay?pa=ria%40okaxis&pn=Ria&cu=INR')
  assert.match(upiUrl({ pa: 'a@b', pn: 'x', am: 100 }, 'phonepe'), /^phonepe:\/\/pay\?/)
})

test('free text loses control and text-direction characters (no spoofed names)', () => {
  assert.equal(cleanText('  Ri‮a​  \u0007 S  '), 'Ria S')
  assert.equal(cleanText('Om⁦⁩'), 'Om')
})

test('confirming a claim writes the matching settlement', () => {
  const c = { from: 'a', to: 'b', amount: 100, ref: '123456789012' }
  assert.deepEqual(claimSettlement({ ...c, method: 'upi' }, 'id1', 'b'), { type: 'settlement', id: 'id1', from: 'a', to: 'b', amount: 100, method: 'upi', ref: '123456789012', by: 'b' })
  assert.equal((claimSettlement({ ...c, method: 'cash', ref: null }, 'id2', 'b') as { note: string }).note, 'Cash')
  assert.equal((claimSettlement({ ...c, method: 'kitty' }, 'id3', 'b') as { method: string }).method, 'kitty')
})
