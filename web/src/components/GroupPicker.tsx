import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useT } from '../lib/i18n'
import { sfx } from '../lib/sound'
import type { GroupSummary } from '../lib/types'
import { useResource } from '../lib/useResource'
import { useSession } from '../lib/session'
import { Press } from './Press'
import { Sheet } from './Sheet'

/** The big + on Home: which group did you spend in? */
export function GroupPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const T = useT()
  const nav = useNavigate()
  const { user } = useSession()
  const { data } = useResource(open && user ? 'groups' : null, () => api<{ groups: GroupSummary[] }>('/groups'))
  const go = (path: string) => {
    onClose()
    nav(path)
  }
  return (
    <Sheet open={open} onClose={onClose} title={T('Which group?', 'Kis group mein kharcha?')}>
      <div className="picker">
        {data?.groups.map((g, i) => (
          <motion.button
            key={g.id}
            className="picker__row stk"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}
            whileTap={{ x: 3, y: 3, boxShadow: '0 0 0 #000' }}
            onClick={() => {
              sfx.tap()
              go(`/g/${g.id}/add`)
            }}
          >
            <span className="picker__emoji">{g.emoji}</span>
            <span className="picker__name">{g.name}</span>
            <span className="picker__go" aria-hidden>
              ＋
            </span>
          </motion.button>
        ))}
      </div>
      <Press tone="lav" block onClick={() => go('/g/new')}>
        {T('Start a new group', 'Naya group bana')}
      </Press>
    </Sheet>
  )
}
