import {
  AnimatePresence,
  animate,
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from 'framer-motion'
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { simplifyDebts, type Transfer } from '@shared/balances'
import { allocate, formatMoney } from '@shared/money'
import { blast, Emoji, LogoMark, QR } from '../components/bits'
import { Odometer } from '../components/Odometer'
import { useLang } from '../lib/i18n'
import { useInstall } from '../lib/install'
import { isIOS, isMobile } from '../lib/platform'
import { ROAST_LEVELS, roastLine } from '../lib/roast'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import '../styles/landing.css'

type L = [en: string, hi: string]

const MAKER_NAME = 'Vishal Gupta'
const MAKER_MAIL = 'hii.vishalgupta@gmail.com'

const EASE = [0.16, 1, 0.3, 1] as const
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/* ───────── small parts ───────── */

const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  phone: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.6 3.6 5.6 3.6 9s-1.1 6.4-3.6 9c-2.5-2.6-3.6-5.6-3.6-9S9.500 5.600 12 3z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  shuffle: 'M4 7h3c5 0 5 10 10 10h3M17 14l3 3-3 3M20 7h-3c-1.600 0-2.700 1-3.600 2.400M17 4l3 3-3 3M4 17h3c1.600 0 2.700-1 3.600-2.400',
  down: 'M12 5v14M6 13l6 6 6-6',
} as const

function Ico({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  )
}

function Btn({ kind = 'gold', size = 'lg', sound = 'tap', onClick, children }: { kind?: 'gold' | 'ghost'; size?: 'sm' | 'lg'; sound?: 'tap' | 'pop'; onClick: () => void; children: ReactNode }) {
  return (
    <motion.button
      type="button"
      className={`lp-btn lp-btn--${kind} lp-btn--${size}`}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 520, damping: 26 }}
      onClick={() => {
        sfx[sound]()
        haptic(sound === 'pop' ? [6, 30, 10] : 8)
        onClick()
      }}
    >
      <span>{children}</span>
    </motion.button>
  )
}

function Phone({ shot, alt, eager }: { shot: string; alt: string; eager?: boolean }) {
  return (
    <div className="lp-phone">
      <img src={`/landing/${shot}.webp`} alt={alt} width={640} height={1385} loading={eager ? 'eager' : 'lazy'} decoding="async" draggable={false} />
    </div>
  )
}

/** Buttons lean toward a mouse that gets close. Touch never triggers it. */
function Magnetic({ children }: { children: ReactNode }) {
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 15 })
  const sy = useSpring(y, { stiffness: 220, damping: 15 })
  return (
    <motion.div
      className="lp-magnet"
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse') return
        const r = e.currentTarget.getBoundingClientRect()
        x.set((e.clientX - (r.left + r.width / 2)) * 0.3)
        y.set((e.clientY - (r.top + r.height / 2)) * 0.45)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.div>
  )
}

/** A line of text that never stops. It hurries and leans when you scroll. */
function Marquee({ items, dir, className = '' }: { items: string[]; dir: 1 | -1; className?: string }) {
  const reduce = useReducedMotion()
  const x = useMotionValue(dir === 1 ? 0 : -50)
  const { scrollY } = useScroll()
  const v = useSpring(useVelocity(scrollY), { damping: 50, stiffness: 400 })
  const skew = useTransform(v, [-2400, 2400], [dir * 9, dir * -9])
  useAnimationFrame((_, delta) => {
    if (reduce) return
    const boost = Math.min(7, Math.abs(v.get()) / 240)
    let next = x.get() - dir * (1 + boost) * (Math.min(delta, 60) / 1000) * 2.2
    if (next <= -50) next += 50
    if (next > 0) next -= 50
    x.set(next)
  })
  const tx = useMotionTemplate`${x}%`
  return (
    <div className={`lp-mq ${className}`} aria-hidden>
      <motion.div className="lp-mq__track" style={{ x: tx, skewX: skew }}>
        {[0, 1].map((k) => (
          <div className="lp-mq__set" key={k}>
            {items.map((it) => (
              <span key={it}>
                {it}
                <i />
              </span>
            ))}
          </div>
        ))}
      </motion.div>
    </div>
  )
}

/** Headlines rise word by word out of a mask as they come into view. */
function Words({ text }: { text: string }) {
  return (
    <motion.span className="lp-words" initial="hide" whileInView="show" viewport={{ once: true, amount: 0.6 }}>
      {text.split(' ').map((w, i) => (
        <span className="lp-word" key={`${i}-${w}`}>
          <motion.span className="lp-word__in" variants={{ hide: { y: '110%' }, show: { y: '0%' } }} transition={{ duration: 0.9, ease: EASE, delay: i * 0.045 }}>
            {w}
          </motion.span>
        </span>
      ))}
    </motion.span>
  )
}

function InkWord({ p, range, children }: { p: MotionValue<number>; range: [number, number]; children: string }) {
  const opacity = useTransform(p, range, [0.14, 1])
  return <motion.span style={{ opacity }}>{children} </motion.span>
}

