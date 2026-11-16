import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Avatar } from '../components/Avatar'
import { Emoji } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Press } from '../components/Press'
import { money } from '../lib/format'
import { useLang } from '../lib/i18n'
import { sfx } from '../lib/sound'
import { verifyFromRelays, type VerifyResult } from '../lib/verify'

export function Verify() {
  const { T } = useLang()
  const loc = useLocation()
  const [key, setKey] = useState<string>((loc.state as { key?: string } | null)?.key ?? '')
  const [stage, setStage] = useState<string | null>(null)
  const [res, setRes] = useState<VerifyResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setErr(null)
    setRes(null)
    try {
      const r = await verifyFromRelays(key, setStage)
      setRes(r)
      r.report.ok ? sfx.success() : sfx.error()
    } catch (e) {
      setErr((e as Error).message)
      sfx.error()
    } finally {
      setStage(null)
    }
  }

  useEffect(() => {
    if (key.startsWith('bpd1') && (loc.state as { key?: string } | null)?.key) void run()
    // run once when arriving with a key from group settings
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen">
      <TopBar back title={T('Check a backup', 'Backup check kar')} />
      <p className="lede">
        {T(
          'Paste a group’s backup key. This page fetches the sealed backup copy directly, checks every signature and link, and rebuilds the balances. Our server isn’t involved.',
          'Group ki backup key paste kar. Ye page sealed backup copy seedha laata hai, har signature aur link check karta hai, aur balance dobara banata hai. Humara server beech mein nahi.',
        )}
      </p>
      <textarea className="field mono" rows={4} placeholder="bpd1…" value={key} onChange={(e) => setKey(e.target.value.trim())} spellCheck={false} />
      <Press tone="ink" size="lg" block loading={!!stage} disabled={!key.startsWith('bpd1')} onClick={run}>
        🔎 {T('Check the backup', 'Backup check kar')}
      </Press>
      {stage && <p className="fine center">{stage === 'relays' ? T('fetching the backup…', 'backup laa rahe…') : T('walking the chain…', 'chain check ho rahi…')}</p>}
      {err && <div className="callout callout--owe">{err}</div>}
      {res && <VerifyReport res={res} />}
    </div>
  )
}

export function VerifyReport({ res }: { res: VerifyResult }) {
  const { T } = useLang()
  const r = res.rebuilt
  const cur = r.group?.currency ?? 'INR'
  const name = (id: string) => r.members.find((m) => m.id === id)?.name ?? '?'
  return (
    <motion.section className="vreport" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
      <div className={`vreport__head stk stk--${res.report.ok ? 'get' : 'owe'}`}>
        <Emoji char={res.report.ok ? '🫡' : '🚨'} size={56} />
        <div>
          <b>
            {r.group?.emoji} {r.group?.name ?? T('Unknown group', 'Pata nahi kaunsa group')}
          </b>
          <small>
            {res.report.ok
              ? T(
                  `All good. ${res.report.entries.length} entries, nothing missing or changed. ${res.report.memberSigned} signed by the person who made them.`,
                  `Sab sahi. ${res.report.entries.length} entries, kuch gayab ya badla nahi. ${res.report.memberSigned} unhi ke sign se jinhone banaya.`,
                )
              : T('Problems found', 'Gadbad mili')}
          </small>
        </div>
      </div>
      {!res.report.ok && (
        <ul className="problems">
          {res.report.problems.map((p) => (
            <li key={p}>⚠ {p}</li>
          ))}
        </ul>
      )}
      <h3 className="day__label">{T('Balances rebuilt from the backup', 'Backup se bane balance')}</h3>
      <ul className="split-list stk">
        {r.members.map((m) => {
          const v = r.net[m.id] ?? 0
          return (
            <li key={m.id}>
              <Avatar name={m.name} size={28} />
              <span>{m.name}</span>
              <b className={v > 0 ? 'pos' : v < 0 ? 'neg' : ''}>{money(v, cur, true)}</b>
            </li>
          )
        })}
      </ul>
      <h3 className="day__label">{T('To settle up', 'Settle karne ke liye')}</h3>
      {r.simplified.length ? (
        <ul className="split-list stk">
          {r.simplified.map((t) => (
            <li key={t.from + t.to}>
              <span>
                {name(t.from)} → {name(t.to)}
              </span>
              <b>{money(t.amount, cur)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fine">{T('All square.', 'Sab barabar.')}</p>
      )}
      <p className="fine">{T(`${res.events} sealed entries read`, `${res.events} sealed entries padhi`)}</p>
    </motion.section>
  )
}
