import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { api, ApiError } from '../lib/api'
import { copyText } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import type { Friend, GroupFull } from '../lib/types'
import { addFriendBody, addMemberBody } from '../lib/writes'
import { Avatar } from './Avatar'
import { QR } from './bits'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

export const inviteUrl = (g: GroupFull) => `${window.location.origin}/j/${g.group.inviteCode}`
export const inviteText = (g: GroupFull, lang: 'en' | 'hi') =>
  lang === 'hi'
    ? `${g.group.emoji} ${g.group.name} ka hisaab yahan hai. Join kar, 5 second lagenge: ${inviteUrl(g)}`
    : `${g.group.emoji} We're splitting ${g.group.name} here. Tap to join, it takes 5 seconds: ${inviteUrl(g)}`

/**
 * Three ways in, easiest first: send the link (WhatsApp), add a friend who's already on the app
 * (they get a ping), or just type a name (they can join later, or pay by link without ever joining).
 */
export function AddPeopleSheet({ open, onClose, g, onChange }: { open: boolean; onClose: () => void; g: GroupFull; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [qr, setQr] = useState(false)

  useEffect(() => {
    if (!open) return
    setQr(false)
    api<{ friends: Friend[] }>('/friends')
      .then((r) => setFriends(r.friends))
      .catch(() => setFriends([]))
  }, [open])

  const here = new Set(g.members.map((m) => m.userId).filter(Boolean))
  const addable = (friends ?? []).filter((f) => !here.has(f.id))
  const url = inviteUrl(g)
  const text = inviteText(g, lang)

  const share = async (how: 'wa' | 'native' | 'copy') => {
    sfx.send()
    haptic([8, 40, 8])
    if (how === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    else if (how === 'native' && navigator.share) await navigator.share({ title: g.group.name, text }).catch(() => {})
    else {
      await copyText(url)
      toast(T('Invite link copied', 'Invite link copy ho gaya'), { emoji: '🔗', tone: 'get', silent: true })
    }
  }

  const run = async (key: string, body: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try {
      onChange(await api<GroupFull>(`/groups/${g.group.id}/members`, { body: await body() }))
      sfx.pop()
      toast(ok, { tone: 'get', emoji: '🙌', silent: true })
      return true
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'group_changed' || e.code === 'signature_mismatch')) onChange(await api<GroupFull>(`/groups/${g.group.id}`))
      toast(errText(e, lang), { tone: 'owe' })
      return false
    } finally {
      setBusy(null)
    }
  }

  const addName = async () => {
    const n = name.trim()
    if (!n) return
    if (await run('name', () => addMemberBody(user!, g, n), T(`${n} added`, `${n} add ho gaya`))) setName('')
  }

  return (
    <Sheet open={open} onClose={onClose} title={T('Add people', 'Log add kar')}>
      <section className="addp__link stk stk--get">
        <div>
          <b>{T('Send the invite link', 'Invite link bhej')}</b>
          <small>{T('They tap it, type their name, and they’re in. No app store.', 'Link tap, naam likha, andar. App store ka jhanjhat nahi.')}</small>
        </div>
        <div className="share-row">
          <Press tone="ink" onClick={() => share('wa')}>
            WhatsApp
          </Press>
          {typeof navigator !== 'undefined' && 'share' in navigator ? (
            <Press tone="paper" onClick={() => share('native')}>
              {T('Share', 'Share')}
            </Press>
          ) : null}
          <Press tone="paper" onClick={() => share('copy')}>
            {T('Copy', 'Copy')}
          </Press>
        </div>
        <button type="button" className="linkish" onClick={() => (sfx.tap(), setQr((v) => !v))}>
          {qr ? T('Hide QR', 'QR chhupa') : T('Friend sitting next to you? Show a QR', 'Dost saath baitha hai? QR dikha')}
        </button>
        <AnimatePresence>
          {qr && (
            <motion.div className="addp__qr" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
              <QR text={url} size={190} />
              <small>{T('They scan it with their phone camera', 'Woh phone camera se scan karein')}</small>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {addable.length > 0 && (
        <>
          <h3 className="label">{T('Friends on the app', 'App wale dost')}</h3>
          <ul className="addp__friends">
            {addable.map((f) => (
              <li key={f.id}>
                <Avatar name={f.name} src={f.avatar} size={40} />
                <span>
                  <b>{f.name}</b>
                  <small>{T(`${f.shared} group${f.shared === 1 ? '' : 's'} together`, `${f.shared} group saath mein`)}</small>
                </span>
                <Press tone="sats" size="sm" loading={busy === f.id} disabled={!!busy} onClick={() => run(f.id, () => addFriendBody(user!, g, f), T(`${f.name} added. They’ll get a ping to join.`, `${f.name} add ho gaya. Unko join ka ping jaayega.`))}>
                  ＋ {T('Add', 'Add')}
                </Press>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="label">{T('Or just type a name', 'Ya bas naam likh')}</h3>
      <form
        className="addrow"
        onSubmit={(e) => {
          e.preventDefault()
          void addName()
        }}
      >
        <input className="field" placeholder={T('e.g. Kabir', 'jaise Kabir')} value={name} maxLength={32} onChange={(e) => setName(e.target.value)} enterKeyHint="done" />
        <Press tone="ink" type="submit" loading={busy === 'name'} sound="none" aria-label={T('Add', 'Add')} onClick={() => {}}>
          ＋
        </Press>
      </form>
      <p className="fine">{T('Added by name, they show with a dashed face. You can still split with them and send them a pay link. They can join any time with the invite link and pick their name.', 'Naam se add kiya toh dashed face dikhega. Phir bhi split aur pay link chalega. Invite link se kabhi bhi join karke apna naam chun sakte hain.')}</p>
    </Sheet>
  )
}
