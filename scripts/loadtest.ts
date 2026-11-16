// npm run loadtest -- [--url http://localhost:8787] [--duration 10] [--connections 100]
//
// Point it at a server started with a throwaway data dir and relays off, e.g.
//   BPD_DATA_DIR=/tmp/bpd-load BPD_NOSTR=0 BPD_SOLANA_CLUSTER=devnet BPD_FLOOD_PER_MIN=100000000 BPD_LIMIT_SCALE=1000 BPD_WORKERS=4 PORT=9797 npm start
// It signs up two accounts by signature, makes a group, then hammers four endpoints:
// a health check, a full group read, the public pay page, and member-signed expense writes.

import autocannon from 'autocannon'
import { finalizeEvent } from 'nostr-tools/pure'
import { newId } from '../shared/canon'
import { identityFromMnemonic, newMnemonic, type Identity } from '../shared/keys'
import { MEMBER_SIG_KIND, memberSigContent, type EntryData } from '../shared/ledger'
import { computeSplit } from '../shared/split'

const arg = (k: string, d: string) => (process.argv.includes(`--${k}`) ? process.argv[process.argv.indexOf(`--${k}`) + 1] : d)
const url = arg('url', 'http://localhost:8787')
const duration = Number(arg('duration', '10'))
const connections = Number(arg('connections', '100'))

async function call(path: string, body?: unknown, token?: string) {
  const r = await fetch(url + '/api' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j)}`)
  return j
}

async function signup(id: Identity, name: string) {
  const { challenge } = await call('/auth/challenge', {})
  const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `${url}/api/auth/login`], ['method', 'POST'], ['challenge', challenge]], content: '' }, id.nostrSecret)
  return (await call('/auth/login', { event, name })).token as string
}
const sign = (id: Identity, g: string, data: EntryData) => finalizeEvent({ kind: MEMBER_SIG_KIND, created_at: Math.floor(Date.now() / 1000), tags: [], content: memberSigContent(g, data) }, id.nostrSecret)

console.log(`setting up on ${url} …`)
const ria = await identityFromMnemonic(newMnemonic())
const token = await signup(ria, 'Ria')
const names = ['Ria', 'Om', 'Zoya', 'Kabir', 'Meera', 'Dev']
const split = (mids: string[]) => ({ mode: 'equal' as const, memberIds: mids })

// real traffic is many small groups, so writes rotate across 100 of them
const groups: { gid: string; mids: string[] }[] = []
for (let k = 0; k < 100; k++) {
  const gid = newId()
  const mids = names.map(() => newId())
  const entries: EntryData[] = [
    { type: 'group', id: gid, name: `Trip ${k}`, currency: 'INR', emoji: '🔥', by: mids[0] },
    ...names.map((n, position): EntryData => ({ type: 'member', id: mids[position], name: n, position, pubkey: position === 0 ? ria.nostrPubkey : undefined, by: mids[0] })),
  ]
  await call('/groups', { name: `Trip ${k}`, emoji: '🔥', currency: 'INR', members: names.slice(1), id: gid, memberIds: mids, signed: entries.map((d) => sign(ria, gid, d)) }, token)
  groups.push({ gid, mids })
}
const expense = ({ gid, mids }: { gid: string; mids: string[] }) => {
  const id = newId()
  const amount = 10_000 + Math.floor(Math.random() * 900_000)
  const r = computeSplit(split(mids), amount, mids)
  const data: EntryData = { type: 'expense', id, description: 'Chai', category: 'chai', paidBy: mids[0], total: r.total, shares: r.shares, mode: 'equal', by: mids[0] }
  return { gid, body: JSON.stringify({ id, description: 'Chai', category: 'chai', paidBy: mids[0], amount, split: split(mids), signed: sign(ria, gid, data) }) }
}
const g0 = groups[0]
for (let i = 0; i < 30; i++) await call(`/groups/${g0.gid}/expenses`, JSON.parse(expense(g0).body), token)
const gid = g0.gid
const { token: payToken } = await call(`/groups/${gid}/paylinks`, { from: g0.mids[1], to: g0.mids[0] }, token)

const writes = Math.min(60_000, duration * 4000)
process.stdout.write(`pre-signing ${writes.toLocaleString()} expense entries (Schnorr, on this machine) … `)
const bodies = Array.from({ length: writes }, (_, k) => expense(groups[k % groups.length]))
console.log('done\n')

type Row = { name: string; rps: number; p50: number; p99: number; bad: number; total: number }
const rows: Row[] = []
async function bench(name: string, opts: Partial<autocannon.Options>) {
  const r = await autocannon({ url, connections, duration, ...opts } as autocannon.Options)
  rows.push({ name, rps: Math.round(r.requests.average), p50: r.latency.p50, p99: r.latency.p99, bad: r.non2xx + r.errors + r.timeouts, total: r.requests.total })
  console.log(`  ${name.padEnd(34)} ${String(Math.round(r.requests.average)).padStart(7)} req/s   p50 ${String(r.latency.p50).padStart(4)} ms   p99 ${String(r.latency.p99).padStart(4)} ms   non-2xx ${r.non2xx + r.errors + r.timeouts}`)
}

const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
await bench('GET /healthz', { url: `${url}/healthz` })
await bench('GET /api/groups/:id (6 people, 30 bills)', { url: `${url}/api/groups/${gid}`, headers: auth })
await bench('GET /api/pay/:token (public)', { url: `${url}/api/pay/${payToken}` })
let i = 0
await bench('POST signed expense (verify + write)', {
  url: `${url}/api/groups/${gid}/expenses`,
  method: 'POST',
  headers: auth,
  requests: [
    {
      method: 'POST',
      setupRequest: (req) => {
        const b = bodies[i++ % bodies.length]
        return { ...req, path: `/api/groups/${b.gid}/expenses`, body: b.body }
      },
    },
  ],
})

console.log('\n| endpoint | req/s | p50 ms | p99 ms | non-2xx |\n| --- | ---: | ---: | ---: | ---: |')
for (const r of rows) console.log(`| ${r.name} | ${r.rps.toLocaleString()} | ${r.p50} | ${r.p99} | ${r.bad} |`)
