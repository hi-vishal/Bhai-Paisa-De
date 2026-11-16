import { motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { parseMoney } from '@shared/money'
import { upiUrl } from '@shared/upi'
import { ShareCardSheet } from '../components/AccountSheets'
import { Avatar } from '../components/Avatar'
import { blast, Emoji, LangToggle, QR, Spinner, ThemeToggle, Wordmark } from '../components/bits'
import { Press } from '../components/Press'
import { Sheet } from '../components/Sheet'
import { useToast } from '../components/Toast'
import { isIOS, isMobile } from '../lib/platform'
import { api } from '../lib/api'
import { copyText, firstName } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { GroupFull, GroupSummary } from '../lib/types'
import { addFriendBody } from '../lib/writes'

type CardInfo = { id: string; name: string; avatar: string | null; upi: string | null; since: number }

/** Someone's card: pay them by UPI, or start splitting with them. */
export function Card() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const { user } = useSession()
  const nav = useNavigate()
  const toast = useToast()
  const [card, setCard] = useState<CardInfo | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [amt, setAmt] = useState('')
  const [split, setSplit] = useState(false)
  const [share, setShare] = useState(false)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api<CardInfo>(`/users/${id}/card`, { auth: false }).then(setCard).catch(setErr)
  }, [id])
  useEffect(() => {
    if (split && user) api<{ groups: GroupSummary[] }>('/groups').then((r) => setGroups(r.groups)).catch(() => setGroups([]))
  }, [split, user])

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
        </div>
      </div>
    )
  if (!card) return <Spinner />

  const me = user?.id === card.id
  const minor = amt.trim() ? parseMoney(amt, 'INR') : null
  const url = card.upi ? upiUrl({ pa: card.upi, pn: card.name, am: minor ?? undefined }) : ''

  const addTo = async (groupId: string) => {
    setBusy(groupId)
    try {
      const g = await api<GroupFull>(`/groups/${groupId}`)
      await api<GroupFull>(`/groups/${groupId}/members`, { body: await addFriendBody(user!, g, card) })
      sfx.success()
      blast('party')
      toast(T(`${firstName(card.name)} added. They’ll get a ping to join.`, `${firstName(card.name)} add ho gaya. Unko ping jaayega.`), { tone: 'get', emoji: '🙌' })
      nav(`/g/${groupId}`)
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="welcome cardpage">
      <div className="welcome__top">
        <Wordmark />
        <div className="topbar__right">
          <ThemeToggle />
          <LangToggle />
        </div>
      </div>

      <motion.section className="mycard mycard--big stk stk--lav" initial={{ rotate: 4, scale: 0.9, opacity: 0 }} animate={{ rotate: -1.5, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 16 }}>
        <Avatar name={card.name} src={card.avatar} size={110} />
        <h1>{card.name}</h1>
        {card.upi && <span className="mono">{card.upi}</span>}
        <small>{T('on Bhai Paise De', 'Bhai Paise De pe')}</small>
      </motion.section>

      {me ? (
        <>
          <p className="callout">{T('This is your card. Share it and friends can pay you or start a group with you.', 'Ye tera card hai. Share kar, dost tujhe pay ya tere saath group bana sakte hain.')}</p>
          <Press tone="ink" size="lg" block onClick={() => setShare(true)}>
            🪪 {T('Share my card', 'Mera card share kar')}
          </Press>
        </>
      ) : (
        <>
          {card.upi && (
            <section className="cardpay stk">
              <b>{T(`Pay ${firstName(card.name)}`, `${firstName(card.name)} ko pay kar`)}</b>
              <input className="field field--big" inputMode="decimal" placeholder={T('₹ amount (optional)', '₹ amount (zaroori nahi)')} value={amt} onChange={(e) => setAmt(e.target.value)} />
              {isMobile() ? (
                <a className="btn btn--get btn--lg btn--block" href={isIOS() ? url.replace('upi://pay', 'gpay://upi/pay') : url} onClick={() => sfx.zap()}>
                  📲 {T('Open UPI app', 'UPI app khol')}
                </a>
              ) : (
                <div className="upipay__qr">
                  <QR text={url} size={170} />
                </div>
              )}
              <button
                type="button"
                className="linkish center"
                onClick={async () => {
                  await copyText(card.upi!)
                  toast(T('UPI ID copied', 'UPI ID copy ho gayi'), { emoji: '📋', tone: 'get', silent: true })
                }}
              >
                {T('Copy UPI ID', 'UPI ID copy kar')}
              </button>
            </section>
          )}
          <Press tone="sats" size="lg" block onClick={() => (user ? setSplit(true) : nav(`/welcome?next=${encodeURIComponent(`/u/${card.id}`)}`))}>
            👯 {T(`Split bills with ${firstName(card.name)}`, `${firstName(card.name)} ke saath split kar`)}
          </Press>
          {!user && <p className="fine center">{T('Free. Takes 10 seconds. No password.', 'Free. 10 second. Koi password nahi.')}</p>}
        </>
      )}
      <ShareCardSheet open={share} onClose={() => setShare(false)} />
      <Sheet open={split} onClose={() => setSplit(false)} title={T(`Add ${firstName(card.name)} to…`, `${firstName(card.name)} ko add kar…`)}>
        {!groups ? (
          <Spinner />
        ) : (
          <div className="picker">
            {groups.map((g) => (
              <button key={g.id} type="button" className="picker__row stk" disabled={!!busy} onClick={() => addTo(g.id)}>
                <span className="picker__emoji">{g.emoji}</span>
                <span className="picker__name">{g.name}</span>
                <span className="picker__go">{busy === g.id ? '…' : '＋'}</span>
              </button>
            ))}
          </div>
        )}
        <Press tone="lav" block onClick={() => nav(`/g/new?with=${card.id}`)}>
          {T('A new group', 'Naya group')}
        </Press>
      </Sheet>
    </div>
  )
}
