import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CURRENCIES, type CurrencyCode } from '@shared/money'
import { Avatar } from '../components/Avatar'
import { blast } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { firstName } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import type { Friend, GroupFull } from '../lib/types'
import { setCached } from '../lib/useResource'
import { addFriendBody, newGroupBody } from '../lib/writes'

const EMOJIS = ['🏖️', '🏠', '🍕', '🍻', '✈️', '🎉', '🛺', '🏔️', '☕', '🎓', '🏏', '💍', '🎮', '🛒', '🚗', '💸']
const SUGGEST = {
  hi: ['Goa trip', 'Flat 4B', 'Office chai', 'Shaadi season', 'Sunday brunch'],
  en: ['Goa trip', 'Flat 4B', 'Office coffee', 'Wedding season', 'Sunday brunch'],
}

export function NewGroup() {
  const { T, lang } = useLang()
  const { user } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const [emoji, setEmoji] = useState('🏖️')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<CurrencyCode>('INR')
  const [curOpen, setCurOpen] = useState(false)
  const [people, setPeople] = useState<string[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [picked, setPicked] = useState<string[]>(() => (params.get('with') ? [params.get('with')!] : []))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ friends: Friend[] }>('/friends')
      .then(async (r) => {
        let list = r.friends
        // arrived from someone's card: they may not be a friend yet
        const w = params.get('with')
        if (w && !list.some((f) => f.id === w)) {
          const c = await api<{ id: string; name: string; avatar: string | null; upi: string | null }>(`/users/${w}/card`, { auth: false }).catch(() => null)
          if (c) list = [{ id: c.id, name: c.name, avatar: c.avatar, upi: !!c.upi, shared: 0 }, ...list]
        }
        setFriends(list)
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const add = () => {
    const names = draft
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (!names.length) return
    const fresh = names.filter((n) => !people.some((p) => p.toLowerCase() === n.toLowerCase()) && n.toLowerCase() !== user?.name.toLowerCase())
    if (!fresh.length) {
      sfx.error()
      return
    }
    sfx.pop()
    haptic(6)
    setPeople((p) => [...p, ...fresh].slice(0, 40))
    setDraft('')
  }

  const create = async () => {
    if (!name.trim()) {
      toast(T('Give the group a name', 'Group ka naam toh rakh'), { tone: 'owe', emoji: '🏷️' })
      return
    }
    setBusy(true)
    try {
      let g = await api<GroupFull>('/groups', { body: await newGroupBody(user!, { name, emoji, currency, members: people }) })
      // friends on the app are added one by one, so each gets their own "you were added" ping
      for (const fid of picked) {
        const f = friends.find((x) => x.id === fid)
        if (!f) continue
        g = await api<GroupFull>(`/groups/${g.group.id}/members`, { body: await addFriendBody(user!, g, f) }).catch(() => g)
      }
      setCached(`group:${g.group.id}`, g)
      sfx.success()
      blast('party')
      nav(`/g/${g.group.id}${g.members.length < 2 ? '?add=1' : ''}`, { replace: true })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <TopBar back="/" title={T('New group', 'Naya group')} />

      <section className="newg">
        <motion.div key={emoji} className="newg__big stk stk--sats" initial={{ scale: 0.6, rotate: -20 }} animate={{ scale: 1, rotate: -4 }} transition={{ type: 'spring', stiffness: 500, damping: 14 }}>
          {emoji}
        </motion.div>
        <div className="emoji-grid" role="radiogroup" aria-label={T('Group emoji', 'Group emoji')}>
          {EMOJIS.map((e) => (
            <motion.button
              key={e}
              role="radio"
              aria-checked={e === emoji}
              className={`emoji-grid__btn${e === emoji ? ' is-on' : ''}`}
              whileTap={{ scale: 0.8, rotate: 15 }}
              onClick={() => {
                sfx.tap()
                setEmoji(e)
              }}
            >
              {e}
            </motion.button>
          ))}
        </div>

        <label className="label" htmlFor="gname">
          {T('Group name', 'Group ka naam')}
        </label>
        <input id="gname" className="field field--big" value={name} maxLength={40} placeholder={SUGGEST[lang][0]} onChange={(e) => setName(e.target.value)} />
        <div className="chips">
          {SUGGEST[lang].map((s) => (
            <button
              key={s}
              type="button"
              className="chip"
              onClick={() => {
                sfx.tap()
                setName(s)
              }}
            >
              {s}
            </button>
          ))}
        </div>

        {friends.length > 0 && (
          <>
            <label className="label">{T('Friends on the app', 'App wale dost')}</label>
            <div className="chips chips--scroll">
              {friends.map((f) => {
                const on = picked.includes(f.id)
                return (
                  <button key={f.id} type="button" className={`chip chip--person${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => (sfx.tap(), setPicked((xs) => (on ? xs.filter((x) => x !== f.id) : [...xs, f.id])))}>
                    <Avatar name={f.name} src={f.avatar} size={22} /> {firstName(f.name)} {on ? '✓' : ''}
                  </button>
                )
              })}
            </div>
          </>
        )}

        <label className="label" htmlFor="pname">
          {T('Anyone else? Just names (optional)', 'Aur koi? Bas naam (zaroori nahi)')}
        </label>
        <div className="addrow">
          <input
            id="pname"
            className="field"
            value={draft}
            placeholder={T('Om, Zoya, Kabir…', 'Om, Zoya, Kabir…')}
            enterKeyHint="done"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <Press tone="ink" onClick={add} sound="none" aria-label={T('Add person', 'Add kar')}>
            ＋
          </Press>
        </div>
        {people.length > 0 && (
          <ul className="people">
            <AnimatePresence>
              {people.map((p) => (
                <motion.li key={p} className="person" layout initial={{ scale: 0.4, opacity: 0, rotate: -10 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} exit={{ scale: 0.4, opacity: 0, rotate: 10 }} transition={{ type: 'spring', stiffness: 500, damping: 22 }}>
                  <Avatar name={p} size={34} ghost />
                  <span>{p}</span>
                  <button
                    type="button"
                    aria-label={`${T('Remove', 'Hata')} ${p}`}
                    onClick={() => {
                      sfx.unpop()
                      setPeople((xs) => xs.filter((x) => x !== p))
                    }}
                  >
                    ✕
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        <p className="fine">{T('You can also send a WhatsApp invite right after. Nobody needs the app to pay you.', 'Baad mein WhatsApp invite bhi bhej sakta hai. Paise dene ke liye kisi ko app nahi chahiye.')}</p>

        <button type="button" className="linkish" onClick={() => (sfx.tap(), setCurOpen((v) => !v))}>
          {T('Currency', 'Currency')}: {CURRENCIES[currency].symbol.trim()} {currency} · {curOpen ? T('done', 'ho gaya') : T('change', 'badal')}
        </button>
        {curOpen && (
          <div className="chips chips--scroll">
            {(Object.keys(CURRENCIES) as CurrencyCode[]).map((c) => (
              <button
                key={c}
                type="button"
                className={`chip${c === currency ? ' chip--on' : ''}`}
                onClick={() => {
                  sfx.tap()
                  setCurrency(c)
                }}
              >
                {CURRENCIES[c].symbol.trim()} {c}
              </button>
            ))}
          </div>
        )}
        {currency !== 'INR' && <p className="fine">{T('UPI paybacks work for ₹ groups. Other currencies settle with “I’ve paid” and “Got it”.', 'UPI payback sirf ₹ groups mein. Baaki currency mein “Maine de diye” aur “Mil gaya” se settle.')}</p>}
      </section>

      <div className="sticky-cta">
        <Press tone="sats" size="lg" block loading={busy} onClick={create}>
          {T('Create group', 'Group bana de')} {emoji}
        </Press>
      </div>
    </div>
  )
}
