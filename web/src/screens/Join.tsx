import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { cleanUpi } from '@shared/upi'
import { Avatar, AvatarStack } from '../components/Avatar'
import { blast, Emoji, LangToggle, Spinner, ThemeToggle, Wordmark } from '../components/bits'
import { Press } from '../components/Press'
import { useToast } from '../components/Toast'
import { api } from '../lib/api'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { User } from '../lib/types'
import { joinBody } from '../lib/writes'

type Invite = { group: { id: string; name: string; emoji: string; currency: string }; members: { id: string; name: string; joined: boolean; position: number; avatar: string | null }[] }

/** Someone shared the group. Tap your name (or type it), and you're in. Your account is made on the way. */
export function Join() {
  const { code } = useParams()
  const { T, lang } = useLang()
  const { user, ready, status, createAccount } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [inv, setInv] = useState<Invite | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [pick, setPick] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [upi, setUpi] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Invite>(`/invites/${code}`, { auth: false }).then(setInv).catch(setErr)
  }, [code])

  const ghosts = inv?.members.filter((m) => !m.joined) ?? []

  // already signed in and your name is on the list: that's probably you
  useEffect(() => {
    if (!inv || !user || pick) return
    const mine = inv.members.find((m) => !m.joined && m.name.trim().toLowerCase() === user.name.trim().toLowerCase())
    if (mine) setPick(mine.id)
  }, [inv, user]) // eslint-disable-line react-hooks/exhaustive-deps
  const picked = inv?.members.find((m) => m.id === pick)
  const upiOk = !upi.trim() || !!cleanUpi(upi)

  const join = async () => {
    if (!inv) return
    let me: User | null = user
    setBusy(true)
    try {
      if (!me) {
        const n = (picked?.name ?? name).trim()
        if (!n) {
          toast(T('Type your name', 'Naam likh'), { tone: 'owe', emoji: '✍️' })
          return
        }
        if (!upiOk) {
          toast(T('That UPI ID looks off. It’s like name@okaxis', 'UPI ID galat lag rahi hai. Aisi hoti hai: name@okaxis'), { tone: 'owe' })
          return
        }
        me = await createAccount(n, cleanUpi(upi) ?? undefined)
      }
      const r = await api<{ groupId: string }>(`/invites/${code}/join`, { body: await joinBody(me, inv, pick) })
      sfx.success()
      blast('party')
      nav(`/g/${r.groupId}`, { replace: true })
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  if (err)
    return (
      <div className="welcome">
        <div className="welcome__top">
          <Wordmark />
          <LangToggle />
        </div>
        <div className="empty">
          <Emoji char="🫥" size={96} />
          <h3>{errText(err, lang)}</h3>
          <p>{T('Ask whoever sent it for a fresh link.', 'Jisne bheja usse naya link maang.')}</p>
        </div>
      </div>
    )
  if (status === 'locked') return <Navigate to={`/unlock?next=${encodeURIComponent(`/j/${code}`)}`} replace />
  if (!inv || !ready) return <Spinner />

  return (
    <div className="welcome join">
      <div className="welcome__top">
        <Wordmark />
        <div className="topbar__right">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>
      <motion.div className="join-card stk stk--sats" initial={{ rotate: 6, scale: 0.8 }} animate={{ rotate: -2, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <span className="join-card__emoji">{inv.group.emoji}</span>
        <div>
          <small>{T('You’re invited to', 'Tujhe bulaya hai')}</small>
          <h1>{inv.group.name}</h1>
          <span className="join-card__people">
            <AvatarStack names={inv.members} size={24} max={7} /> {inv.members.length} {T('people', 'log')}
          </span>
        </div>
      </motion.div>

      {ghosts.length > 0 && (
        <>
          <h2 className="label">{T('Tap your name', 'Apne naam pe tap kar')}</h2>
          <div className="claim">
            {ghosts.map((m) => (
              <motion.button
                key={m.id}
                type="button"
                className={`claim__btn stk${pick === m.id ? ' stk--get' : ''}`}
                whileTap={{ scale: 0.92 }}
                onClick={() => {
                  sfx.pop()
                  setPick(pick === m.id ? null : m.id)
                }}
              >
                <Avatar name={m.name} size={48} ghost={pick !== m.id} />
                <b>{m.name}</b>
              </motion.button>
            ))}
          </div>
        </>
      )}

      {!user && (
        <div className="welcome__form">
          {!pick && (
            <>
              <label className="label" htmlFor="jname">
                {ghosts.length ? T('Not on the list? Your name', 'List mein nahi? Apna naam') : T('Your name', 'Tera naam')}
              </label>
              <input id="jname" className="field field--big" value={name} maxLength={32} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
            </>
          )}
          <label className="label" htmlFor="jupi">
            {T('Your UPI ID, to get paid back', 'Teri UPI ID, paise wapas lene ke liye')} <small className="muted">({T('optional', 'zaroori nahi')})</small>
          </label>
          <input id="jupi" className={`field${upiOk ? '' : ' field--bad'}`} value={upi} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="name@okaxis" onChange={(e) => setUpi(e.target.value)} />
        </div>
      )}

      <div className="sticky-cta">
        <Press tone="ink" size="lg" block loading={busy} onClick={join}>
          {picked ? T(`Join as ${picked.name}`, `${picked.name} ban ke join kar`) : user ? T(`Join as ${user.name}`, `${user.name} ban ke join kar`) : T('Join the group', 'Group join kar')} →
        </Press>
        <p className="fine center">
          {user
            ? T('You’ll see every bill, who owes who, and the group chat.', 'Har bill, kaun kisko, aur group chat dikhega.')
            : T('Free. No password, no OTP. Your account is made on this phone.', 'Free. Na password, na OTP. Account isi phone pe banta hai.')}
        </p>
      </div>
    </div>
  )
}
