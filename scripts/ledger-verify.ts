// npm run ledger:verify -- <backup key> [--relays wss://a,wss://b]
// Rebuilds a group's balances from Nostr relays alone. No Bhai Paise De server involved.

import { SimplePool } from 'nostr-tools/pool'
import { decodeBackup, groupKeys, LEDGER_KIND, rebuild, verifyChain } from '../shared/ledger'
import { formatBase, formatMoney, formatSats } from '../shared/money'

const args = process.argv.slice(2)
const key = args.find((a) => a.startsWith('bpd1')) ?? process.env.BPD_BACKUP
const relayFlag = args.indexOf('--relays')
if (!key) {
  console.error('usage: npm run ledger:verify -- <backup key starting with bpd1> [--relays wss://…,wss://…]')
  process.exit(2)
}

const backup = decodeBackup(key)
const relays = relayFlag >= 0 ? args[relayFlag + 1].split(',') : backup.r
const { tag } = groupKeys(backup.k)

const c = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', m: '\x1b[35m', x: '\x1b[0m' }
console.log(`\n${c.b}🔎 Bhai Paise De: ledger check${c.x}`)
console.log(`${c.dim}signer  ${backup.pk}\nrelays  ${relays.join(', ')}${c.x}\n`)

const pool = new SimplePool()
const events = await pool.querySync(relays, { kinds: [LEDGER_KIND], authors: [backup.pk], '#t': [tag] }, { maxWait: 8000 })
pool.close(relays)

const report = verifyChain(events, backup)
const r = rebuild(report.entries)
const cur = r.group?.currency ?? 'INR'
const name = new Map(r.members.map((m) => [m.id, m.name]))
const money = (n: number) => formatMoney(n, cur)

console.log(`${c.b}${r.group?.emoji ?? ''} ${r.group?.name ?? 'Unknown group'}${c.x}  ${c.dim}${report.entries.length} entries from ${events.length} events${c.x}`)
console.log(report.ok ? `${c.g}✔ chain intact, every signature valid${c.x}` : `${c.r}✘ problems:${c.x}\n` + report.problems.map((p) => `  ${c.r}•${c.x} ${p}`).join('\n'))
console.log(`${c.dim}${report.memberSigned} of ${report.entries.length} entries carry the signature of the member who made them; the rest are server-attested${c.x}`)

const live = r.expenses.filter((e) => !e.voided)
console.log(`\n${c.b}Expenses${c.x} ${c.dim}(${live.length}, ${r.expenses.length - live.length} voided)${c.x}`)
for (const e of live) console.log(`  ${money(e.total).padStart(12)}  ${e.description} ${c.dim}paid by ${name.get(e.paidBy)}${c.x}`)

console.log(`\n${c.b}Settlements${c.x}`)
if (!r.settlements.length) console.log(`  ${c.dim}none yet${c.x}`)
for (const s of r.settlements)
  console.log(
    `  ${money(s.amount).padStart(12)}  ${name.get(s.from)} → ${name.get(s.to)}  ${
      s.method === 'lightning'
        ? `${c.y}⚡ ${formatSats(s.sats ?? 0)}${s.demo ? ' (demo wallet)' : ''}${c.x}`
        : s.method === 'solana'
          ? `${c.g}◎ ${s.asset && s.base ? formatBase(BigInt(s.base), s.asset, 6) : ''} ${s.txSig ? c.dim + s.txSig.slice(0, 16) + '…' : '(demo)'}${c.x}`
          : `${c.m}✋ ${s.note ?? 'manual'}${c.x}`
    }`,
  )

console.log(`\n${c.b}Balances${c.x}`)
for (const m of r.members) {
  const v = r.net[m.id] ?? 0
  console.log(`  ${m.name.padEnd(16)} ${v > 0 ? c.g : v < 0 ? c.r : c.dim}${money(v).padStart(12)}${c.x}`)
}
console.log(`\n${c.b}To settle up${c.x}`)
if (!r.simplified.length) console.log(`  ${c.g}all square 🎉${c.x}`)
for (const t of r.simplified) console.log(`  ${name.get(t.from)} pays ${name.get(t.to)} ${c.b}${money(t.amount)}${c.x}`)
console.log()
process.exit(report.ok ? 0 : 1)
