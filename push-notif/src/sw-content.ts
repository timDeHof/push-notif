export const swJs = `
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Notification', {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      data: data.data,
      tag: data.tag,
    }).then(() => {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    }).then((clients) => {
      for (const client of clients) {
        client.postMessage({ type: 'push-toast', data })
      }
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const matching = windowClients.find((c) => c.url === url)
      if (matching) {
        return matching.focus()
      }
      return clients.openWindow(url)
    }),
  )
})

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})
`.trimStart()
