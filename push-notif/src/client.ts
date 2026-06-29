export const clientJs = `
const VAPID_PUBLIC_KEY = '__VAPID_PUBLIC_KEY__'

function getToken() {
  const meta = document.querySelector('meta[name="token"]')
  return meta?.getAttribute('content') ?? null
}

async function registerSw() {
  if (!('serviceWorker' in navigator)) return

  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    console.log('SW registered:', reg.scope)

    reg.addEventListener('updatefound', () => {
      const installing = reg.installing
      if (installing) {
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('SW updated')
          }
        })
      }
    })

    return reg
  } catch (err) {
    console.error('SW registration failed:', err)
  }
}

async function subscribePush(reg) {
  if (!reg.pushManager) return

  try {
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY,
    })
    return sub.toJSON()
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      console.log('Push permission denied')
    } else {
      console.error('Push subscribe failed:', err)
    }
  }
}

function authHeaders() {
  const token = getToken()
  if (!token) return {}
  return { Authorization: 'Bearer ' + token }
}

async function sendSubscriptionToServer(sub) {
  const token = getToken()
  if (!token) return

  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(sub),
  })
}

async function sendUnsubscribeToServer() {
  await fetch('/api/push/unsubscribe', {
    method: 'DELETE',
    headers: authHeaders(),
  })
}

async function syncSubscription() {
  if (!('serviceWorker' in navigator)) return

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()

  if (sub) {
    await sendSubscriptionToServer(sub.toJSON())
  }
}

async function onSubscribeClick() {
  if (Notification.permission === 'denied') {
    alert('Notifications are blocked. Enable them in your browser site settings.')
    return
  }

  const reg = await navigator.serviceWorker.ready
  const sub = await subscribePush(reg)
  if (sub) {
    await sendSubscriptionToServer(sub)
  }
}

async function onUnsubscribeClick() {
  if (!('serviceWorker' in navigator)) return

  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()

  if (sub) {
    await sub.unsubscribe()
  }

  await sendUnsubscribeToServer()
}

window.__push = { onSubscribeClick, onUnsubscribeClick, syncSubscription, registerSw }

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    registerSw()
    syncSubscription()
  })
} else {
  registerSw()
  syncSubscription()
}
`.trimStart()
