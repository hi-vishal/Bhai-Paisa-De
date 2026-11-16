import { AnimatePresence, motion } from 'framer-motion'
import type { Transfer } from '@shared/balances'
import type { CurrencyCode } from '@shared/money'
import { money, firstName } from '../lib/format'
import type { Member } from '../lib/types'
import { Avatar } from './Avatar'

const S = 320 // viewBox size
const R = 118 // ring radius

/**
 * Who-owes-whom as a little map: people sit on a ring, money flows along arrows.
 * Flip "simplify" and watch the tangle collapse into fewer arrows.
 */
export function DebtGraph({ members, plan, currency }: { members: Member[]; plan: Transfer[]; currency: CurrencyCode }) {
  const n = members.length
  const pos = new Map(
    members.map((m, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2
      return [m.id, { x: S / 2 + R * Math.cos(a), y: S / 2 + R * Math.sin(a) }]
    }),
  )
  const max = Math.max(1, ...plan.map((t) => t.amount))
  const avatar = n > 8 ? 34 : 44

  return (
    <div className="graph" style={{ aspectRatio: '1 / 1' }}>
      <svg viewBox={`0 0 ${S} ${S}`} className="graph__svg" aria-hidden>
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="14" markerHeight="14" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#000" stroke="#000" strokeWidth="1" strokeLinejoin="round" />
          </marker>
        </defs>
        <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="2" strokeDasharray="4 8" />
        <AnimatePresence>
          {plan.map((t) => {
            const a = pos.get(t.from)
            const b = pos.get(t.to)
            if (!a || !b) return null
            const dx = b.x - a.x
            const dy = b.y - a.y
            const len = Math.hypot(dx, dy) || 1
            const ux = dx / len
            const uy = dy / len
            const pad = avatar / 2 + 8
            const x1 = a.x + ux * pad
            const y1 = a.y + uy * pad
            const x2 = b.x - ux * (pad + 4)
            const y2 = b.y - uy * (pad + 4)
            const bend = 26
            const cx = (x1 + x2) / 2 - uy * bend
            const cy = (y1 + y2) / 2 + ux * bend
            const w = 2.5 + (t.amount / max) * 4.5
            const d = `M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`
            return (
              <motion.g key={`${t.from}>${t.to}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.6 }} style={{ transformOrigin: `${cx}px ${cy}px` }}>
                <motion.path d={d} fill="none" stroke="#000" strokeWidth={w + 3} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: 'easeOut' }} />
                <motion.path
                  d={d}
                  fill="none"
                  stroke="#FFC21A"
                  strokeWidth={w}
                  strokeLinecap="round"
                  className="graph__flow"
                  markerEnd="url(#arrowhead)"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                <foreignObject x={cx - 46} y={cy - 13} width="92" height="26">
                  <div className="graph__amt">{money(t.amount, currency)}</div>
                </foreignObject>
              </motion.g>
            )
          })}
        </AnimatePresence>
      </svg>
      {members.map((m) => {
        const p = pos.get(m.id)!
        return (
          <div key={m.id} className={`graph__node${m.isMe ? ' is-me' : ''}`} style={{ left: `${(p.x / S) * 100}%`, top: `${(p.y / S) * 100}%` }}>
            <Avatar name={m.name} size={avatar} ghost={!m.joined} />
            <span>{m.isMe ? 'you' : firstName(m.name)}</span>
          </div>
        )
      })}
    </div>
  )
}
