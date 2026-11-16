import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { sfx } from '../lib/sound'

/** Bottom sheet. Grab the handle (or anywhere on top) and fling it down to close. */
export function Sheet({ open, onClose, title, children, tone = 'paper' }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; tone?: string }) {
  const drag = useDragControls()
  useEffect(() => {
    if (!open) return
    sfx.whoosh()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="sheet-root" role="dialog" aria-modal="true">
          <motion.div className="sheet-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className={`sheet sheet--${tone}`}
            initial={{ y: '105%', rotate: 2 }}
            animate={{ y: 0, rotate: 0 }}
            exit={{ y: '110%', rotate: -1.5 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.8 }}
            onDragEnd={(_, i) => (i.offset.y > 110 || i.velocity.y > 600) && onClose()}
          >
            <div className="sheet__grab" onPointerDown={(e) => drag.start(e)}>
              <span className="sheet__handle" />
              {title && <h2 className="sheet__title">{title}</h2>}
            </div>
            <div className="sheet__body">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
