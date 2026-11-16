import { motion } from 'framer-motion'
import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Spinner } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { ago } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { sfx } from '../lib/sound'
import { useResource } from '../lib/useResource'
import { verifyFromRelays, type VerifyResult } from '../lib/verify'
import { VerifyReport } from './Verify'

type Ledger = {
  pubkey: string
  relays: string[]
  offsite: boolean
  entries: { seq: number; type: string; eventId: string; relaysOk: string[]; createdAt: number; signer: string | null; signerName: string | null }[]
}

const ICON: Record<string, string> = { group: '🏁', member: '🙋', claim: '🪪', expense: '🧾', void: '🗑️', settlement: '🤝' }

/** The hash chain, drawn as links. Each sticker points at the one before it. */
export function LedgerProof() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const toast = useToast()
  const { data } = useResource(`ledger:${id}`, () => api<Ledger>(`/groups/${id}/ledger`))
  const [res, setRes] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)

  const verify = async () => {
    setBusy(true)
    try {
      const { backup } = await api<{ backup: string }>(`/groups/${id}/backup`)
      const r = await verifyFromRelays(backup)
      setRes(r)
      r.report.ok ? sfx.success() : sfx.error()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <div className="screen"><TopBar back={`/g/${id}/settings`} title="…" /><Spinner /></div>
  const name = (t: string) =>
    ({
      group: T('group created', 'group bana'),
      member: T('person added', 'banda add hua'),
      claim: T('joined with their key', 'apni key se join'),
      expense: T('expense', 'kharcha'),
      void: T('expense removed', 'kharcha hataya'),
      settlement: T('settlement', 'settlement'),
    })[t] ?? t

  return (
    <div className="screen">
      <TopBar back={`/g/${id}/settings`} title={T('History', 'History')} sub={`${data.entries.length} ${T('entries', 'entries')}`} />
      <p className="lede">
        {T(
          'Every change, in order. Each one is signed by the person who made it and linked to the one before, so nothing can be edited or slipped in later. A sealed backup copy lives off our servers; only your group can open it.',
          'Har change, order mein. Har ek pe banane wale ka sign hai aur pichhle se juda hai, toh baad mein kuch badla ya ghusaya nahi ja sakta. Ek sealed backup copy humare servers ke bahar hai; sirf tera group use khol sakta hai.',
        )}
      </p>
      {data.offsite && (
        <Press tone="ink" block loading={busy} onClick={verify}>
          🔎 {T('Check the backup copy now', 'Backup copy abhi check kar')}
        </Press>
      )}
      {res && <VerifyReport res={res} />}
      <ol className="chain">
        {[...data.entries].reverse().map((e, i) => (
          <motion.li key={e.seq} className="chain__link stk" initial={{ opacity: 0, x: i % 2 ? 14 : -14 }} animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 10) * 0.03 } }}>
            <span className="chain__seq">#{e.seq}</span>
            <span className="chain__icon">{ICON[e.type] ?? '•'}</span>
            <span className="chain__mid">
              <b>{name(e.type)}</b>
              <small className="mono">{e.eventId.slice(0, 16)}…</small>
              <small>
                {ago(e.createdAt, lang)}
                {e.signer ? (
                  <span className="chain__signer" title={e.signer}>
                    🔏 {T(`signed by ${e.signerName ?? 'a member'}`, `${e.signerName ?? 'member'} ka sign`)}
                  </span>
                ) : (
                  <span className="chain__signer chain__signer--srv">{T('recorded by the app', 'app ne likha')}</span>
                )}
              </small>
            </span>
            <span className="chain__relays" title={e.relaysOk.length ? T(`backed up in ${e.relaysOk.length} places`, `${e.relaysOk.length} jagah backup`) : T('backup pending', 'backup baaki')}>
              {data.relays.map((r) => (
                <i key={r} className={e.relaysOk.includes(r) ? 'ok' : ''} />
              ))}
            </span>
          </motion.li>
        ))}
      </ol>
      <p className="fine">{T('Green dots: backup copies saved.', 'Hare dots: backup copies save hui.')}</p>
    </div>
  )
}
