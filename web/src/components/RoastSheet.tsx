import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import type { CurrencyCode } from '@shared/money'
import { api } from '../lib/api'
import { copyText, firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { ROAST_LEVELS, roastLine } from '../lib/roast'
import { haptic, sfx } from '../lib/sound'
import { Emoji } from './bits'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

type Props = {
  open: boolean
  onClose: () => void
  groupId: string
  groupName: string
  currency: CurrencyCode
  from: { id: string; name: string }
  to: { id: string; name: string; upi: string | null; isMe: boolean }
  amount: number
}

/** The pay-link sender, with a sarcasm dial. Slide right at your own risk. */
export function RoastSheet({ open, onClose, groupId, groupName, currency, from, to, amount }: Props) {
  const { T, lang } = useLang()
  const toast = useToast()
  const [level, setLevel] = useState(1)
  const [variant, setVariant] = useState(0)
  const [link, setLink] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLink(null)
    api<{ path: string }>(`/groups/${groupId}/paylinks`, { body: { from: from.id, to: to.id } })
      .then((r) => setLink(`${window.location.origin}${r.path}`))
      .catch((e) => toast(errText(e, lang), { tone: 'owe' }))
  }, [open, groupId, from.id, to.id, lang, toast])

  const text = roastLine(level, variant, lang, { name: firstName(from.name), amt: money(amount, currency), what: groupName, link: link ?? '…' })
  const L = ROAST_LEVELS[level]
  const noUpi = !to.upi && currency === 'INR'

  const share = async (how: 'wa' | 'native' | 'copy') => {
    if (!link) return
    sfx.send()
    haptic([8, 40, 8])
    if (how === 'wa') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    else if (how === 'native' && navigator.share) await navigator.share({ text }).catch(() => {})
    else {
      await copyText(text)
      toast(T('Copied. Go paste it.', 'Copy ho gaya. Ja paste kar.'), { tone: 'get', emoji: '📋', silent: true })
    }
    if (level === 4) setTimeout(() => sfx.sad(), 250)
  }

  return (
    <Sheet open={open} onClose={onClose} title={T(`Collect from ${firstName(from.name)}`, `${firstName(from.name)} se vasooli`)}>
      {noUpi && (
        <div className="callout">
          {to.isMe
            ? T('Add your UPI ID in Me, and this link opens their UPI app with everything filled in. Without it they can still say they paid.', 'Main mein apni UPI ID daal, toh ye link unka UPI app sab bhar ke kholega. Uske bina bhi woh "de diya" bata sakte hain.')
            : T(`${firstName(to.name)} hasn’t added a UPI ID, so the link asks them to pay however they like and say so.`, `${firstName(to.name)} ne UPI ID nahi daali, toh link bolega jaise chahe de aur bata de.`)}
        </div>
      )}

      <div className="roast">
        <div className="roast__dial">
          <AnimatePresence mode="popLayout">
            <motion.div key={level} initial={{ scale: 0.3, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.3, rotate: 30, opacity: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 16 }}>
              <Emoji char={L.emoji} size={64} />
            </motion.div>
          </AnimatePresence>
          <div className="roast__label">
            <small>{T('Roast-o-meter', 'Roast-o-meter')}</small>
            <b>{L[lang]}</b>
          </div>
        </div>
        <input
          type="range"
          className={`roast__slider roast__slider--${level}`}
          min={0}
          max={4}
          step={1}
          value={level}
          aria-label="Roast level"
          onChange={(e) => {
            const v = Number(e.target.value)
            setLevel(v)
            sfx.spice(v)
            haptic(v * 6 + 4)
          }}
        />
        <div className="roast__ticks" aria-hidden>
          {ROAST_LEVELS.map((r) => (
            <span key={r.en}>{r.emoji}</span>
          ))}
        </div>

        <motion.div key={`${level}-${variant}-${lang}`} className={`bubble bubble--${level}`} initial={{ scale: 0.92, y: 8, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 20 }}>
          <p>{text}</p>
          <span className="bubble__meta">✓✓</span>
        </motion.div>
        <button
          className="linkish"
          onClick={() => {
            sfx.tap()
            setVariant((v) => v + 1)
          }}
        >
          🎲 {T('Different line', 'Doosri line')}
        </button>
      </div>

      <div className="share-row">
        <Press tone="get" disabled={!link} onClick={() => share('wa')}>
          WhatsApp
        </Press>
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <Press tone="lav" disabled={!link} onClick={() => share('native')}>
            {T('Share', 'Share')}
          </Press>
        )}
        <Press tone="paper" disabled={!link} onClick={() => share('copy')}>
          {T('Copy', 'Copy')}
        </Press>
      </div>
      {link && (
        <a className="linkish center" href={link} target="_blank" rel="noreferrer">
          {T('Preview the pay page', 'Pay page dekh')}
        </a>
      )}
    </Sheet>
  )
}
