import { api } from './api'

// "Om paid you ₹1,275" on the lock screen. Needs the service worker, so it works in the built
// app (npm run build), on Android/desktop browsers, and on iOS 16.4+ once installed to the home screen.

export type PushState = 'unsupported' | 'denied' | 'on' | 'off'

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64url: string) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 3000))])
  return reg
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  if (!reg) return 'unsupported'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off'
  const reg = await registration()
  if (!reg) return 'unsupported'
  const { publicKey } = await api<{ publicKey: string }>('/push/key', { auth: false })
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }))
  await api('/push/subscribe', { body: sub.toJSON() })
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration()
  const sub = await reg?.pushManager.getSubscription()
  if (sub) {
    await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } }).catch(() => {})
    await sub.unsubscribe()
  }
  return 'off'
}
