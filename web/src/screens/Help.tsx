import { motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { TipSheet } from '../components/AccountSheets'
import { Emoji, MAKER, MAKER_FULL, ThemeToggle, Wordmark } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { Press } from '../components/Press'
import { useLang } from '../lib/i18n'
import { serverInfo } from '../lib/server'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { ServerInfo } from '../lib/types'

type Faq = { id?: string; q: [string, string]; a: [string, string] }

const FAQ: Faq[] = [
  {
    id: 'add',
    q: ['How do I add someone to a group?', 'Group mein kisi ko add kaise karun?'],
    a: [
      'Open the group and tap “＋ Add” under its name. Three ways: send the invite link on WhatsApp (they tap it, pick their name, done), add a friend who already uses the app (they get a ping), or just type a name. People added by name show with a dashed face. You can still split with them and send them pay links; they can join later with the invite link and pick their own name.',
      'Group khol, naam ke neeche “＋ Add” daba. Teen tareeke: WhatsApp pe invite link bhej (woh tap karke apna naam chunte hain), app wale dost ko add kar (unko ping jaata hai), ya bas naam likh. Naam se add kiye log dashed face mein dikhte hain. Unke saath bhi split aur pay link chalta hai; baad mein invite link se join karke apna naam chun sakte hain.',
    ],
  },
  {
    q: ['Do my friends need to install anything?', 'Dosto ko kuch install karna padega?'],
    a: [
      'No. Only the person keeping track needs the app. Everyone else can pay from the pay link in any browser. If they want to add bills or chat, they join with the invite link. That takes about five seconds, with no password and no OTP.',
      'Nahi. Sirf hisaab rakhne wale ko app chahiye. Baaki log pay link se kisi bhi browser mein pay kar sakte hain. Bill daalna ya chat karna ho toh invite link se join karein. Paanch second, na password, na OTP.',
    ],
  },
  {
    id: 'upi',
    q: ['How does paying back by UPI work?', 'UPI se paise lautana kaise kaam karta hai?'],
    a: [
      'Add your UPI ID in Me. When someone owes you, the pay link (or the Pay button in the app) opens their UPI app with your UPI ID and the exact amount already filled in. They pay as usual with their UPI PIN, come back and tap “I’ve paid”. You get a ping and tap “Got it”. Settled for everyone. If a UPI app refuses the link, they can scan the QR or copy your UPI ID instead.',
      'Me mein apni UPI ID daal. Jab koi tera dendaar ho, pay link (ya app ka Pay button) uska UPI app kholta hai, teri UPI ID aur exact amount pehle se bhara. Woh apne UPI PIN se pay karta hai, wapas aake “Maine de diye” dabata hai. Tujhe ping aata hai, tu “Mil gaya” dabata hai. Sabke liye settle. Agar UPI app link na le, toh QR scan ya UPI ID copy kar sakte hain.',
    ],
  },
  {
    q: ['Why do I have to tap “Got it”?', '“Mil gaya” kyun dabana padta hai?'],
    a: [
      'UPI money goes straight from their bank to yours. It never passes through us, so we can’t see it arrive. Your “Got it” is what settles it, and only the person receiving the money can give it. If it hasn’t arrived, tap “Not yet” and they’ll be told to check.',
      'UPI ka paisa unke bank se seedha tere bank jaata hai. Humse hoke nahi jaata, toh hum dekh nahi sakte. Tera “Mil gaya” hi settle karta hai, aur sirf paise lene wala hi de sakta hai. Nahi aaya toh “Abhi nahi aaya” daba, unko check karne bola jaayega.',
    ],
  },
  {
    q: ['Someone paid me in cash. Now what?', 'Kisi ne cash diya. Ab?'],
    a: [
      'In the group, go to Balances and tap “Got it” on their row. Pick cash, UPI or bank, and it’s settled. If they never joined the app, they can’t confirm anything, so whoever paid can record it.',
      'Group mein Balances pe ja, unki row pe “Mil gaya” daba. Cash, UPI ya bank chun, settle. Agar unhone app join nahi kiya, toh jo paise de raha hai woh record kar sakta hai.',
    ],
  },
  {
    q: ['What does “Simplify debts” do?', '“Udhaar simplify” kya karta hai?'],
    a: [
      'If Om owes Ria and Ria owes Zoya, simplifying lets Om pay Zoya directly. Same totals, fewer payments. Turn it off to see who owes whom bill by bill.',
      'Agar Om pe Ria ka udhaar hai aur Ria pe Zoya ka, toh simplify se Om seedha Zoya ko de deta hai. Total wahi, payments kam. Off kar toh bill-wise dikhega.',
    ],
  },
  {
    id: 'kitty',
    q: ['What is the group kitty?', 'Group kitty kya hai?'],
    a: [
      'A shared pot for trips or rent. One person holds the money. Everyone chips in (pay the holder by UPI and tap “I’ve paid”), and bills paid from the pot are marked “Paid from the kitty”. The app tracks whose money is whose. What’s left over shows in Balances as the holder owing it back.',
      'Trip ya rent ke liye common pot. Ek banda paise rakhta hai. Sab daalte hain (holder ko UPI karke “Maine de diye”), aur pot se gaye bills “Kitty se” mark hote hain. App hisaab rakhta hai kiska kitna. Bacha hua Balances mein holder ka udhaar dikhta hai.',
    ],
  },
  {
    q: ['Can I delete or fix a bill?', 'Bill hata ya theek kar sakta hun?'],
    a: [
      'Tap the bill and choose “Remove this bill”, then add it again correctly. Only whoever added it (or the group creator) can remove it. The history keeps a note that it was removed, so nothing disappears silently.',
      'Bill pe tap kar, “Ye bill hata” chun, phir sahi se daal. Sirf jisne daala (ya group creator) hata sakta hai. History mein note rehta hai, kuch chupke se gayab nahi hota.',
    ],
  },
  {
    id: 'phone',
    q: ['I got a new phone. How do I move my account?', 'Naya phone liya. Account kaise laaun?'],
    a: [
      'On the old phone: Me → Log in on another phone → Show QR. On the new phone, open the app and tap “I have the app on another phone”, or just scan the QR with the camera. Lost the old phone? Use your 12 backup words: Welcome → “Log in with my 12 backup words”.',
      'Purane phone pe: Main → Doosre phone pe login → QR dikha. Naye phone pe app khol, “Doosre phone pe app hai” daba, ya camera se QR scan kar. Purana phone kho gaya? 12 backup words use kar: Welcome → “12 backup words se login”.',
    ],
  },
  {
    q: ['What are the 12 backup words?', '12 backup words kya hain?'],
    a: [
      'Your account is a key made on your phone. No password, no OTP. The 12 words are that key written in plain words. Save them on paper (Me → 12 backup words) and you can always get back in. Anyone who has them can log in as you, so don’t share them or screenshot them.',
      'Tera account tere phone pe bani ek key hai. Na password, na OTP. 12 words wahi key hain, seedhe shabdon mein. Kaagaz pe likh le (Main → 12 backup words), toh hamesha wapas aa sakta hai. Jiske paas ye, woh tu ban sakta hai, toh share ya screenshot mat kar.',
    ],
  },
  {
    id: 'safety',
    q: ['Is my money and data safe?', 'Mere paise aur data safe hain?'],
    a: [
      'We never touch your money and never see your bank details or UPI PIN: payments go from one UPI app to another. To run your groups we store names, bills, chats, photos and the UPI ID you chose to share. Every change you make is signed on your phone with your own key, so nobody, including us, can fake a bill or a “Got it” in your name, and each group keeps a tamper-proof history with an encrypted backup copy.',
      'Hum tere paise kabhi nahi chhoote, na bank details ya UPI PIN dekhte hain: payment ek UPI app se doosre mein jaata hai. Groups chalane ke liye hum naam, bills, chat, photos aur teri share ki hui UPI ID rakhte hain. Tera har change tere phone pe teri key se sign hota hai, toh koi bhi, hum bhi, tere naam se fake bill ya “Mil gaya” nahi bana sakta, aur har group ki tamper-proof history ek encrypted backup ke saath rehti hai.',
    ],
  },
  {
    q: ['Can friends pay me in crypto?', 'Dost crypto mein de sakte hain?'],
    a: [
      'Optional, for people who use it. In Me, turn on “Crypto payments” and set a PIN. Friends can then pay you in USDT or SOL on the Solana network, into a wallet on your phone that only you control, and the app settles it automatically when the transfer lands.',
      'Optional, crypto wale logon ke liye. Main mein “Crypto payments” on kar aur PIN rakh. Phir dost Solana network pe USDT ya SOL mein de sakte hain, tere phone ke wallet mein jo sirf tere control mein hai, aur transfer aate hi app khud settle kar deta hai.',
    ],
  },
  {
    q: ['Is it free?', 'Free hai?'],
    a: [`Yes. No ads, no fees, no premium tier. If you love it, you can support ${MAKER} with a small tip.`, `Haan. Na ads, na fees, na premium. Pasand aaye toh ${MAKER} ko chhota sa tip de sakta hai.`],
  },
]

const STEPS: { emoji: string; en: [string, string]; hi: [string, string] }[] = [
  { emoji: '🏖️', en: ['Make a group', 'A trip, the flat, Friday dinner. Give it a name and an emoji.'], hi: ['Group bana', 'Trip, flat, Friday dinner. Naam aur emoji de.'] },
  { emoji: '👯', en: ['Add your people', 'Send the invite on WhatsApp, or just type names. They don’t need the app to pay you.'], hi: ['Log add kar', 'WhatsApp pe invite bhej, ya bas naam likh. Paise dene ke liye unko app nahi chahiye.'] },
  { emoji: '🧾', en: ['Add bills as you go', 'Who paid, and how to split: equally, exact amounts, shares, % or item by item.'], hi: ['Bill daalta ja', 'Kisne diya, aur kaise baante: barabar, exact, shares, % ya item-wise.'] },
  { emoji: '📲', en: ['Settle up by UPI', 'Tap Pay: their UPI app opens with the amount filled in. They tap “I’ve paid”, you tap “Got it”. Done.'], hi: ['UPI se settle kar', 'Pay daba: UPI app amount ke saath khulta hai. Woh “Maine de diye”, tu “Mil gaya”. Khatam.'] },
]

function Item({ f, open, onToggle }: { f: Faq; open: boolean; onToggle: () => void }) {
  const { lang } = useLang()
  const i = lang === 'hi' ? 1 : 0
  return (
    <li id={f.id} className={`faq__item${open ? ' is-open' : ''}`}>
      <button type="button" aria-expanded={open} onClick={onToggle}>
        <span>{f.q[i]}</span>
        <i aria-hidden>{open ? '−' : '+'}</i>
      </button>
      {open && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
          {f.a[i]}
        </motion.p>
      )}
    </li>
  )
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section className="help__sec" id={id}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  )
}

