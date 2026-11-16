import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import type { ChatMessage, EventMeta, GroupFull } from '../lib/types'
import { Avatar } from './Avatar'
import { ClaimCard, methodName } from './ClaimCard'
import { useToast } from './Toast'

const REACTIONS = ['😂', '❤️', '🔥', '👍', '😭', '💸']
const POLL_MS = 3000

type Page = { messages: ChatMessage[]; changed: ChatMessage[]; lastRead: number; more: boolean; now: number }

const clientId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** The group's chat. Bills, payments and joins land here as cards, between the messages. */
export function GroupChat({ g, onActivity, onChange }: { g: GroupFull; onActivity: () => void; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const toast = useToast()
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)
  const [more, setMore] = useState(false)
  const [text, setText] = useState('')
  const [picker, setPicker] = useState<number | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const msgsRef = useRef(msgs)
  msgsRef.current = msgs
  const membersRef = useRef(g.members)
  membersRef.current = g.members
  const since = useRef(0)
  const stick = useRef(true)
  const meId = g.me!
  const member = (id: string | null) => g.members.find((m) => m.id === id)
  const nameOf = (id: string) => {
    const m = member(id)
    return m ? (m.isMe ? T('you', 'tu') : firstName(m.name)) : '?'
  }
  const cur = g.group.currency

  const lastId = (xs: ChatMessage[] | null) => xs?.filter((m) => !m.pending).at(-1)?.id ?? 0

  const markRead = useCallback(
    (last: number) => {
      if (last > 0 && document.visibilityState === 'visible') void api(`/groups/${g.group.id}/chat/read`, { body: { last } }).catch(() => {})
    },
    [g.group.id],
  )

  // first page
  useEffect(() => {
    let dead = false
    api<Page>(`/groups/${g.group.id}/chat`)
      .then((r) => {
        if (dead) return
        setMsgs(r.messages)
        setMore(r.more)
        since.current = r.now
        markRead(lastId(r.messages))
        // someone joined since the group was loaded: refresh it so their name and face show
        const known = new Set(g.members.map((m) => m.id))
        if (r.messages.some((m) => (m.by && !known.has(m.by)) || (m.meta && 'member' in m.meta && !known.has(m.meta.member)))) onActivity()
      })
      .catch(() => !dead && setMsgs([]))
    return () => {
      dead = true
    }
  }, [g.group.id, markRead])

  // then poll for new messages and changes (reactions, deletes, payment cards being answered)
  useEffect(() => {
    if (msgs === null) return
    let stop = false
    let t: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (stop) return
      if (document.visibilityState === 'visible') {
        try {
          const after = lastId(msgsRef.current)
          const r = await api<Page>(`/groups/${g.group.id}/chat?after=${after}&since=${since.current}`)
          since.current = r.now
          if (!stop && (r.messages.length || r.changed.length)) {
            setMsgs((xs) => {
              const byId = new Map(r.changed.map((m) => [m.id, m]))
              const kept = (xs ?? []).map((m) => byId.get(m.id) ?? m).filter((m) => !(m.pending && r.messages.some((n) => n.by === meId && n.text === m.text)))
              const have = new Set(kept.map((m) => m.id))
              return [...kept, ...r.messages.filter((m) => !have.has(m.id))]
            })
            const known = new Set(membersRef.current.map((m) => m.id))
            if (r.messages.some((m) => m.kind === 'event' || (m.by && !known.has(m.by))) || r.changed.some((m) => m.kind === 'event')) onActivity()
            if (r.messages.some((m) => m.by !== meId)) sfx.pop()
            markRead(lastId(r.messages))
          }
        } catch {
          // offline for a moment: the next tick catches up
        }
      }
      if (!stop) t = setTimeout(tick, POLL_MS)
    }
    t = setTimeout(tick, POLL_MS)
    return () => {
      stop = true
      clearTimeout(t)
    }
  }, [msgs === null, g.group.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // stay pinned to the bottom unless the reader scrolled up
  useLayoutEffect(() => {
    const el = list.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  const loadOlder = async () => {
    const first = msgs?.find((m) => !m.pending)?.id
    if (!first) return
    const el = list.current
    const h = el?.scrollHeight ?? 0
    const r = await api<Page>(`/groups/${g.group.id}/chat?before=${first}`)
    stick.current = false
    setMsgs((xs) => [...r.messages, ...(xs ?? [])])
    setMore(r.more)
    requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - h))
  }

  const send = async (raw = text) => {
    const body = raw.trim()
    if (!body) return
    const cid = clientId()
    const temp: ChatMessage = { id: -Date.now(), by: meId, kind: 'text', text: body, meta: null, at: Date.now(), deleted: false, reactions: [], pending: true }
    stick.current = true
    setMsgs((xs) => [...(xs ?? []), temp])
    setText('')
    sfx.send()
    haptic(6)
    try {
      const r = await api<{ message: ChatMessage }>(`/groups/${g.group.id}/chat`, { body: { text: body, clientId: cid } })
      setMsgs((xs) => {
        const without = (xs ?? []).filter((m) => m.id !== temp.id)
        return without.some((m) => m.id === r.message.id) ? without : [...without, r.message]
      })
    } catch (e) {
      setMsgs((xs) => (xs ?? []).filter((m) => m.id !== temp.id))
      setText(body)
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const react = async (m: ChatMessage, emoji: string) => {
    setPicker(null)
    const mine = m.reactions.find((r) => r.by === meId)?.emoji
    const next = mine === emoji ? null : emoji
    sfx.pop()
    setMsgs((xs) => (xs ?? []).map((x) => (x.id === m.id ? { ...x, reactions: [...x.reactions.filter((r) => r.by !== meId), ...(next ? [{ by: meId, emoji: next }] : [])] } : x)))
    try {
      const r = await api<{ message: ChatMessage }>(`/groups/${g.group.id}/chat/${m.id}/react`, { body: { emoji: next } })
      setMsgs((xs) => (xs ?? []).map((x) => (x.id === m.id ? r.message : x)))
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const remove = async (m: ChatMessage) => {
    setPicker(null)
    try {
      await api(`/groups/${g.group.id}/chat/${m.id}`, { method: 'DELETE' })
      sfx.unpop()
      setMsgs((xs) => (xs ?? []).map((x) => (x.id === m.id ? { ...x, deleted: true, text: '' } : x)))
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    }
  }

  const eventLine = (e: EventMeta): { icon: string; text: string } => {
    switch (e.t) {
      case 'expense':
        return {
          icon: e.kitty ? '🏦' : '🧾',
          text: T(`${nameOf(e.paidBy)} paid ${money(e.amount, cur)} for “${e.desc}”${e.kitty ? ' from the kitty' : ''}`, `${nameOf(e.paidBy)} ne “${e.desc}” ke ${money(e.amount, cur)} diye${e.kitty ? ' (kitty se)' : ''}`),
        }
      case 'void':
        return { icon: '🗑️', text: T(`“${e.desc}” was removed`, `“${e.desc}” hata diya`) }
      case 'paid':
        return e.method === 'kitty'
          ? { icon: '🏦', text: T(`${nameOf(e.from)} put ${money(e.amount, cur)} in the kitty`, `${nameOf(e.from)} ne kitty mein ${money(e.amount, cur)} daale`) }
          : { icon: '🤝', text: T(`${nameOf(e.from)} paid ${nameOf(e.to)} ${money(e.amount, cur)}${e.method === 'upi' ? ' by UPI' : ''}. Settled.`, `${nameOf(e.from)} ne ${nameOf(e.to)} ko ${money(e.amount, cur)} diye. Settle.`) }
      case 'claim': {
        const how = methodName(e.method, T)
        const state = e.s === 'confirmed' ? T(' ✅ confirmed', ' ✅ confirm') : e.s === 'rejected' ? T(' ✋ not received yet', ' ✋ abhi nahi mila') : e.s === 'cancelled' ? T(' (taken back)', ' (wapas liya)') : T(' · waiting', ' · wait')
        return { icon: '📨', text: T(`${nameOf(e.from)} says they paid ${nameOf(e.to)} ${money(e.amount, cur)}${how ? ` (${how})` : ''}${state}`, `${nameOf(e.from)}: ${nameOf(e.to)} ko ${money(e.amount, cur)} diye${state}`) }
      }
      case 'join':
        return { icon: '👋', text: T(`${nameOf(e.member)} joined`, `${nameOf(e.member)} aa gaya`) }
      case 'added':
        return { icon: '➕', text: T(`${nameOf(e.member)} was added`, `${nameOf(e.member)} add hua`) }
      case 'nudge':
        return { icon: '🔔', text: T(`${nameOf(e.from)} nudged ${nameOf(e.to)} for ${money(e.amount, cur)}`, `${nameOf(e.from)} ne ${nameOf(e.to)} ko ${money(e.amount, cur)} ke liye yaad dilaya`) }
      case 'kitty':
        return e.holder
          ? { icon: '🏦', text: T(`Kitty on. ${nameOf(e.holder)} holds it${e.target ? `, goal ${money(e.target, cur)}` : ''}`, `Kitty shuru. ${nameOf(e.holder)} ke paas${e.target ? `, goal ${money(e.target, cur)}` : ''}`) }
          : { icon: '🏦', text: T('Kitty closed', 'Kitty band') }
    }
  }

  const QUICK = lang === 'hi' ? ['Bhai paise de 😤', 'Bhej diya ✅', 'Kal pakka 🙏', '😂😂', 'Party kab? 🎉'] : ['Pay up 😤', 'Sent ✅', 'Tomorrow, promise 🙏', '😂😂', 'Next trip when? 🎉']

  if (msgs === null) return <div className="chat chat--loading" aria-busy="true" />

  return (
    <div className="chat">
      <div
        className="chat__list"
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {more && (
          <button type="button" className="linkish center" onClick={loadOlder}>
            {T('Load earlier', 'Pehle ke dikha')}
          </button>
        )}
        {!msgs.length && <p className="chat__empty">{T('Say hi. Bills and payments show up here too.', 'Hi bol. Bills aur payments bhi yahin dikhenge.')}</p>}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1]
          const day = !prev || !sameDay(prev.at, m.at)
          const dayRow = day && (
            <div className="chat__day" key={`d${m.id}`}>
              {new Date(m.at).toLocaleDateString(lang === 'hi' ? 'en-IN' : undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </div>
          )
          if (m.kind === 'event' && m.meta) {
            const line = eventLine(m.meta)
            const pending = m.meta.t === 'claim' && !m.meta.s ? g.claims.find((c) => c.id === (m.meta as { id: string }).id) : null
            return (
              <div key={m.id}>
                {dayRow}
                {pending && pending.to === meId ? (
                  <ClaimCard claim={pending} from={member(pending.from)!} to={member(pending.to)!} groupId={g.group.id} meId={meId} currency={cur} onChange={onChange} />
                ) : (
                  <div className="chat__event">
                    <span aria-hidden>{line.icon}</span> {line.text}
                  </div>
                )}
              </div>
            )
          }
          const mine = m.by === meId
          const who = member(m.by)
          const showWho = !mine && (prev?.by !== m.by || prev?.kind === 'event' || day)
          const counts = new Map<string, number>()
          for (const r of m.reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
          return (
            <div key={m.id}>
              {dayRow}
              <motion.div className={`msg${mine ? ' msg--me' : ''}`} initial={m.pending || i > msgs.length - 3 ? { opacity: 0, y: 8, scale: 0.97 } : false} animate={{ opacity: 1, y: 0, scale: 1 }}>
                {!mine && <span className="msg__face">{showWho && who ? <Avatar name={who.name} src={who.avatar} size={30} /> : null}</span>}
                <div className="msg__col">
                  {showWho && who && <small className="msg__who">{firstName(who.name)}</small>}
                  <button
                    type="button"
                    className={`msg__bubble${m.deleted ? ' is-deleted' : ''}${m.pending ? ' is-pending' : ''}`}
                    disabled={m.deleted || m.pending}
                    onClick={() => (sfx.tap(), setPicker(picker === m.id ? null : m.id))}
                    onDoubleClick={() => react(m, '❤️')}
                  >
                    {m.deleted ? T('message deleted', 'message hata diya') : m.text}
                    <time>{new Date(m.at).toLocaleTimeString(lang === 'hi' ? 'en-IN' : undefined, { hour: 'numeric', minute: '2-digit' })}</time>
                  </button>
                  {counts.size > 0 && (
                    <div className="msg__reacts">
                      {[...counts].map(([e, n]) => (
                        <button key={e} type="button" className={m.reactions.some((r) => r.by === meId && r.emoji === e) ? 'is-mine' : ''} onClick={() => react(m, e)}>
                          {e}
                          {n > 1 && <small>{n}</small>}
                        </button>
                      ))}
                    </div>
                  )}
                  <AnimatePresence>
                    {picker === m.id && (
                      <motion.div className="msg__picker" initial={{ opacity: 0, scale: 0.8, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8 }}>
                        {REACTIONS.map((e) => (
                          <button key={e} type="button" onClick={() => react(m, e)} aria-label={e}>
                            {e}
                          </button>
                        ))}
                        {mine && (
                          <button type="button" className="msg__del" onClick={() => remove(m)}>
                            {T('Delete', 'Hata')}
                          </button>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          )
        })}
      </div>

      <div className="chat__quick">
        {QUICK.map((q) => (
          <button key={q} type="button" className="chip chip--tiny" onClick={() => send(q)}>
            {q}
          </button>
        ))}
      </div>
      <form
        className="chat__composer"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          className="field"
          rows={1}
          value={text}
          maxLength={500}
          placeholder={T('Message', 'Message likh')}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <motion.button type="submit" className="chat__send" whileTap={{ scale: 0.85, rotate: -10 }} disabled={!text.trim()} aria-label={T('Send', 'Bhej')}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M3 11.5L20.5 4 14 21l-2.6-7.4z" fill="currentColor" stroke="#000" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </motion.button>
      </form>
    </div>
  )
}
