// Loaded into the generated service worker (workbox importScripts). Shows "X paid you" pushes.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    data = { title: 'Bhai Paise De', body: event.data && event.data.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Bhai Paise De', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || '/' },
      vibrate: [20, 60, 30, 60, 80],
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // only ever open pages of this app
  let url = '/'
  try {
    const u = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin)
    if (u.origin === self.location.origin) url = u.pathname + u.search
  } catch (e) {
    url = '/'
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) {
          w.navigate(url)
          return w.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
