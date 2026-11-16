// An unreachable or refusing relay must never take the server down.
// (Node's built-in WebSocket used to recurse on close-after-error inside the relay library.)

import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { testEnv } from './testkit'

const port = await new Promise<number>((resolve) => {
  // accepts TCP and hangs up at once: the WebSocket handshake fails
  const srv = createServer((sock) => sock.destroy()).listen(0, () => resolve((srv.address() as { port: number }).port))
  srv.unref()
})
const env = testEnv({ BPD_NOSTR: '1', BPD_RELAYS: `ws://127.0.0.1:${port},ws://127.0.0.1:1` })

test('publishing to dead relays fails quietly', async () => {
  const { SimplePool } = await import('nostr-tools/pool')
  await import('./nostr')
  const { finalizeEvent, generateSecretKey } = await import('nostr-tools/pure')
  const pool = new SimplePool()
  const ev = finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'x' }, generateSecretKey())
  const results = await Promise.allSettled(pool.publish(process.env.BPD_RELAYS!.split(','), ev, { maxWait: 1500 }))
  assert.ok(results.every((r) => r.status === 'rejected'))
  // still alive to see this, and again after the event loop has drained any late errors
  await new Promise((r) => setTimeout(r, 300))
  pool.close(process.env.BPD_RELAYS!.split(','))
  env.cleanup()
})
