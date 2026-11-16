import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useT } from '../lib/i18n'
import { QR, Wordmark } from './bits'

/** On a laptop, the app sits in a phone-width column; this poster fills the rest. */
export function DesktopPoster() {
  const T = useT()
  const url = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <aside className="poster" aria-label="About">
      <motion.div className="poster__inner" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 24 }}>
        <Wordmark />
        <p className="poster__lede">{T('Split bills with friends. Get paid back by UPI in a tap.', 'Dosto ke saath bill split kar. UPI se ek tap mein paise wapas.')}</p>
        <ul className="poster__notes">
          <li className="stk tilt-l">
            <b>{T('Only you need the app', 'App sirf tujhe chahiye')}</b>
            {T('Friends get a link. It opens their UPI app with the exact amount filled in. No signup for them.', 'Dosto ko link milta hai. Unka UPI app exact amount ke saath khulta hai. Unka signup nahi.')}
          </li>
          <li className="stk tilt-r">
            <b>{T('They pay, you tap “Got it”', 'Woh dete hain, tu “Mil gaya”')}</b>
            {T('Settled for everyone, with a receipt in the group chat.', 'Sabke liye settle, group chat mein receipt.')}
          </li>
          <li className="stk tilt-l">
            <b>{T('Chat, kitty, statements', 'Chat, kitty, statements')}</b>
            {T('A chat in every group, a shared pot for trips and rent, and a PDF statement when it’s over.', 'Har group mein chat, trip aur rent ke liye pot, aur end mein PDF statement.')}
          </li>
        </ul>
        <div className="poster__qr stk">
          <QR text={url} size={112} />
          <span>{T('Better on your phone. Scan, then add it to your home screen.', 'Phone pe aur maza. Scan kar, home screen pe daal.')}</span>
        </div>
        <nav className="poster__links">
          <Link to="/about">{T('About', 'Ye kya hai')}</Link>
          <Link to="/help">{T('How it works', 'Kaise kaam karta hai')}</Link>
          <Link to="/help#safety">{T('Privacy & safety', 'Privacy & safety')}</Link>
        </nav>
      </motion.div>
    </aside>
  )
}
