// Helpers for the end-to-end tests: a real app on a random port, over a throwaway data dir.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { finalizeEvent, type Event as NostrEvent } from 'nostr-tools/pure'
import type { Identity } from '../shared/keys'
import { MEMBER_SIG_KIND, memberSigContent, type EntryData } from '../shared/ledger'

export function testEnv(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bpd-test-'))
  Object.assign(process.env, { BPD_DATA_DIR: dir, BPD_NOSTR: '0', BPD_DEMO_WALLET: '1', BPD_SOLANA_CLUSTER: 'devnet', BPD_FLOOD_PER_MIN: '100000', BPD_LIMIT_SCALE: '50', ...extra })
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export async function startApp() {
  const { createApp } = await import('./app')
  const server = createApp().listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, close: () => server.close() }
}

export type Res<T = any> = { status: number; body: T; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any

export function client(base: string) {
  async function call<T = any>(path: string, opts: { body?: unknown; token?: string; method?: string; raw?: Uint8Array; type?: string } = {}): Promise<Res<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const headers: Record<string, string> = { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) }
    let body: BodyInit | undefined
    if (opts.raw) {
      headers['content-type'] = opts.type ?? 'image/png'
      body = opts.raw as unknown as BodyInit
    } else if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    // app pages (/p/…, /j/…, /u/…) as they are; everything else is an API path
    const url = /^\/(p|j|u)\//.test(path) || path.startsWith('/api/') ? path : `/api${path}`
    const res = await fetch(base + url, {
      method: opts.method ?? (body !== undefined ? 'POST' : 'GET'),
      headers,
      body,
    })
    const buf = new Uint8Array(await res.arrayBuffer())
    let parsed: unknown = buf
    if ((res.headers.get('content-type') ?? '').includes('json') || (res.headers.get('content-type') ?? '').includes('text')) {
      const text = new TextDecoder().decode(buf)
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: res.status, body: parsed as T, headers: res.headers }
  }

  async function login(id: Identity, name?: string, extra: Record<string, unknown> = {}) {
    const { body: ch } = await call('/auth/challenge', { body: {} })
    const event = finalizeEvent(
      { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${base}/api/auth/login`], ['method', 'POST'], ['challenge', ch.challenge]], content: '' },
      id.nostrSecret,
    )
    return call('/auth/login', { body: { event, name, label: 'test', ...extra } })
  }

  return { call, login }
}

export const sign = (id: Identity, groupId: string, data: EntryData): NostrEvent =>
  finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: memberSigContent(groupId, data) }, id.nostrSecret)
