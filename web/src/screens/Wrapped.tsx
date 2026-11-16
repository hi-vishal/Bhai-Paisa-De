import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Emoji, Spinner } from '../components/bits'
import { Odometer } from '../components/Odometer'
import { api } from '../lib/api'
import { firstName, money } from '../lib/format'
import { useLang } from '../lib/i18n'
import { haptic, sfx } from '../lib/sound'
import type { GroupFull } from '../lib/types'
import { useResource } from '../lib/useResource'
import { computeWrapped } from '../lib/wrapped'

type Slide = { bg: string; emoji: string; kicker: string; big: ReactNode; body: string }
const DURATION = 5200

/** Spotify Wrapped, but for who owes whom. Tap right to skip, left to go back, hold to pause. */
export function Wrapped() {
  const { id } = useParams()
  const { T, lang } = useLang()
  const nav = useNavigate()
  const { data: g } = useResource(`group:${id}`, () => api<GroupFull>(`/groups/${id}`))
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [started, setStarted] = useState(false)

  const slides = useMemo<Slide[]>(() => {
    if (!g) return []
    const w = computeWrapped(g)
    const c = g.group.currency
    const s: Slide[] = [
      {
        bg: 'ink',
        emoji: '🎁',
        kicker: `${g.group.emoji} ${g.group.name}`,
        big: 'Wrapped',
        body: T('Your group’s money drama, in a few slides.', 'Tumhare group ka paisa-drama, kuch slides mein.'),
      },
      {
        bg: 'sats',
        emoji: '💸',
        kicker: T('Together you spent', 'Milke uda diye'),
        big: <Odometer value={money(w.total, c)} />,
        body: T(`${w.count} ${w.count === 1 ? 'bill' : 'bills'}. That’s ${money(w.perHead, c)} a head.`, `${w.count} ${w.count === 1 ? 'bill' : 'bills'}. Matlab ${money(w.perHead, c)} per banda.`),
      },
    ]
    if (w.atm)
      s.push({
        bg: 'get',
        emoji: '🏧',
        kicker: T('The group ATM', 'Group ka ATM'),
        big: firstName(w.atm.name),
        body: T(`Paid ${money(w.atm.amount, c)}, ${Math.round(w.atm.share * 100)}% of everything. Someone buy them a chai.`, `${money(w.atm.amount, c)} bhare, total ka ${Math.round(w.atm.share * 100)}%. Koi isko chai pila do.`),
      })
    if (w.biggest)
      s.push({
        bg: 'owe',
        emoji: '🤯',
        kicker: T('Biggest single bill', 'Sabse bada bill'),
        big: money(w.biggest.amount, c),
        body: T(`“${w.biggest.description}”, paid by ${firstName(w.biggest.by)}. We don’t talk about it.`, `“${w.biggest.description}”, ${firstName(w.biggest.by)} ne bhara. Iske baare mein baat nahi karte.`),
      })
    if (w.topCat)
      s.push({
        bg: 'cash',
        emoji: w.topCat.emoji,
        kicker: T('Your group’s religion', 'Group ka dharm'),
        big: w.topCat[lang],
        body: T(`${w.topCat.count} ${w.topCat.count === 1 ? 'bill' : 'bills'}. Priorities: clear.`, `${w.topCat.count} ${w.topCat.count === 1 ? 'bill' : 'bills'}. Priorities ekdum clear.`),
      })
    s.push(
      w.moocher
        ? {
            bg: 'lav',
            emoji: '🫣',
            kicker: T('Still owes the most', 'Sabse bada dendaar'),
            big: firstName(w.moocher.name),
            body: T(`${money(w.moocher.amount, c)} outstanding. Send them the nuclear roast.`, `${money(w.moocher.amount, c)} baaki. Isko nuclear roast bhej.`),
          }
        : {
            bg: 'lav',
            emoji: '😇',
            kicker: T('Moochers', 'Moochers'),
            big: T('None', 'Zero'),
            body: T('Everyone’s square. Honestly suspicious.', 'Sab ka hisaab clear. Thoda suspicious hai.'),
          },
    )
    if (w.settledCount)
      s.push({
        bg: 'sats',
        emoji: '🤝',
        kicker: T('Paid back', 'Wapas mila'),
        big: money(w.settledAmount, c),
        body: T(
          `${w.settledCount} payments: ${w.upiCount} by UPI${w.chainCount ? `, ${w.chainCount} in crypto` : ''}${w.manualCount ? `, ${w.manualCount} in cash and the rest` : ''}. Every one confirmed by whoever got the money.`,
          `${w.settledCount} payments: ${w.upiCount} UPI se${w.chainCount ? `, ${w.chainCount} crypto mein` : ''}${w.manualCount ? `, ${w.manualCount} cash wagairah` : ''}. Har ek paise lene wale ne confirm kiya.`,
        ),
      })
    if (w.kittyAmount)
      s.push({
        bg: 'get',
        emoji: '🏦',
        kicker: T('Into the kitty', 'Kitty mein gaya'),
        big: money(w.kittyAmount, c),
        body: T('Pooled like a proper squad.', 'Proper squad ki tarah pool kiya.'),
      })
    if (w.ghosts.length)
      s.push({
        bg: 'paper',
        emoji: '👻',
        kicker: T('Never installed the app', 'App kabhi install nahi kiya'),
        big: `${w.ghosts.length}`,
        body: T(`${w.ghosts.slice(0, 3).map(firstName).join(', ')}${w.ghosts.length > 3 ? '…' : ''}. And that’s the whole point.`, `${w.ghosts.slice(0, 3).map(firstName).join(', ')}${w.ghosts.length > 3 ? '…' : ''}. Aur yahi toh point hai.`),
      })
    s.push({
      bg: 'ink',
      emoji: w.settled ? '🥳' : '🫵',
      kicker: T('Until next time', 'Agli baar tak'),
      big: w.settled ? T('All square', 'Hisaab clear') : T('Settle up', 'Settle kar'),
      body: w.settled ? T('Rare. Beautiful. Screenshot it.', 'Rare. Khoobsurat. Screenshot le.') : T('Before the next Wrapped, ideally.', 'Agle Wrapped se pehle, please.'),
    })
    return s
  }, [g, T, lang])

  const go = useCallback(
    (d: number) => {
      setI((x) => {
        const n = x + d
        if (n >= slides.length) {
          nav(`/g/${id}`)
          return x
        }
        if (n !== x) {
          sfx.whoosh()
          haptic(6)
        }
        return Math.max(0, n)
      })
    },
    [slides.length, nav, id],
  )

  useEffect(() => {
    if (!started) {
      setStarted(true)
      sfx.drumroll()
    }
  }, [started])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') go(1)
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'Escape') nav(`/g/${id}`)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, nav, id])

  if (!g || !slides.length) return <Spinner />
  const s = slides[i]

  return (
    <div className={`wrapped wrapped--${s.bg}`} onPointerDown={() => setPaused(true)} onPointerUp={() => setPaused(false)} onPointerCancel={() => setPaused(false)}>
      <div className="wrapped__bars">
        {slides.map((_, k) => (
          <span key={k}>
            {/* the current bar's CSS animation is the timer: when it ends, we advance; pausing it pauses the story */}
            <i
              key={k === i ? `now-${i}` : k}
              className={k < i ? 'done' : k === i ? 'now' : ''}
              style={{ animationDuration: `${DURATION}ms`, animationPlayState: paused ? 'paused' : 'running' }}
              onAnimationEnd={() => k === i && go(1)}
            />
          </span>
        ))}
      </div>
      <button className="wrapped__close" aria-label={T('Close', 'Band kar')} onClick={() => nav(`/g/${id}`)}>
        ✕
      </button>
      <AnimatePresence mode="wait">
        <motion.div key={i} className="wrapped__slide" initial={{ opacity: 0, scale: 0.9, rotate: -3 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} exit={{ opacity: 0, scale: 1.08, rotate: 2 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
          <motion.div initial={{ y: 40, rotate: -20 }} animate={{ y: 0, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.1 }}>
            <Emoji char={s.emoji} size={128} />
          </motion.div>
          <p className="wrapped__kicker">{s.kicker}</p>
          <h1 className="wrapped__big">{s.big}</h1>
          <p className="wrapped__body">{s.body}</p>
        </motion.div>
      </AnimatePresence>
      <button className="wrapped__tap wrapped__tap--l" aria-label={T('Previous', 'Pichla')} onClick={() => go(-1)} />
      <button className="wrapped__tap wrapped__tap--r" aria-label={T('Next', 'Agla')} onClick={() => go(1)} />
    </div>
  )
}
