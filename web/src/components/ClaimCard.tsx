import { motion } from 'framer-motion'
import { useState } from 'react'
import type { CurrencyCode } from '@shared/money'
import { api } from '../lib/api'
import { ago, firstName, money } from '../lib/format'
import { errText, useLang } from '../lib/i18n'
import { useSession } from '../lib/session'
import { haptic, sfx } from '../lib/sound'
import type { Claim, GroupFull } from '../lib/types'
import { confirmBody } from '../lib/writes'
import { Avatar } from './Avatar'
import { blast } from './bits'
import { Press } from './Press'
import { useToast } from './Toast'

type Who = { id: string; name: string; avatar: string | null }

export const methodName = (m: string, T: (en: string, hi: string) => string) =>
  ({ upi: 'UPI', cash: T('cash', 'cash'), bank: T('bank transfer', 'bank transfer'), other: '', kitty: T('for the kitty', 'kitty ke liye'), manual: '' })[m] ?? ''

/** A payment someone says they made. The payee confirms or says not yet; the payer can take it back. */
export function ClaimCard({ claim, from, to, groupId, meId, currency, onChange }: { claim: Claim; from: Who; to: Who; groupId: string; meId: string; currency: CurrencyCode; onChange: (g: GroupFull) => void }) {
  const { T, lang } = useLang()
  const { user } = useSession()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const iGet = claim.to === meId
  const iPaid = claim.from === meId
  const how = methodName(claim.method, T)

  const act = async (what: 'confirm' | 'reject' | 'cancel') => {
    setBusy(what)
    try {
      const body = what === 'confirm' ? await confirmBody(user!, groupId, meId, claim) : {}
      const g = await api<GroupFull>(`/groups/${groupId}/claims/${claim.id}/${what}`, { body })
      if (what === 'confirm') {
        sfx.chaching()
        haptic([20, 60, 30])
        blast('money')
        toast(
          claim.method === 'kitty'
            ? T(`${money(claim.amount, currency)} in the kitty`, `Kitty mein ${money(claim.amount, currency)}`)
            : T(`Settled ${money(claim.amount, currency)} with ${firstName(from.name)}`, `${firstName(from.name)} ke saath ${money(claim.amount, currency)} settle`),
          { tone: 'get', emoji: claim.method === 'kitty' ? '🏦' : '🤝', silent: true },
        )
      } else sfx.unpop()
      onChange(g)
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <motion.div className={`claim-card stk${iGet ? ' stk--cash' : ''}`} layout initial={{ opacity: 0, y: 10, rotate: -1 }} animate={{ opacity: 1, y: 0, rotate: 0 }}>
      <div className="claim-card__top">
        <Avatar name={from.name} src={from.avatar} size={40} />
        <div className="claim-card__text">
          <b>
            {iGet && claim.method === 'kitty'
              ? T(`${firstName(from.name)} says they put ${money(claim.amount, currency)} in the kitty`, `${firstName(from.name)} bol raha hai kitty mein ${money(claim.amount, currency)} daale`)
              : iGet
              ? T(`${firstName(from.name)} says they paid you ${money(claim.amount, currency)}`, `${firstName(from.name)} bol raha hai ${money(claim.amount, currency)} de diye`)
              : iPaid
                ? T(`Waiting for ${firstName(to.name)} to confirm ${money(claim.amount, currency)}`, `${firstName(to.name)} ke confirm ka wait: ${money(claim.amount, currency)}`)
                : T(`${firstName(from.name)} → ${firstName(to.name)}: ${money(claim.amount, currency)}, waiting`, `${firstName(from.name)} → ${firstName(to.name)}: ${money(claim.amount, currency)}, wait`)}
          </b>
          <small>
            {[claim.method === 'kitty' ? '' : how, claim.ref ? `ref ${claim.ref}` : '', ago(claim.createdAt, lang)].filter(Boolean).join(' · ')}
          </small>
        </div>
      </div>
      {iGet && (
        <div className="share-row">
          <Press tone="get" size="sm" loading={busy === 'confirm'} disabled={!!busy} onClick={() => act('confirm')}>
            ✅ {T('Got it', 'Mil gaya')}
          </Press>
          <Press tone="paper" size="sm" loading={busy === 'reject'} disabled={!!busy} onClick={() => act('reject')}>
            {T('Not yet', 'Abhi nahi aaya')}
          </Press>
        </div>
      )}
      {iPaid && (
        <button type="button" className="linkish" disabled={!!busy} onClick={() => act('cancel')}>
          {T('Take it back', 'Wapas le')}
        </button>
      )}
    </motion.div>
  )
}
