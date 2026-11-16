import { useEffect, useRef, useState } from 'react'
import { api, upload } from '../lib/api'
import { errText, useLang } from '../lib/i18n'
import { cropSquare, loadImage } from '../lib/image'
import { useSession } from '../lib/session'
import { sfx } from '../lib/sound'
import type { User } from '../lib/types'
import { Press } from './Press'
import { Sheet } from './Sheet'
import { useToast } from './Toast'

const VIEW = 240

/** Pick a photo, drag and zoom it into the circle, save. */
export function PhotoSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { T, lang } = useLang()
  const { user, setUser } = useSession()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setImg(null)
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [open])

  const pick = async (f: File | undefined) => {
    if (!f) return
    try {
      setImg(await loadImage(f))
      setZoom(1)
      setPan({ x: 0, y: 0 })
      sfx.pop()
    } catch {
      toast(T('That file isn’t a photo', 'Ye photo nahi hai'), { tone: 'owe' })
    }
  }

  const side = img ? Math.min(img.naturalWidth, img.naturalHeight) / zoom : 1
  const s = VIEW / side
  const spareX = img ? img.naturalWidth - side : 0
  const spareY = img ? img.naturalHeight - side : 0
  const sx = spareX / 2 + (pan.x * spareX) / 2
  const sy = spareY / 2 + (pan.y * spareY) / 2

  const save = async () => {
    if (!img) return
    setBusy(true)
    try {
      const blob = await cropSquare(img, 512, zoom, pan.x, pan.y)
      const r = await upload<{ user: User }>('/me/avatar', blob)
      setUser(r.user)
      sfx.success()
      toast(T('Looking good', 'Mast lag raha hai'), { tone: 'get', emoji: '📸', silent: true })
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const r = await api<{ user: User }>('/me/avatar', { method: 'DELETE' })
      setUser(r.user)
      sfx.unpop()
      onClose()
    } catch (e) {
      toast(errText(e, lang), { tone: 'owe' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={T('Profile photo', 'Profile photo')}>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
      {img ? (
        <>
          <div
            className="cropper"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
              drag.current = { x: e.clientX, y: e.clientY }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return
              const dx = e.clientX - drag.current.x
              const dy = e.clientY - drag.current.y
              drag.current = { x: e.clientX, y: e.clientY }
              const clamp = (v: number) => Math.max(-1, Math.min(1, v))
              setPan((p) => ({ x: spareX ? clamp(p.x - dx / ((spareX * s) / 2)) : 0, y: spareY ? clamp(p.y - dy / ((spareY * s) / 2)) : 0 }))
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <img src={img.src} alt="" draggable={false} style={{ width: img.naturalWidth * s, height: img.naturalHeight * s, transform: `translate(${-sx * s}px, ${-sy * s}px)` }} />
          </div>
          <label className="cropper__zoom">
            <span aria-hidden>🔍</span>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label={T('Zoom', 'Zoom')} />
          </label>
          <p className="fine center">{T('Drag to move, slide to zoom.', 'Drag karke set kar, slide karke zoom.')}</p>
          <div className="share-row">
            <Press tone="paper" onClick={() => input.current?.click()}>
              {T('Another', 'Doosri')}
            </Press>
            <Press tone="sats" loading={busy} onClick={save}>
              {T('Use this photo', 'Ye photo laga')}
            </Press>
          </div>
        </>
      ) : (
        <div className="stack">
          <p className="muted">{T('Friends see it in groups, on pay links and in chat.', 'Dost isse groups, pay links aur chat mein dekhenge.')}</p>
          <Press tone="sats" size="lg" block onClick={() => input.current?.click()}>
            📸 {T('Choose a photo', 'Photo chun')}
          </Press>
          {user?.avatar && (
            <Press tone="paper" block loading={busy} onClick={remove}>
              {T('Remove my photo', 'Meri photo hata')}
            </Press>
          )}
        </div>
      )}
    </Sheet>
  )
}