export function Help() {
  const { T } = useLang()
  const { user } = useSession()
  const nav = useNavigate()
  const [open, setOpen] = useState<number | null>(null)
  const [tip, setTip] = useState(false)
  const [server, setServer] = useState<ServerInfo | null>(null)
  const [licenses, setLicenses] = useState(false)

  useEffect(() => {
    void serverInfo().then(setServer).catch(() => {})
    // /help#upi, #kitty… open that question
    const id = window.location.hash.slice(1)
    if (!id) return
    const idx = FAQ.findIndex((f) => f.id === id)
    if (idx >= 0) setOpen(idx)
    if (id === 'licenses') setLicenses(true)
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250)
  }, [])

  return (
    <div className="screen help">
      <TopBar back={true} title={T('Help', 'Madad')} right={<ThemeToggle />} />

      <motion.section className="help__hero stk stk--sats" initial={{ rotate: -2, y: 10, opacity: 0 }} animate={{ rotate: -0.8, y: 0, opacity: 1 }}>
        <Emoji char="🤝" size={72} />
        <div>
          <h1>{T('Split it. Get it back. Stay friends.', 'Split kar. Wapas le. Dosti bacha.')}</h1>
          <p>{T('Four steps, and the app does the maths.', 'Chaar steps, hisaab app karega.')}</p>
        </div>
      </motion.section>

      <ol className="howto-steps">
        {STEPS.map((s, i) => (
          <motion.li key={s.emoji} className="stk" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0, transition: { delay: 0.06 * i } }}>
            <span className="howto-steps__n">{i + 1}</span>
            <Emoji char={s.emoji} size={40} />
            <div>
              <b>{T(s.en[0], s.hi[0])}</b>
              <p>{T(s.en[1], s.hi[1])}</p>
            </div>
          </motion.li>
        ))}
      </ol>
      {user ? (
        <Press tone="ink" size="lg" block onClick={() => nav('/g/new')}>
          {T('Make a group now', 'Abhi group bana')} →
        </Press>
      ) : (
        <Press tone="ink" size="lg" block onClick={() => nav('/welcome')}>
          {T('Get started, it’s free', 'Shuru kar, free hai')} →
        </Press>
      )}

      <Section title={T('Questions', 'Sawaal')}>
        <ul className="faq stk">
          {FAQ.map((f, i) => (
            <Item key={i} f={f} open={open === i} onToggle={() => (sfx.tap(), setOpen(open === i ? null : i))} />
          ))}
        </ul>
      </Section>

      <Section title={T('About', 'About')} id="about">
        <div className="about stk stk--lav">
          <Wordmark />
          <p>
            {T(
              `Hi, I’m ${MAKER}. I built Bhai Paise De because every trip ended with a spreadsheet and three awkward “bhai, paise?” messages. It’s free, there are no ads, and it never touches your money.`,
              `Hi, main ${MAKER}. Bhai Paise De isliye banaya kyunki har trip ek spreadsheet aur teen awkward “bhai, paise?” messages pe khatam hoti thi. Ye free hai, koi ads nahi, aur ye tere paise kabhi nahi chhoota.`,
            )}
          </p>
          {server?.tip && (
            <Press tone="sats" block onClick={() => setTip(true)}>
              ☕ {T(`Support ${MAKER}`, `${MAKER} ko support kar`)}
            </Press>
          )}
        </div>
      </Section>

      <section className="help__sec" id="licenses">
        <button type="button" className="linkish center" onClick={() => setLicenses((v) => !v)}>
          {licenses ? T('Hide open-source licenses', 'Open-source licenses chhupa') : T('Open-source licenses', 'Open-source licenses')}
        </button>
        {licenses && (
          <ul className="licenses fine">
            <li>Animated emoji: Noto Emoji Animation by Google, CC BY 4.0.</li>
            <li>Fonts: Bricolage Grotesque and Kalam, SIL Open Font License 1.1.</li>
            <li>React, React Router, Framer Motion, Express, canvas-confetti, qrcode, jsQR, sharp, web-push: MIT or Apache 2.0.</li>
            <li>@noble and @scure cryptography, nostr-tools: MIT.</li>
          </ul>
        )}
        <p className="fine center">
          © 2026 {MAKER_FULL}. Bhai Paise De™ is a trademark of {MAKER_FULL}.
        </p>
      </section>
      <TipSheet open={tip} onClose={() => setTip(false)} />
    </div>
  )
}
