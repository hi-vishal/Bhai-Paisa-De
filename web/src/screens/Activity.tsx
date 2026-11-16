import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { CATEGORIES, isCategory } from '@shared/categories'
import { Empty, Spinner } from '../components/bits'
import { TopBar } from '../components/Chrome'
import { formatBase } from '@shared/money'
import { api } from '../lib/api'
import { ago, firstName, methodIcon, money } from '../lib/format'
import { useLang } from '../lib/i18n'
import { sfx } from '../lib/sound'
import type { ActivityItem } from '../lib/types'
import { useResource } from '../lib/useResource'

export function Activity() {
  const { T, lang } = useLang()
  const nav = useNavigate()
  const { data } = useResource('activity', () => api<{ items: ActivityItem[] }>('/activity'))
  if (!data) return <div className="screen"><TopBar title={T('Activity', 'Activity')} /><Spinner /></div>

  return (
    <div className="screen">
      <TopBar title={T('Activity', 'Activity')} />
      {!data.items.length && <Empty emoji="🦗" title={T('Quiet in here', 'Yahan sannata hai')} body={T('Bills and payments from all your groups show up here.', 'Tere saare groups ke bills aur payments yahan dikhenge.')} />}
      <ol className="feed">
        {data.items.map((it, i) => {
          const isE = it.kind === 'expense'
          const icon = isE ? (it.kitty ? '🏦' : isCategory(it.category) ? CATEGORIES[it.category].emoji : '🧾') : methodIcon(it)
          return (
            <motion.li
              key={it.kind + it.id}
              className={`feed__item feed__item--${isE ? 'e' : it.method}`}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0, transition: { delay: Math.min(i, 12) * 0.03 } }}
            >
              <button
                onClick={() => {
                  sfx.tap()
                  nav(`/g/${it.groupId}`)
                }}
              >
                <span className="feed__icon">{icon}</span>
                <span className="feed__mid">
                  {isE ? (
                    <b className={it.voided ? 'strike' : ''}>
                      {lang === 'hi'
                        ? `${it.paidByMe ? 'Tune' : `${firstName(it.paidBy)} ne`} “${it.description}” ka bill bhara`
                        : `${it.paidByMe ? 'You' : firstName(it.paidBy)} paid for “${it.description}”`}
                    </b>
                  ) : (
                    <b>
                      {it.fromMe ? T('You', 'Tune') : firstName(it.from)} → {it.method === 'kitty' ? T('kitty', 'kitty') : it.toMe ? T('you', 'tujhe') : firstName(it.to)}
                      {it.method === 'manual' && it.note ? <span className="hand"> “{it.note}”</span> : null}
                      {it.method === 'upi' ? <span className="muted"> · UPI</span> : null}
                    </b>
                  )}
                  <small>
                    {it.groupEmoji} {it.groupName} · {ago(it.at, lang)}
                  </small>
                </span>
                <span className="feed__amt">
                  <b>{money(it.amount, it.currency)}</b>
                  {isE && !it.voided && (it.paidByMe ? <small className="pos">+{money(it.amount - it.myShare, it.currency)}</small> : it.myShare > 0 ? <small className="neg">−{money(it.myShare, it.currency)}</small> : null)}
                  {!isE && it.method === 'solana' && it.asset && it.base && <small>{formatBase(BigInt(it.base), it.asset, 4)}</small>}
                </span>
              </button>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}
