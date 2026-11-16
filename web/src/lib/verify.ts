import { SimplePool } from 'nostr-tools/pool'
import { decodeBackup, groupKeys, LEDGER_KIND, rebuild, verifyChain } from '@shared/ledger'

/** The browser twin of `npm run ledger:verify`: relays in, balances out, no Bhai Paise De server. */
export async function verifyFromRelays(backupKey: string, onStage?: (s: string) => void) {
  const backup = decodeBackup(backupKey)
  const { tag } = groupKeys(backup.k)
  onStage?.('relays')
  const pool = new SimplePool()
  try {
    const events = await pool.querySync(backup.r, { kinds: [LEDGER_KIND], authors: [backup.pk], '#t': [tag] }, { maxWait: 7000 })
    onStage?.('chain')
    const report = verifyChain(events, backup)
    return { backup, events: events.length, report, rebuilt: rebuild(report.entries) }
  } finally {
    pool.close(backup.r)
  }
}

export type VerifyResult = Awaited<ReturnType<typeof verifyFromRelays>>
