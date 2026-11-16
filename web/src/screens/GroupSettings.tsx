import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AddPeopleSheet } from '../components/AddPeopleSheet'
import { Avatar } from '../components/Avatar'
import { Spinner } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { KittySetup } from '../components/Kitty'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api, ApiError, tokenStore } from '../lib/api'
import { copyText } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { sfx } from '../lib/sound'
import type { GroupFull } from '../lib/types'
import { useResource } from '../lib/useResource'

const EMOJIS = ['🏖️', '🏠', '🍕', '🍻', '✈️', '🎉', '🛺', '🏔️', '☕', '🎓', '🏏', '💍', '🎮', '🛒', '🚗', '💸']

export function GroupSettings() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const nav = useNavigate()
  const toast = useToast()
  const { data: g, mutate } = useResource(`group:${id}`, () => api<GroupFull>(`/groups/${id}`))
  const [busy, setBusy] = useState<string | null>(null)
  const [backup, setBackup] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [kitty, setKitty] = useState(false)
  const [name, setName] = useState<string | null>(null)
  if (!g) return <div className="screen"><TopBar back={`/g/${id}`} title="…" /><Spinner /></div>

  const rename = async (body: { name?: string; emoji?: string }) => {
    try {
      mutate(await api<GroupFull>(`/groups/${g.group.id}`, { method: 'PATCH', body }))
      sfx.pop()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  /** CSV needs the session header, so fetch it and hand the browser a file. */
  const exportCsv = async () => {
    setBusy('csv')
    try {
      const res = await fetch(`/api/groups/${g.group.id}/export.csv`, { headers: { authorization: `Bearer ${tokenStore.get()}` } })
      if (!res.ok) throw new ApiError(res.status, 'export_failed', T('Export failed', 'Export nahi hua'))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'group.csv'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
      sfx.pop()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  const getBackup = async () => {
    setBusy('backup')
    try {
      const r = await api<{ backup: string }>(`/groups/${g.group.id}/backup`)
      setBackup(r.backup)
      await copyText(r.backup)
      toast(T('Backup key copied', 'Backup key copy ho gayi'), { emoji: '🗝️', tone: 'get' })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="screen">
      <TopBar back={`/g/${g.group.id}`} title={T('Group settings', 'Group settings')} sub={`${g.group.emoji} ${g.group.name}`} />

      <h2 className="section-title">{T('Name & look', 'Naam & look')}</h2>
      <section className="stk gset">
        <input
          className="field field--big"
          value={name ?? g.group.name}
          maxLength={40}
          aria-label={T('Group name', 'Group ka naam')}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name?.trim() && name.trim() !== g.group.name && rename({ name })}
        />
        <div className="emoji-grid emoji-grid--small" role="radiogroup" aria-label={T('Group emoji', 'Group emoji')}>
          {EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={e === g.group.emoji} className={`emoji-grid__btn${e === g.group.emoji ? ' is-on' : ''}`} onClick={() => rename({ emoji: e })}>
              {e}
            </button>
          ))}
        </div>
      </section>

      <div className="section-head">
        <h2>{T('People', 'Log')}</h2>
        <Press tone="sats" size="sm" onClick={() => setAdding(true)}>
          ＋ {T('Add people', 'Log add kar')}
        </Press>
      </div>
      <ul className="members stk">
        <AnimatePresence initial={false}>
          {g.members.map((m) => (
            <motion.li key={m.id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
              <Avatar name={m.name} src={m.avatar} size={38} ghost={!m.joined} />
              <span className="members__name">
                <b>
                  {m.name}
                  {m.isMe ? ` (${T('you', 'tu')})` : ''}
                </b>
                <small>
                  {m.joined
                    ? [T('on the app', 'app pe hai'), m.upi ? 'UPI ✓' : '', m.isCreator ? T('created the group', 'group banaya') : ''].filter(Boolean).join(' · ')
                    : m.invited
                      ? T('added, hasn’t said yes yet', 'add kiya, abhi haan nahi bola')
                      : T('just a name, can pay by link', 'bas naam, link se pay kar sakte hain')}
                </small>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {g.members.find((m) => m.isMe)?.isCreator && (
        <ul className="settings stk">
          <li>
            <span>
              🔗 {T('Reset invite link', 'Invite link reset kar')}
              <small>{T('The old link stops working. Use it if the link reached the wrong people.', 'Purana link band ho jaayega. Galat logon tak pahuncha ho toh use kar.')}</small>
            </span>
            <Press
              tone="paper"
              size="sm"
              loading={busy === 'invite'}
              onClick={async () => {
                setBusy('invite')
                try {
                  mutate(await api<GroupFull>(`/groups/${g.group.id}/invite/reset`, { body: {} }))
                  sfx.pop()
                  toast(T('New invite link ready. The old one no longer works.', 'Naya invite link ready. Purana band.'), { tone: 'get', emoji: '🔗', silent: true })
                } catch (e) {
                  toast(errText(e, lang), { tone: 'owe' })
                } finally {
                  setBusy(null)
                }
              }}
            >
              {T('Reset', 'Reset')}
            </Press>
          </li>
        </ul>
      )}

      <h2 className="section-title">{T('Money tools', 'Paise ke tools')}</h2>
      <ul className="settings stk">
        <li>
          <span>
            🏦 {T('Group kitty', 'Group kitty')}
            <small>{g.group.kitty ? T(`On, held by ${g.members.find((m) => m.id === g.group.kitty!.holder)?.name}`, `On, ${g.members.find((m) => m.id === g.group.kitty!.holder)?.name} ke paas`) : T('A shared pot for trips or rent', 'Trip ya rent ke liye common pot')}</small>
          </span>
          <Press tone="paper" size="sm" onClick={() => setKitty(true)}>
            {g.group.kitty ? T('Edit', 'Edit') : T('Start', 'Shuru')}
          </Press>
        </li>
        <li>
          <span>
            🖨️ {T('Statement (PDF)', 'Statement (PDF)')}
            <small>{T('Every bill and payment, ready to print', 'Har bill aur payment, print ke liye ready')}</small>
          </span>
          <Press tone="paper" size="sm" onClick={() => nav(`/g/${g.group.id}/statement`)}>
            {T('Open', 'Khol')}
          </Press>
        </li>
        <li>
          <span>
            📊 {T('Spreadsheet (CSV)', 'Spreadsheet (CSV)')}
            <small>{T('For Excel or Google Sheets', 'Excel ya Google Sheets ke liye')}</small>
          </span>
          <Press tone="paper" size="sm" loading={busy === 'csv'} onClick={exportCsv}>
            {T('Download', 'Download')}
          </Press>
        </li>
      </ul>

      <h2 className="section-title">{T('Tamper-proof history', 'Tamper-proof history')}</h2>
      <section className="backup stk">
        <p>
          {T(
            'Every bill and payment is signed by the person who made it and chained to the one before, so nothing can be changed or slipped in later, by anyone, including us. A sealed backup copy is also kept off our servers.',
            'Har bill aur payment usne sign kiya jisne daala, aur pichhle se chained hai, toh baad mein kuch badla ya ghusaya nahi ja sakta, kisi se bhi, humse bhi. Ek sealed backup copy humare servers ke bahar bhi rehti hai.',
          )}
        </p>
        <Press tone="paper" block onClick={() => nav(`/g/${g.group.id}/ledger`)}>
          ⛓️ {T('See the history', 'History dekh')}
        </Press>
        <details className="howto">
          <summary>{T('Advanced: backup key', 'Advanced: backup key')}</summary>
          <p className="fine">{T('With the group’s backup key, anyone in the group can rebuild every balance from the backup copy, without our server.', 'Group ki backup key se group ka koi bhi member backup copy se saare balance dobara bana sakta hai, humare server ke bina.')}</p>
          <Press tone="sats" size="sm" loading={busy === 'backup'} onClick={getBackup}>
            🗝️ {T('Copy backup key', 'Backup key copy kar')}
          </Press>
          {backup && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="backup__key">
              <code className="mono">{backup}</code>
              <Press tone="paper" size="sm" onClick={() => nav('/verify', { state: { key: backup } })}>
                🔎 {T('Check the backup now', 'Backup abhi check kar')}
              </Press>
            </motion.div>
          )}
        </details>
      </section>

      <AddPeopleSheet open={adding} onClose={() => setAdding(false)} g={g} onChange={mutate} />
      <KittySetup open={kitty} onClose={() => setKitty(false)} g={g} onChange={mutate} />
    </div>
  )
}