/** The words light up one by one as you scroll past. */
function InkIn({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 0.85', 'end 0.45'] })
  const words = text.split(' ')
  return (
    <p ref={ref} className="lp-inkin">
      {words.map((w, i) => (
        <InkWord key={`${i}-${w}`} p={scrollYProgress} range={[i / words.length, (i + 1) / words.length]}>
          {w}
        </InkWord>
      ))}
    </p>
  )
}

/** Text that types itself. The full text holds the space so nothing jumps. */
function Typed({ text, speed = 14 }: { text: string; speed?: number }) {
  const reduce = useReducedMotion()
  const chars = Array.from(text)
  const [n, setN] = useState(reduce ? chars.length : 0)
  useEffect(() => {
    const total = Array.from(text).length
    if (reduce) {
      setN(total)
      return
    }
    setN(0)
    let i = 0
    const id = setInterval(() => {
      i += 2
      setN(i)
      if (i >= total) clearInterval(id)
    }, speed)
    return () => clearInterval(id)
  }, [text, reduce, speed])
  return (
    <span className="lp-typed">
      <span className="lp-typed__ghost" aria-hidden>
        {text}
      </span>
      <span className="lp-typed__live" aria-label={text}>
        {chars.slice(0, n).join('')}
        {n < chars.length && <i className="lp-caret" aria-hidden />}
      </span>
    </span>
  )
}

/* ───────── intro curtain ───────── */

function Intro({ onDone }: { onDone: () => void }) {
  const { T } = useLang()
  const reduce = useReducedMotion()
  const [gone, setGone] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  const n = useMotionValue(0)
  const money = useTransform(n, (v) => formatMoney(Math.round(v / 100) * 100, 'INR'))

  useEffect(() => {
    if (reduce) {
      setGone(true)
      done.current()
      return
    }
    const run = animate(n, 127500, { duration: 0.95, ease: [0.2, 0.8, 0.2, 1] })
    const t = setTimeout(() => {
      setGone(true)
      done.current()
    }, 1200)
    return () => {
      run.stop()
      clearTimeout(t)
    }
  }, [n, reduce])

  return (
    <AnimatePresence>
      {!gone && (
        <motion.div className="lp-intro" exit={{ y: '-100%' }} transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }} aria-hidden>
          <LogoMark size={52} />
          <motion.span className="lp-intro__n">{money}</motion.span>
          <span className="lp-intro__l">{T('still owed to you', 'abhi bhi tere baaki hain')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────── hero ───────── */

const NAME_LINES = ['bhai,', 'paise', 'de.']

function Float({ mx, my, depth, className, delay, ready, children }: { mx: MotionValue<number>; my: MotionValue<number>; depth: number; className: string; delay: number; ready: boolean; children: ReactNode }) {
  const x = useTransform(() => mx.get() * depth)
  const y = useTransform(() => my.get() * depth)
  return (
    <motion.div className={`lp-float ${className}`} style={{ x, y }}>
      <motion.div
        className="lp-float__in"
        style={{ animationDelay: `${-delay * 2}s` }}
        initial={{ opacity: 0, scale: 0.7, filter: 'blur(10px)' }}
        animate={ready ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : undefined}
        transition={{ type: 'spring', stiffness: 220, damping: 20, delay }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function Hero({ go, ready }: { go: () => void; ready: boolean }) {
  const { T } = useLang()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 26, mass: 0.4 })
  const mx = useSpring(0, { stiffness: 80, damping: 18 })
  const my = useSpring(0, { stiffness: 80, damping: 18 })
  const rotY = useTransform(() => -20 + p.get() * 20 + mx.get() * 14)
  const rotX = useTransform(() => 10 - p.get() * 10 - my.get() * 10)
  const phoneY = useTransform(p, [0, 1], [0, -110])
  const phoneS = useTransform(p, [0, 1], [1, 0.88])
  const drift = [useTransform(p, [0, 1], ['0%', '-16%']), useTransform(p, [0, 1], ['0%', '12%']), useTransform(p, [0, 1], ['0%', '-8%'])]
  const fade = useTransform(p, [0, 0.75], [1, 0])
  const orbX = useTransform(() => mx.get() * -40)
  const orbY = useTransform(() => my.get() * -40)
  const inst = useInstall()
  const iosFirst = isIOS() && !inst.standalone

  useEffect(() => {
    if (reduce || !window.matchMedia('(pointer: fine)').matches) return
    const on = (e: PointerEvent) => {
      mx.set(e.clientX / window.innerWidth - 0.5)
      my.set(e.clientY / window.innerHeight - 0.5)
    }
    window.addEventListener('pointermove', on, { passive: true })
    return () => window.removeEventListener('pointermove', on)
  }, [mx, my, reduce])

  return (
    <header className="lp-hero" ref={ref}>
      <div className="lp-hero__bg" aria-hidden>
        <i className="lp-aurora lp-aurora--a" />
        <i className="lp-aurora lp-aurora--b" />
        <i className="lp-gridlines" />
      </div>

      <div className="lp-wrap lp-hero__grid">
        <motion.div className="lp-hero__copy" style={{ opacity: fade }}>
          <h1 className="lp-h1" aria-label="bhai, paise de.">
            {NAME_LINES.map((line, li) => (
              <motion.span className="lp-h1__line" key={line} style={{ x: drift[li] }} aria-hidden>
                {[...line].map((ch, ci) => (
                  <motion.span
                    key={ci}
                    className="lp-h1__ch"
                    initial={{ y: '115%', rotate: 8 }}
                    animate={ready ? { y: '0%', rotate: 0 } : undefined}
                    whileHover={{ y: '-6%', color: '#ffc21a' }}
                    transition={{ type: 'spring', stiffness: 200, damping: 20, delay: ready ? li * 0.1 + ci * 0.03 : 0 }}
                  >
                    {ch}
                  </motion.span>
                ))}
              </motion.span>
            ))}
          </h1>

          <motion.div className="lp-hero__under" initial={{ opacity: 0, y: 24 }} animate={ready ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 0.9, ease: EASE, delay: 0.55 }}>
            <p className="lp-lede">
              {T(
                'That’s Hindi for “bro, pay up”. Split the bill, send one link, and get paid back on UPI before anyone can say “kal pakka”. Free, and your friends don’t even need the app.',
                'Bill split kar, ek link bhej, aur UPI se paise wapas le, isse pehle ki koi “kal pakka” bole. Free hai, aur dosto ko app bhi nahi chahiye.',
              )}
            </p>
            <div className="lp-hero__cta">
              <Magnetic>
                <Btn sound="pop" onClick={() => (iosFirst ? jump('install') : go())}>
                  {iosFirst ? T('Put it on my home screen', 'Home screen pe daal') : T('Start splitting, it’s free', 'Split shuru kar, free hai')}
                </Btn>
              </Magnetic>
              <Btn kind="ghost" onClick={() => jump('how')}>
                {T('Show me how', 'Dikha kaise')}
              </Btn>
            </div>
            <p className="lp-hero__fine">{T('No email. No OTP. No password. Sign-up is literally your name.', 'Na email. Na OTP. Na password. Signup mein bas tera naam.')}</p>
          </motion.div>
        </motion.div>

        <div className="lp-stage">
          <motion.i className="lp-orb" style={{ x: orbX, y: orbY }} aria-hidden />
          <div className="lp-rings" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <motion.div className="lp-device" initial={{ opacity: 0, y: 140 }} animate={ready ? { opacity: 1, y: 0 } : undefined} transition={{ duration: 1.3, ease: EASE, delay: 0.15 }}>
            <motion.div className="lp-device__tilt" style={{ rotateX: rotX, rotateY: rotY, y: phoneY, scale: phoneS, transformPerspective: 1400 }}>
              <Phone eager shot="home" alt={T('The app’s home screen: you get back ₹2,820 across two groups', 'App ki home screen: do groups se ₹2,820 wapas milne hain')} />
            </motion.div>
          </motion.div>

          <Float mx={mx} my={my} depth={-46} className="lp-float--chat" delay={0.9} ready={ready}>
            <span className="lp-ava" style={{ '--c': '#ff3d8b' } as CSSProperties}>
              K
            </span>
            <span>
              <b>Kirito</b>
              <em>kal pakka 😅</em>
            </span>
          </Float>
          <Float mx={mx} my={my} depth={64} className="lp-float--amt" delay={1.05} ready={ready}>
            <small>{T('pay link sent', 'pay link bhej diya')}</small>
            <b>₹1,275</b>
          </Float>
          <Float mx={mx} my={my} depth={-80} className="lp-float--paid" delay={1.2} ready={ready}>
            <span className="lp-tick">
              <Ico name="check" size={16} />
            </span>
            <span>
              <b>{T('Kirito paid you', 'Kirito ne de diye')}</b>
              <em>₹1,275 · UPI</em>
            </span>
          </Float>
        </div>
      </div>

      <motion.button type="button" className="lp-cue" style={{ opacity: fade }} onClick={() => jump('excuses')} aria-label={T('Scroll down', 'Neeche chal')}>
        <i />
        <span>{T('scroll', 'neeche')}</span>
      </motion.button>
    </header>
  )
}

/* ───────── excuses ───────── */

const EXCUSES_HI = ['kal pakka', 'bhej diya na?', 'GPay nahi chal raha', 'salary aane de', 'net slow hai bro', 'UPI limit ho gayi', 'yaad dila dena', 'adjust kar lenge yaar']
const EXCUSES_EN = ['tomorrow, promise', 'didn’t you get it?', 'my UPI is down', 'wait till payday', 'remind me later', 'I’ll get the next one', 'bank server issue', 'bro I’m broke rn']

function Excuses() {
  const { T } = useLang()
  return (
    <section id="excuses" className="lp-excuses">
      <p className="lp-wrap lp-excuses__lead">{T('Every excuse you’ve heard this month:', 'Is mahine ke saare bahane:')}</p>
      <Marquee className="lp-mq--outline" dir={1} items={EXCUSES_HI} />
      <Marquee className="lp-mq--solid" dir={-1} items={EXCUSES_EN} />
    </section>
  )
}

/* ───────── the problem ───────── */

const CHAT: { who: L; text: string; me?: boolean; c: string }[] = [
  { who: ['Zoya', 'Zoya'], text: 'villa booked?? 🏝️', c: '#b9a4ff' },
  { who: ['Kirito', 'Kirito'], text: 'bhai paise bhej raha hu, kal pakka 😅', c: '#ff3d8b' },
  { who: ['Zoya', 'Zoya'], text: 'kal pakka is not a date kirito 💀', c: '#b9a4ff' },
  { who: ['You', 'Tu'], text: 'pay link bhej diya 👀', me: true, c: '#ffc21a' },
]

function Problem() {
  const { T, lang } = useLang()
  return (
    <section className="lp-problem">
      <div className="lp-wrap lp-problem__grid">
        <InkIn
          key={lang}
          text={T(
            'Every splitter can tell you Kirito owes you ₹1,275. None of them go get it. So you become the group’s unpaid recovery agent, and somehow you’re the awkward one.',
            'Har splitter bata deta hai ki Kirito ko ₹1,275 dene hain. Laata koi nahi. Toh tu ban jaata hai group ka free recovery agent, aur awkward bhi tu hi feel karta hai.',
          )}
        />
        <div className="lp-thread" aria-label={T('A group chat you’ve definitely been in', 'Ek group chat jo tune zaroor dekhi hai')}>
          <p className="lp-thread__head">
            <b>Goa trip 🏝️</b>
            <span>{T('4 people, 1 unpaid villa', '4 log, 1 villa ka udhaar')}</span>
          </p>
          {CHAT.map((m, i) => (
            <motion.div
              key={m.text}
              className={`lp-msg${m.me ? ' lp-msg--me' : ''}`}
              initial={{ opacity: 0, scale: 0.7, y: 26 }}
              whileInView={{ opacity: 1, scale: 1, y: 0 }}
              viewport={{ once: true, amount: 0.7 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22, delay: i * 0.35 }}
            >
              {!m.me && (
                <span className="lp-ava" style={{ '--c': m.c } as CSSProperties}>
                  {m.who[0][0]}
                </span>
              )}
              <p>
                {!m.me && <b>{T(...m.who)}</b>}
                {m.text}
              </p>
            </motion.div>
          ))}
          <motion.div className="lp-msg lp-msg--typing" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, amount: 0.7 }} transition={{ delay: 1.7 }} aria-hidden>
            <span className="lp-ava" style={{ '--c': '#ff3d8b' } as CSSProperties}>
              K
            </span>
            <p>
              <i />
              <i />
              <i />
            </p>
          </motion.div>
        </div>
      </div>
      <div className="lp-wrap">
        <p className="lp-problem__out">
          <Words text={T('So we built the part that comes after the maths.', 'Toh humne woh hissa banaya jo hisaab ke baad aata hai.')} />
        </p>
      </div>
    </section>
  )
}

/* ───────── how it works: a sideways film strip ───────── */

const STEPS: { shot: string; glow: string; title: L; short: L; body: L; alt: L }[] = [
  {
    shot: 'add-bill',
    glow: '#b9a4ff',
    title: ['Add the bill', 'Bill daal'],
    short: ['Add', 'Daal'],
    body: [
      'Dinner, cab, that Goa villa. Punch in the amount, pick who paid, and split it five different ways. It always adds up, down to the last paisa.',
      'Dinner, cab, woh Goa wala villa. Amount daal, kisne diya chun, aur paanch tareekon se split kar. Hisaab aakhri paise tak barabar.',
    ],
    alt: ['Adding a ₹3,825 bill called Goa villa', '₹3,825 ka Goa villa bill daalte hue'],
  },
  {
    shot: 'roast',
    glow: '#4fd6e8',
    title: ['Send one link', 'Ek link bhej'],
    short: ['Send', 'Bhej'],
    body: [
      'One WhatsApp message with a pay link in it. Your friend opens it in whatever browser they have. No download, no sign-up, no “which app is this?”',
      'Ek WhatsApp message, usme pay link. Dost kisi bhi browser mein khol leta hai. Na download, na signup, na “ye kaunsa app hai?”',
    ],
    alt: ['The share sheet with a ready-made WhatsApp message and pay link', 'Share sheet, jisme WhatsApp message aur pay link taiyaar hai'],
  },
  {
    shot: 'pay-upi',
    glow: '#ffc21a',
    title: ['They pay on UPI', 'Woh UPI se dete hain'],
    short: ['Pay', 'Pay'],
    body: [
      'The link opens GPay, PhonePe or Paytm with your UPI ID and the exact amount already filled in. All that’s left for them is the PIN.',
      'Link GPay, PhonePe ya Paytm kholta hai, teri UPI ID aur exact amount pehle se bhara hua. Unhe bas PIN daalna hai.',
    ],
    alt: ['The pay page your friend sees: pay ₹1,275 with UPI', 'Dost ko dikhne wala pay page: ₹1,275 UPI se de'],
  },
  {
    shot: 'claim-card',
    glow: '#b8f25b',
    title: ['You tap “Got it”', 'Tu “Mil gaya” dabata hai'],
    short: ['Got it', 'Mil gaya'],
    body: [
      'They hit “I’ve paid”, you get a ping, you peek at your bank and tap “Got it”. Settled for the whole group, receipt in the chat.',
      'Woh “de diye” dabate hain, tujhe ping aata hai, tu bank dekh ke “Mil gaya” dabata hai. Poore group ke liye settle, receipt chat mein.',
    ],
    alt: ['A card saying Kirito paid you ₹1,275, with a Got it button', 'Card: Kirito ne ₹1,275 de diye, saath mein Mil gaya button'],
  },
]

function Flow() {
  const { T } = useLang()
  const reduce = useReducedMotion()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.35 })
  const x = useTransform(p, [0, 1], ['0%', `-${((STEPS.length - 1) / STEPS.length) * 100}%`])
  const [active, setActive] = useState(0)
  const partied = useRef(false)
  const last = STEPS.length - 1

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.max(0, Math.min(last, Math.round(v * last)))
    setActive((cur) => (cur === i ? cur : i))
  })

  useEffect(() => {
    if (active !== last || partied.current) return
    partied.current = true
    const t = setTimeout(() => blast('money'), 350)
    return () => clearTimeout(t)
  }, [active, last])

  const goStep = (i: number) => {
    const el = ref.current
    if (!el) return
    sfx.tap()
    const top = el.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + (el.offsetHeight - window.innerHeight) * (i / last), behavior: 'smooth' })
  }

  return (
    <section id="how" ref={ref} className={`lp-flow${reduce ? ' is-static' : ''}`} style={{ '--glow': STEPS[active].glow, '--n': STEPS.length } as CSSProperties}>
      <div className="lp-flow__pin">
        <i className="lp-flow__glow" aria-hidden />
        <div className="lp-wrap lp-flow__head">
          <h2 className="lp-h2 lp-h2--sm">
            <Words text={T('From “you owe me” to “paid”, in four moves.', '“Paise de” se “mil gaya” tak, chaar step mein.')} />
          </h2>
        </div>

        <motion.ol className="lp-flow__track" style={reduce ? undefined : { x }}>
          {STEPS.map((s, i) => (
            <li className={`lp-panel${i === active ? ' is-on' : ''}`} key={s.shot}>
              <div className="lp-wrap lp-panel__in">
                <div className="lp-panel__shot">
                  <Phone shot={s.shot} alt={T(...s.alt)} />
                  {i === last && (
                    <AnimatePresence>
                      {(active === last || reduce) && (
                        <motion.div className="lp-settled" initial={{ opacity: 0, y: 40, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ type: 'spring', stiffness: 360, damping: 20, delay: 0.25 }}>
                          <span className="lp-tick">
                            <Ico name="check" size={18} />
                          </span>
                          <span>
                            <b>{T('Settled', 'Settle ho gaya')}</b>
                            <em>{T('Receipt is in the group chat', 'Receipt group chat mein hai')}</em>
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                </div>
                <div className="lp-panel__copy">
                  <span className="lp-panel__n" aria-hidden>
                    {i + 1}
                  </span>
                  <h3>{T(...s.title)}</h3>
                  <p>{T(...s.body)}</p>
                </div>
              </div>
            </li>
          ))}
        </motion.ol>

        <div className="lp-wrap lp-flow__nav">
          <div className="lp-flow__bar" aria-hidden>
            <motion.i style={{ scaleX: p }} />
          </div>
          <div className="lp-flow__tabs">
            {STEPS.map((s, i) => (
              <button type="button" key={s.shot} className={i === active ? 'is-on' : ''} aria-current={i === active ? 'step' : undefined} onClick={() => goStep(i)}>
                <b>{i + 1}</b>
                <span>{T(...s.short)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/* ───────── roast-o-meter ───────── */

const HEAT = ['#b8f25b', '#4fd6e8', '#ffc21a', '#ff8a3d', '#ff3d8b']

function Roast() {
  const { T, lang } = useLang()
  const [level, setLevel] = useState(1)
  const [variant, setVariant] = useState(0)
  const lv = ROAST_LEVELS[level]
  const host = typeof window !== 'undefined' ? window.location.host : ''
  const line = roastLine(level, variant, lang, { name: 'Kirito', amt: '₹1,275', what: 'Goa trip', link: `${host}/p/wzpk…` })

  const pick = (n: number) => {
    if (n === level) return
    setLevel(n)
    sfx.spice(n)
    haptic(n >= 4 ? [10, 40, 20] : 8)
  }

  return (
    <section className="lp-roast" style={{ '--heat': HEAT[level] } as CSSProperties}>
      <motion.i className="lp-roast__glow" animate={{ backgroundColor: HEAT[level], scale: 0.8 + level * 0.12 }} transition={{ duration: 0.6, ease: EASE }} aria-hidden />
      <div className="lp-wrap lp-roast__grid">
        <div>
          <h2 className="lp-h2">
            <Words text={T('Pick how hard to roast them.', 'Kitna roast karna hai, tu bata.')} />
          </h2>
          <p className="lp-sub">
            {T(
              'Some friends need a gentle nudge. Some need to be humbled in the group chat. Slide to choose and the message writes itself.',
              'Kuch dosto ko pyaar se bolna padta hai. Kuch ko group chat mein beizzati chahiye. Slider ghuma, message khud likh jaata hai.',
            )}
          </p>
          <p className="lp-note">{T('These are real lines from the app. Yes, the wallet one too.', 'Ye app ki asli lines hain. Haan, kidney wali bhi.')}</p>
        </div>

        <div className={`lp-glass lp-roast__card${level === 4 ? ' is-nuclear' : ''}`}>
          <div className="lp-roast__head">
            <motion.span key={level} initial={{ scale: 0.3, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 14 }}>
              <Emoji char={lv.emoji} size={60} />
            </motion.span>
            <div className="lp-roast__lvl">
              <small>Roast-o-meter</small>
              <AnimatePresence mode="wait" initial={false}>
                <motion.b key={`${level}-${lang}`} initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.35, ease: EASE }}>
                  {lv[lang]}
                </motion.b>
              </AnimatePresence>
            </div>
          </div>

          <input
            className="lp-range"
            type="range"
            min={0}
            max={4}
            step={1}
            value={level}
            style={{ '--p': `${level * 25}%` } as CSSProperties}
            aria-label={T('Roast level', 'Roast level')}
            aria-valuetext={lv[lang]}
            onChange={(e) => pick(Number(e.target.value))}
          />
          <div className="lp-roast__ticks">
            {ROAST_LEVELS.map((r, i) => (
              <button key={r.en} type="button" className={i === level ? 'is-on' : ''} aria-label={r[lang]} onClick={() => pick(i)}>
                {r.emoji}
              </button>
            ))}
          </div>

          <div className="lp-roast__stage">
            <p className="lp-bubble">
              <Typed key={`${level}-${variant}-${lang}`} text={line} />
            </p>
            <span className="lp-bubble__meta">
              {T('WhatsApp message, ready to send', 'WhatsApp message, bhejne ko taiyaar')}
              <Ico name="check" size={14} />
            </span>
          </div>

          <Btn
            kind="ghost"
            size="sm"
            onClick={() => {
              setVariant((n) => n + 1)
            }}
          >
            <Ico name="shuffle" size={16} /> {T('Different line', 'Doosri line')}
          </Btn>
        </div>
      </div>
    </section>
  )
}

/* ───────── feature demos ───────── */

const SPLIT_AMTS = [10000, 100000, 382500]
const SPLIT_CREW: L[] = [
  ['You', 'Tu'],
  ['Zoya', 'Zoya'],
  ['Kirito', 'Kirito'],
  ['Om', 'Om'],
]

/** The app's own split maths, live: shares are whole paise and always add up. */
function SplitDemo() {
  const { T } = useLang()
  const [a, setA] = useState(0)
  const [on, setOn] = useState([true, true, true, false])
  const shares = allocate(SPLIT_AMTS[a], on.map((v) => (v ? 1 : 0)))

  const toggle = (i: number) => {
    if (on[i] && on.filter(Boolean).length === 1) {
      sfx.error()
      return
    }
    if (on[i]) sfx.unpop()
    else sfx.pop()
    haptic(6)
    setOn((xs) => xs.map((v, k) => (k === i ? !v : v)))
  }

  return (
    <div className="lp-split">
      <div className="lp-split__amts" role="group" aria-label={T('Bill amount', 'Bill amount')}>
        {SPLIT_AMTS.map((amt, i) => (
          <button
            key={amt}
            type="button"
            className={`lp-chipbtn${i === a ? ' is-on' : ''}`}
            aria-pressed={i === a}
            onClick={() => {
              sfx.tap()
              setA(i)
            }}
          >
            {i === a && <motion.i layoutId="lp-amt" className="lp-chipbtn__bg" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
            <span>{formatMoney(amt, 'INR')}</span>
          </button>
        ))}
      </div>
      <div className="lp-split__rows">
        {SPLIT_CREW.map((name, i) => (
          <button key={name[0]} type="button" className={`lp-split__row${on[i] ? '' : ' is-off'}`} aria-pressed={on[i]} onClick={() => toggle(i)}>
            <span>{T(...name)}</span>
            {on[i] ? <Odometer value={formatMoney(shares[i], 'INR', { keepZeros: true })} /> : <em>{T('skipped', 'nahi tha')}</em>}
          </button>
        ))}
      </div>
      <p className="lp-fine">{T('Tap a name to drop them. The odd paisa always lands on the same person, so it never drifts.', 'Naam pe tap kar ke hata. Bacha hua paisa hamesha usi ek bande pe jaata hai, hisaab kabhi nahi hilta.')}</p>
    </div>
  )
}

const CREW = [
  { id: 'you', name: ['You', 'Tu'] as L, x: 150, y: 42, c: '#ffc21a' },
  { id: 'zoya', name: ['Zoya', 'Zoya'] as L, x: 256, y: 124, c: '#b9a4ff' },
  { id: 'om', name: ['Om', 'Om'] as L, x: 150, y: 206, c: '#b8f25b' },
  { id: 'kirito', name: ['Kirito', 'Kirito'] as L, x: 44, y: 124, c: '#ff3d8b' },
]
const TANGLE: Transfer[] = [
  { from: 'zoya', to: 'you', amount: 50000 },
  { from: 'kirito', to: 'you', amount: 30000 },
  { from: 'kirito', to: 'zoya', amount: 20000 },
  { from: 'om', to: 'zoya', amount: 40000 },
  { from: 'om', to: 'kirito', amount: 10000 },
  { from: 'you', to: 'om', amount: 15000 },
]
const ORDER = CREW.map((c) => c.id)
const NET = TANGLE.reduce<Record<string, number>>(
  (net, t) => {
    net[t.to] += t.amount
    net[t.from] -= t.amount
    return net
  },
  Object.fromEntries(ORDER.map((id) => [id, 0])),
)
// the same function the app runs on real groups
const CLEAN = simplifyDebts(ORDER, NET)
const at = (id: string) => CREW.find((c) => c.id === id)!

function SimplifyDemo() {
  const { T } = useLang()
  const [simple, setSimple] = useState(false)
  const plan = simple ? CLEAN : TANGLE
  return (
    <div className="lp-untangle">
      <svg viewBox="0 0 300 248" role="img" aria-label={T(`Who owes who: ${plan.length} payments`, `Kaun kisko dega: ${plan.length} payments`)}>
        <defs>
          <marker id="lp-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto">
            <path d="M0 0L10 5L0 10Z" className="lp-untangle__head" />
          </marker>
        </defs>
        <AnimatePresence>
          {plan.map((t) => {
            const a = at(t.from)
            const b = at(t.to)
            const len = Math.hypot(b.x - a.x, b.y - a.y)
            const ux = (b.x - a.x) / len
            const uy = (b.y - a.y) / len
            const k = simple ? 0.5 : 0.36
            return (
              <motion.g key={`${simple}-${t.from}-${t.to}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
                <motion.line
                  className={`lp-untangle__line${simple ? ' is-clean' : ''}`}
                  x1={a.x + ux * 34}
                  y1={a.y + uy * 34}
                  x2={b.x - ux * 38}
                  y2={b.y - uy * 38}
                  strokeWidth={simple ? 3.5 : 2}
                  strokeLinecap="round"
                  markerEnd="url(#lp-arrow)"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
                <text className="lp-untangle__amt" x={a.x + (b.x - a.x) * k} y={a.y + (b.y - a.y) * k + 4} textAnchor="middle">
                  {formatMoney(t.amount, 'INR')}
                </text>
              </motion.g>
            )
          })}
        </AnimatePresence>
        {CREW.map((c) => (
          <g key={c.id}>
            <circle className="lp-untangle__node" cx={c.x} cy={c.y} r="30" stroke={c.c} />
            <text className="lp-untangle__name" x={c.x} y={c.y + 5} textAnchor="middle">
              {T(...c.name)}
            </text>
          </g>
        ))}
      </svg>
      <div className="lp-untangle__bar">
        <span>
          <b>{T('Simplify debts', 'Udhaar suljha')}</b>
          <small>
            <Odometer value={String(plan.length)} /> {T('payments', 'payments')}
          </small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={simple}
          aria-label={T('Simplify debts', 'Udhaar suljha')}
          className={`lp-switch${simple ? ' is-on' : ''}`}
          onClick={() => {
            if (simple) sfx.toggleOff()
            else sfx.toggleOn()
            haptic(8)
            setSimple(!simple)
          }}
        >
          <motion.i layout transition={{ type: 'spring', stiffness: 600, damping: 32 }} />
        </button>
      </div>
    </div>
  )
}

/** One phone, three browsers: links going out from you to everyone else. */
function LinkFan() {
  const { T } = useLang()
  const ends = [28, 80, 132]
  return (
    <svg className="lp-fan" viewBox="0 0 320 160" role="img" aria-label={T('Your phone sends a link to three friends’ browsers', 'Tera phone teen dosto ke browser mein link bhejta hai')}>
      {ends.map((y, i) => (
        <g key={y}>
          <path className="lp-fan__wire" d={`M78 80 C 160 80, 150 ${y}, 250 ${y}`} />
          <path className="lp-fan__pulse" style={{ animationDelay: `${i * 0.5}s` }} d={`M78 80 C 160 80, 150 ${y}, 250 ${y}`} pathLength={100} />
          <circle className="lp-fan__end" cx="272" cy={y} r="20" />
          <g className="lp-fan__ico" transform={`translate(262 ${y - 10}) scale(0.83)`}>
            <path d={ICONS.globe} />
          </g>
        </g>
      ))}
      <circle className="lp-fan__you" cx="48" cy="80" r="30" />
      <g className="lp-fan__ico lp-fan__ico--you" transform="translate(34 66) scale(1.17)">
        <path d={ICONS.phone} />
      </g>
    </svg>
  )
}

const NAMES = ['Zoya', 'Kirito', 'Om', 'Vishal']

/** The whole sign-up form, typing itself. */
function NameField() {
  const { T } = useLang()
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setI((n) => (n + 1) % NAMES.length), 2600)
    return () => clearInterval(id)
  }, [reduce])
  return (
    <div className="lp-namefield" aria-hidden>
      <small>{T('What do your friends call you?', 'Dost tujhe kya bulate hain?')}</small>
      <p>
        <Typed key={i} text={NAMES[i]} speed={90} />
      </p>
      <span>{T('Get started', 'Shuru kar')}</span>
    </div>
  )
}

const CHAIN: L[] = [
  ['Bill added', 'Bill daala'],
  ['Signed on Zoya’s phone', 'Zoya ke phone pe sign'],
  ['Linked to the entry before it', 'Pichhli entry se juda'],
  ['Encrypted backup', 'Encrypted backup'],
]

const EXTRAS: L[] = [
  ['Receipt photos', 'Receipt ki photo'],
  ['Repeating bills, like rent', 'Har mahine wale bill, jaise rent'],
  ['PDF statement', 'PDF statement'],
  ['CSV for your spreadsheet nerd', 'Spreadsheet wale dost ke liye CSV'],
  ['Push notifications', 'Push notifications'],
  ['Works offline', 'Offline bhi chalta hai'],
  ['A profile card with your QR', 'QR wala profile card'],
  ['Nine currencies', 'Nau currencies'],
  ['Light and dark', 'Light aur dark'],
  ['English and Hinglish', 'English aur Hinglish'],
  ['USDT and SOL, if that’s your thing', 'USDT aur SOL, agar shauk hai'],
]

function Card({ span, tone = '', i, children }: { span: number; tone?: string; i: number; children: ReactNode }) {
  return (
    <motion.article
      className={`lp-card lp-c${span}${tone ? ` lp-card--${tone}` : ''}`}
      initial={{ opacity: 0, y: 60, filter: 'blur(12px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.9, ease: EASE, delay: (i % 3) * 0.08 }}
    >
      {children}
    </motion.article>
  )
}

function Features() {
  const { T } = useLang()
  // one listener lights every card: each gets the pointer position in its own box
  const spot = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    for (const el of e.currentTarget.querySelectorAll<HTMLElement>('.lp-card')) {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
  }
  return (
    <section className="lp-features">
      <div className="lp-wrap">
        <h2 className="lp-h2">
          <Words text={T('Everything the group needs. Nothing your friends have to install.', 'Group ko jo chahiye, sab hai. Dosto ko install kuch nahi karna.')} />
        </h2>
        <div className="lp-bento" onPointerMove={spot}>
          <Card span={5} i={0}>
            <h3>{T('Only you need the app', 'App sirf tujhe chahiye')}</h3>
            <p>
              {T(
                'You keep the hisaab. Everyone else gets a link that works in any browser. Zero “download this first” energy.',
                'Hisaab tu rakh. Baaki sabko link milta hai jo kisi bhi browser mein chalta hai. “Pehle ye download kar” wala scene hi nahi.',
              )}
            </p>
            <LinkFan />
          </Card>

          <Card span={7} i={1}>
            <h3>{T('Five ways to split', 'Split ke paanch tareeke')}</h3>
            <p>{T('Equal, exact amounts, shares, percent, or item by item with tax and tip shared fairly. Try the equal one:', 'Barabar, exact amount, shares, percent, ya item by item, tax aur tip sahi hisse mein. Barabar wala try kar:')}</p>
            <SplitDemo />
          </Card>

          <Card span={7} i={2}>
            <div className="lp-card__split">
              <div>
                <h3>{T('Fewer payments', 'Kam payments')}</h3>
                <p>{T('Everyone owing everyone in circles? Flip the switch and it untangles into the fewest payments possible.', 'Sab ek doosre ke udhaar mein ghoom rahe hain? Switch daba, sab sulajh ke kam se kam payments ban jaate hain.')}</p>
              </div>
              <SimplifyDemo />
            </div>
          </Card>

          <Card span={5} i={3} tone="peek">
            <h3>{T('A chat in every group', 'Har group mein chat')}</h3>
            <p>{T('Bills, payments and every “kal pakka” in one thread. Tap a message to react.', 'Bill, payment aur har “kal pakka” ek hi thread mein. Message pe tap kar ke react kar.')}</p>
            <div className="lp-card__peek lp-card__peek--chat">
              <Phone shot="group-chat" alt={T('A group chat where bills show up between messages', 'Group chat, jisme messages ke beech bill dikhte hain')} />
            </div>
          </Card>

          <Card span={5} i={4} tone="peek">
            <h3>{T('A kitty for the trip', 'Trip ke liye kitty')}</h3>
            <p>{T('One person holds the pot, everyone chips in, bills get paid from it. The maths fixes itself.', 'Ek banda pot rakhta hai, sab daalte hain, bill usi se bharte hain. Hisaab apne aap theek.')}</p>
            <div className="lp-card__peek lp-card__peek--kitty">
              <Phone shot="kitty" alt={T('A group kitty with ₹5,000 in it', 'Group kitty jisme ₹5,000 hain')} />
            </div>
          </Card>

          <Card span={3} i={5}>
            <h3>{T('Name and go', 'Naam likh, chal')}</h3>
            <p>{T('Sign-up is one screen. Your account is a key on your phone, so there’s no password to forget.', 'Signup ek screen ka hai. Tera account tere phone pe ek key hai, toh bhoolne ko password hi nahi.')}</p>
            <NameField />
          </Card>

          <Card span={4} i={6} tone="peek">
            <h3>{T('Wrapped, for your group', 'Tere group ka Wrapped')}</h3>
            <p>{T('A story-style recap: the group ATM, the biggest bill and, yes, the moocher.', 'Story jaisa recap: group ka ATM, sabse bada bill, aur haan, muftkhor bhi.')}</p>
            <div className="lp-card__peek lp-card__peek--wrapped">
              <Phone shot="wrapped" alt={T('The first slide of a group’s Wrapped', 'Group ke Wrapped ki pehli slide')} />
            </div>
          </Card>

          <Card span={12} i={7} tone="wide">
            <div>
              <span className="lp-card__ico">
                <Ico name="lock" size={22} />
              </span>
              <h3>{T('Nobody can fake a “Got it”', '“Mil gaya” koi fake nahi kar sakta')}</h3>
              <p>
                {T(
                  'Every bill and every confirmation is signed on the phone of whoever made it. Not your friend, not even our server, can mark a debt paid for you.',
                  'Har bill aur har confirmation usi ke phone pe sign hota hai jisne banaya. Na tera dost, na humara server, tere naam se udhaar chukta kar sakta hai.',
                )}
              </p>
            </div>
            <ol className="lp-chain">
              {CHAIN.map((c, k) => (
                <li key={c[0]} style={{ animationDelay: `${k * 0.9}s` }}>
                  <i>
                    <Ico name="check" size={14} />
                  </i>
                  {T(...c)}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
      <p className="lp-wrap lp-extras__lead">{T('Also in there:', 'Aur bhi hai:')}</p>
      <Marquee className="lp-mq--chips" dir={1} items={EXTRAS.map((e) => T(...e))} />
    </section>
  )
}

/* ───────── them vs us ───────── */

const VERSUS: { what: L; them: L; us: L }[] = [
  { what: ['Who needs the app', 'App kisko chahiye'], them: ['Everyone in the group', 'Group mein sabko'], us: ['Just you. Friends pay from a link', 'Sirf tujhe. Dost link se dete hain'] },
  {
    what: ['Getting paid back', 'Paise wapas lena'],
    them: ['“Mark as paid”, then go hunt for their UPI ID', '“Mark as paid”, phir unki UPI ID dhoondh'],
    us: ['Their UPI app opens with the amount filled in', 'Unka UPI app amount ke saath khulta hai'],
  },
  { what: ['Signing up', 'Signup'], them: ['Email, phone, OTP, password', 'Email, phone, OTP, password'], us: ['Your name. That’s the whole form', 'Tera naam. Bas itna hi form hai'] },
  { what: ['Reminders', 'Yaad dilana'], them: ['One polite notification', 'Ek seedha saadha notification'], us: ['A sarcasm dial, from Saint to Nuclear', 'Sarcasm dial, Sanskaari se Nuclear tak'] },
  { what: ['The record', 'Record'], them: ['Their database. Trust them', 'Unka database. Bharosa rakh'], us: ['Every change signed by whoever made it', 'Har change pe usi ka sign jisne kiya'] },
]

function Versus() {
  const { T } = useLang()
  return (
    <section className="lp-vs">
      <div className="lp-wrap">
        <h2 className="lp-h2">
          <Words text={T('Same maths. Very different ending.', 'Hisaab wahi. Ending alag.')} />
        </h2>
        <div className="lp-vs__table" role="table">
          <div className="lp-vs__row lp-vs__row--head" role="row">
            <span role="columnheader" />
            <span role="columnheader">{T('Most splitters', 'Baaki splitters')}</span>
            <span role="columnheader">Bhai Paise De</span>
          </div>
          {VERSUS.map((r, i) => (
            <motion.div className="lp-vs__row" role="row" key={r.what[0]} initial="hide" whileInView="show" viewport={{ once: true, amount: 0.7 }}>
              <span className="lp-vs__what" role="rowheader">
                {T(...r.what)}
              </span>
              <span className="lp-vs__them" role="cell">
                <Ico name="x" size={16} />
                {/* the plain span is the flex item, so the strike stays inline and follows each wrapped line */}
                <span>
                  <motion.span className="lp-strike" variants={{ hide: { backgroundSize: '0% 2px' }, show: { backgroundSize: '100% 2px' } }} transition={{ duration: 0.7, ease: EASE, delay: 0.25 }}>
                    {T(...r.them)}
                  </motion.span>
                </span>
              </span>
              <motion.span className="lp-vs__us" role="cell" variants={{ hide: { opacity: 0, x: 40 }, show: { opacity: 1, x: 0 } }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.02 }}>
                <span className="lp-tick">
                  <Ico name="check" size={14} />
                </span>
                {T(...r.us)}
              </motion.span>
            </motion.div>
          ))}
        </div>
        <p className="lp-vs__safe">
          {T(
            'And your money never touches us. UPI moves it straight from their bank to yours. We only keep the hisaab.',
            'Aur tera paisa humse hoke nahi jaata. UPI seedha unke bank se tere bank mein bhejta hai. Hum bas hisaab rakhte hain.',
          )}
        </p>
      </div>
    </section>
  )
}

/* ───────── install ───────── */

function Install({ go, signedIn }: { go: () => void; signedIn: boolean }) {
  const { T } = useLang()
  const inst = useInstall()
  const [installed, setInstalled] = useState(false)
  const ios = isIOS()
  const phone = isMobile()
  const url = typeof window !== 'undefined' ? window.location.origin : ''

  const install = async () => {
    const ok = await inst.prompt()
    if (!ok) return
    setInstalled(true)
    sfx.success()
    blast('party')
  }

  const iosSteps: L[] = [
    ['Open this page in Safari and tap the Share button', 'Ye page Safari mein khol aur Share button daba'],
    ['Pick “Add to Home Screen”', '“Add to Home Screen” chun'],
    ['Open it from the new icon and sign up there', 'Naye icon se khol aur wahin signup kar'],
  ]
  const androidSteps: L[] = [
    ['Tap ⋮ at the top of Chrome', 'Chrome mein upar ⋮ daba'],
    ['Pick “Install app” or “Add to Home screen”', '“Install app” ya “Add to Home screen” chun'],
  ]
  const steps = ios ? iosSteps : androidSteps

  return (
    <section id="install" className="lp-install">
      <i className="lp-install__glow" aria-hidden />
      <div className="lp-wrap lp-install__grid">
        <div>
          <motion.div className="lp-appicon" initial={{ y: -80, opacity: 0, rotate: -20 }} whileInView={{ y: 0, opacity: 1, rotate: 0 }} viewport={{ once: true, amount: 0.8 }} transition={{ type: 'spring', stiffness: 260, damping: 13 }}>
            <LogoMark size={56} />
          </motion.div>
          <h2 className="lp-h2">
            <Words text={T('Put it on your home screen.', 'Home screen pe daal le.')} />
          </h2>
          <p className="lp-sub">
            {T(
              'It’s a website that installs like an app. No app store, opens full screen, works offline for anything you’ve already seen, and pings you when someone pays.',
              'Ye ek website hai jo app ki tarah install hoti hai. Na app store, full screen khulti hai, jo dekh chuka woh offline bhi chalta hai, aur koi paise de toh ping aata hai.',
            )}
          </p>
          <div className="lp-install__cta">
            {inst.canPrompt && !installed && (
              <Magnetic>
                <Btn sound="pop" onClick={() => void install()}>
                  {T('Install the app', 'App install kar')}
                </Btn>
              </Magnetic>
            )}
            <Btn kind={inst.canPrompt && !installed ? 'ghost' : 'gold'} onClick={go}>
              {signedIn ? T('Back to my groups', 'Mere groups pe chal') : T('Use it right here', 'Yahin chala le')}
            </Btn>
          </div>
        </div>

        <motion.div className="lp-glass lp-install__card" initial={{ y: 60, opacity: 0, filter: 'blur(12px)' }} whileInView={{ y: 0, opacity: 1, filter: 'blur(0px)' }} viewport={{ once: true, amount: 0.4 }} transition={{ duration: 0.9, ease: EASE }}>
          {installed || inst.standalone ? (
            <div className="lp-install__done">
              <span className="lp-tick lp-tick--lg">
                <Ico name="check" size={26} />
              </span>
              <h3>{T('It’s on your phone', 'Tere phone pe aa gaya')}</h3>
              <p>{T('Find the yellow speech bubble on your home screen and open it from there.', 'Home screen pe peela speech bubble dhoondh aur wahin se khol.')}</p>
            </div>
          ) : phone ? (
            <>
              <h3>{ios ? T('On iPhone, three taps', 'iPhone pe, teen tap') : T('On Android, two taps', 'Android pe, do tap')}</h3>
              <ol className="lp-install__steps">
                {steps.map((s, i) => (
                  <motion.li key={s[0]} initial={{ opacity: 0, x: 24 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, ease: EASE, delay: 0.2 + i * 0.12 }}>
                    <b>{i + 1}</b>
                    <span>{T(...s)}</span>
                  </motion.li>
                ))}
              </ol>
              <p className="lp-fine">
                {ios
                  ? T('iPhone keeps Safari and the home-screen app separate, so sign up inside the installed one.', 'iPhone Safari aur home-screen app ko alag rakhta hai, isliye signup installed app ke andar kar.')
                  : T('Or hit the Install button if you see one here.', 'Ya yahan Install button dikhe toh wahi daba de.')}
              </p>
            </>
          ) : (
            <div className="lp-install__qr">
              <div className="lp-qr">
                <QR text={url} size={164} />
                <i className="lp-qr__scan" aria-hidden />
              </div>
              <div>
                <h3>{T('Better on your phone', 'Phone pe aur maza')}</h3>
                <p>{T('Point your camera at this, then add it to your home screen from there.', 'Camera ispe dikha, phir wahan se home screen pe daal.')}</p>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  )
}

/* ───────── questions ───────── */

const FAQ: { q: L; a: L }[] = [
  {
    q: ['Is it actually free?', 'Sach mein free hai?'],
    a: ['Yes. No plans, no ads, no “premium” split modes hiding behind a paywall.', 'Haan. Na plan, na ads, na paywall ke peeche chhupe “premium” split.'],
  },
  {
    q: ['Do my friends have to install anything?', 'Dosto ko kuch install karna padega?'],
    a: [
      'No. They get a link, it opens in whatever browser they have, and from there their own UPI app. They can join properly later if they feel like it.',
      'Nahi. Unhe link milta hai, kisi bhi browser mein khulta hai, aur wahan se unka apna UPI app. Mann kare toh baad mein join kar lein.',
    ],
  },
  {
    q: ['Does my money go through you?', 'Paisa tumhare through jaata hai?'],
    a: [
      'Never. UPI moves it from their bank to yours. That’s also why you’re the one who taps “Got it”: only the person who got paid can confirm it.',
      'Kabhi nahi. UPI unke bank se seedha tere bank mein bhejta hai. Isiliye “Mil gaya” tu dabata hai: jise paise mile, wahi confirm kar sakta hai.',
    ],
  },
  {
    q: ['What if I lose my phone?', 'Phone kho gaya toh?'],
    a: [
      'Your account is a key on your phone, so back it up once: stay logged in on a second phone, or write down your 12 backup words. Either one brings everything back.',
      'Tera account phone pe ek key hai, toh ek baar backup le le: doosre phone pe logged in reh, ya 12 backup words likh le. Dono mein se koi bhi sab wapas le aata hai.',
    ],
  },
  {
    q: ['Does it work outside India?', 'India ke bahar chalega?'],
    a: [
      'Groups can run in dollars, euros, dirhams and a few more, and you can settle by cash or bank transfer anywhere. The one-tap payback is UPI, so that bit is India-only.',
      'Group dollar, euro, dirham aur kuch aur currencies mein chal sakte hain, aur cash ya bank transfer se kahin bhi settle ho jaata hai. One-tap payback UPI ka hai, toh woh sirf India mein.',
    ],
  },
]

function Questions() {
  const { T } = useLang()
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section className="lp-faq">
      <div className="lp-wrap lp-faq__grid">
        <h2 className="lp-h2">
          <Words text={T('Fair questions.', 'Jaayaz sawaal.')} />
        </h2>
        <div className="lp-faq__list">
          {FAQ.map((f, i) => {
            const on = open === i
            return (
              <motion.div key={f.q[0]} className={`lp-q${on ? ' is-open' : ''}`} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.7, ease: EASE, delay: i * 0.06 }}>
                <button
                  type="button"
                  className="lp-q__btn"
                  aria-expanded={on}
                  aria-controls={`lp-a-${i}`}
                  onClick={() => {
                    if (on) sfx.unpop()
                    else sfx.pop()
                    setOpen(on ? null : i)
                  }}
                >
                  <span>{T(...f.q)}</span>
                  <i className="lp-q__plus" aria-hidden>
                    <Ico name="plus" size={18} />
                  </i>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div id={`lp-a-${i}`} className="lp-q__a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.45, ease: EASE }}>
                      <p>{T(...f.a)}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ───────── last call + footer ───────── */

function Final({ go, signedIn }: { go: () => void; signedIn: boolean }) {
  const { T } = useLang()
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] })
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 26 })
  const orbS = useTransform(p, [0, 1], [0.5, 1.15])
  const orbY = useTransform(p, [0, 1], ['40%', '0%'])
  const markX = useTransform(p, [0, 1], ['12%', '0%'])
  return (
    <footer className="lp-final" ref={ref}>
      <motion.i className="lp-final__orb" style={{ scale: orbS, y: orbY }} aria-hidden />
      <div className="lp-wrap lp-final__top">
        <h2 className="lp-final__h">
          <Words text={T('Okay. Go get your money.', 'Chal. Ja ke paise le aa.')} />
        </h2>
        <div className="lp-final__cta">
          <Magnetic>
            <Btn sound="pop" onClick={go}>
              {signedIn ? T('Back to my groups', 'Mere groups pe chal') : T('Start splitting, it’s free', 'Split shuru kar, free hai')}
            </Btn>
          </Magnetic>
          <Btn kind="ghost" onClick={() => jump('install')}>
            {T('Add to home screen', 'Home screen pe daal')}
          </Btn>
        </div>
      </div>
      <motion.p className="lp-foot__mark" style={{ x: markX }} aria-hidden>
        bhai paise de.
      </motion.p>
      <div className="lp-wrap lp-foot__row">
        <p className="lp-foot__by">
          {T('Created by', 'Banaya hai')} <b>{MAKER_NAME}</b>
          {T('', ' ne')}
          <a href={`mailto:${MAKER_MAIL}`}>{MAKER_MAIL}</a>
        </p>
        <nav className="lp-foot__links" aria-label={T('More', 'Aur')}>
          <Link to="/help">{T('How it works', 'Kaise kaam karta hai')}</Link>
          <Link to="/help#safety">{T('Privacy and safety', 'Privacy aur safety')}</Link>
        </nav>
      </div>
      <p className="lp-wrap lp-foot__legal">
        © 2026 {MAKER_NAME}. All rights reserved. Bhai Paise De™ and the Bhai Paise De logo are trademarks of {MAKER_NAME}.
      </p>
    </footer>
  )
}

/* ───────── the page ───────── */

export function Landing() {
  const { T, lang, setLang } = useLang()
  const { user } = useSession()
  const nav = useNavigate()
  const go = () => nav(user ? '/' : '/welcome')
  const [ready, setReady] = useState(false)
  const [hidden, setHidden] = useState(false)
  const { scrollY, scrollYProgress } = useScroll()

  // the bar steps aside while you read down, and comes back the moment you scroll up
  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0
    const next = y > prev && y > 320
    setHidden((cur) => (cur === next ? cur : next))
  })

  useEffect(() => {
    const before = document.title
    document.title = 'Bhai Paise De: split bills, get paid back on UPI'
    document.documentElement.classList.add('lp-html')
    return () => {
      document.title = before
      document.documentElement.classList.remove('lp-html')
    }
  }, [])

  return (
    <div className="lp">
      <Intro onDone={() => setReady(true)} />
      <i className="lp-grain" aria-hidden />
      <motion.i className="lp-progress" style={{ scaleX: scrollYProgress }} aria-hidden />

      <motion.nav className="lp-nav" aria-label="Bhai Paise De" initial={{ y: -110 }} animate={{ y: ready && !hidden ? 0 : -110 }} transition={{ duration: 0.6, ease: EASE }}>
        <button type="button" className="lp-nav__brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label={T('Back to top', 'Upar chal')}>
          <LogoMark size={30} />
          <span>bhai paise de.</span>
        </button>
        <button
          type="button"
          className="lp-lang"
          onClick={() => {
            sfx.tap()
            setLang(lang === 'hi' ? 'en' : 'hi')
          }}
          aria-label={lang === 'hi' ? 'Switch to English' : 'Switch to Hinglish'}
        >
          <span className={lang === 'en' ? 'is-on' : ''}>EN</span>
          <span className={lang === 'hi' ? 'is-on' : ''}>हिं</span>
        </button>
        <Btn size="sm" onClick={go}>
          {user ? T('My groups', 'Mere groups') : T('Open the app', 'App khol')}
        </Btn>
      </motion.nav>

      <Hero go={go} ready={ready} />

      <main>
        <Excuses />
        <Problem />
        <Flow />
        <Roast />
        <Features />
        <Versus />
        <Install go={go} signedIn={!!user} />
        <Questions />
      </main>

      <Final go={go} signedIn={!!user} />
    </div>
  )
}
