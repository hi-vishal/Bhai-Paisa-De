import { useEffect, useRef, useState } from 'react'
import { useLang } from '../lib/i18n'

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/**
 * Point the camera at a QR. Uses the browser's own BarcodeDetector where there is one (Android
 * Chrome), and a small JS decoder elsewhere (iPhone), loaded only when the camera opens.
 */
export function QrScanner({ onCode }: { onCode: (text: string) => void }) {
  const { T } = useLang()
  const video = useRef<HTMLVideoElement>(null)
  const [err, setErr] = useState<string | null>(null)
  const done = useRef(false)

  useEffect(() => {
    let stream: MediaStream | null = null
    let raf = 0
    let dead = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
      } catch {
        setErr(T('Camera blocked. Allow camera access in your browser settings, or paste the code below.', 'Camera band hai. Browser settings mein allow kar, ya neeche code paste kar.'))
        return
      }
      if (dead) return stream.getTracks().forEach((t) => t.stop())
      const v = video.current!
      v.srcObject = stream
      await v.play().catch(() => {})
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
      const native = Native ? new Native({ formats: ['qr_code'] }) : null
      const jsqr = native ? null : (await import('jsqr')).default
      let busy = false
      const loop = async () => {
        if (dead || done.current) return
        raf = requestAnimationFrame(loop)
        if (busy || v.readyState < 2) return
        busy = true
        try {
          let text: string | null = null
          if (native) text = (await native.detect(v))[0]?.rawValue ?? null
          else if (jsqr) {
            const w = (canvas.width = Math.min(640, v.videoWidth))
            const h = (canvas.height = Math.round((v.videoHeight / v.videoWidth) * w))
            ctx.drawImage(v, 0, 0, w, h)
            text = jsqr(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
          }
          if (text && !done.current) {
            done.current = true
            onCode(text)
          }
        } finally {
          busy = false
        }
      }
      loop()
    }
    void start()
    return () => {
      dead = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="scanner">
      {err ? <p className="callout callout--owe">{err}</p> : <video ref={video} playsInline muted />}
      {!err && <span className="scanner__frame" aria-hidden />}
    </div>
  )
}
