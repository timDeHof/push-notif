export const demoHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Push Notifications Demo</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; display: flex; justify-content: center; padding: 2rem 1rem; min-height: 100vh; }
  .card { background: #1e293b; border-radius: 12px; padding: 2rem; width: 100%; max-width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,.3); }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  .sub { color: #94a3b8; font-size: .875rem; margin-bottom: 1.5rem; }
  .status-grid { display: grid; gap: .75rem; margin-bottom: 1.5rem; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: .75rem; background: #0f172a; border-radius: 8px; font-size: .875rem; }
  .label { color: #94a3b8; }
  .badge { padding: 2px 8px; border-radius: 4px; font-size: .75rem; font-weight: 600; }
  .badge.ok { background: #166534; color: #86efac; }
  .badge.warn { background: #854d0e; color: #fde68a; }
  .badge.err { background: #7f1d1d; color: #fca5a5; }
  .badge.neutral { background: #334155; color: #94a3b8; }
  .btn { width: 100%; padding: .75rem; border: none; border-radius: 8px; font-size: .875rem; font-weight: 600; cursor: pointer; transition: opacity .2s; margin-bottom: .5rem; }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .btn.primary { background: #3b82f6; color: #fff; }
  .btn.danger { background: #dc2626; color: #fff; }
  .btn.outline { background: transparent; border: 1px solid #334155; color: #94a3b8; }
  .btn.outline:hover:not(:disabled) { border-color: #475569; color: #e2e8f0; }
  .token-input { width: 100%; padding: .5rem .75rem; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: .75rem; margin-bottom: .75rem; font-family: monospace; }
  .token-input:focus { outline: none; border-color: #3b82f6; }
.log { background: #0f172a; border-radius: 8px; padding: .75rem; font-size: .75rem; font-family: monospace; max-height: 150px; overflow-y: auto; margin-top: 1rem; }
.log p { margin-bottom: .25rem; }
.log p:last-child { margin-bottom: 0; }
.log .ts { color: #475569; }
.toast-container { position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 999; display: flex; flex-direction: column; gap: .5rem; pointer-events: none; width: 90%; max-width: 420px; }
.toast { pointer-events: auto; background: #1e293b; border: 1px solid #3b82f6; border-radius: 10px; padding: .75rem 1rem; box-shadow: 0 8px 32px rgba(0,0,0,.5); animation: slideIn .3s ease-out; }
.toast h3 { font-size: .875rem; margin-bottom: .25rem; color: #e2e8f0; }
.toast p { font-size: .8rem; color: #94a3b8; }
.toast .close { float: right; background: none; border: none; color: #64748b; cursor: pointer; font-size: 1.1rem; line-height: 1; padding: 0 0 0 .5rem; }
@keyframes slideIn { from { opacity: 0; transform: translateY(-1rem); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<div class="card">
  <h1>Push Notifications</h1>
  <p class="sub">Demo client for the push notification service</p>

  <div class="status-grid">
    <div class="row">
      <span class="label">Service Worker</span>
      <span id="sw-status" class="badge neutral">—</span>
    </div>
    <div class="row">
      <span class="label">Permission</span>
      <span id="permission-status" class="badge neutral">—</span>
    </div>
    <div class="row">
      <span class="label">Subscription</span>
      <span id="sub-status" class="badge neutral">—</span>
    </div>
    <div class="row">
      <span class="label">Platform</span>
      <span id="platform-status" class="badge neutral">detecting…</span>
    </div>
  </div>

  <input id="token-input" class="token-input" type="text" placeholder="Paste your JWT token here..." autocomplete="off">

  <div id="platform-note" style="display:none; font-size:.8rem; color:#fde68a; background:#422006; border:1px solid #854d0e; border-radius:8px; padding:.75rem; margin-bottom:.75rem; line-height:1.4;"></div>
  <div id="denied-note" style="display:none; font-size:.8rem; color:#fca5a5; background:#7f1d1d33; border:1px solid #7f1d1d; border-radius:8px; padding:.75rem; margin-bottom:.75rem; line-height:1.4;"></div>

  <button id="btn-subscribe" class="btn primary" disabled>Enable Notifications</button>
  <button id="btn-unsubscribe" class="btn danger" disabled>Disable Notifications</button>
  <button id="btn-token" class="btn outline">Use Token</button>
  <button id="btn-demo-token" class="btn outline">Get Demo Token</button>

  <hr style="border: none; border-top: 1px solid #334155; margin: 1.5rem 0;">

  <h2 style="font-size: 1rem; margin-bottom: .75rem;">Send Test Notification</h2>
  <p style="color:#94a3b8; font-size:.8rem; margin-bottom:.75rem;">Send a test notification to your own device. Pick a scenario and an attendee.</p>

  <select id="scenario-select" style="width:100%; padding:.5rem .75rem; background:#0f172a; border:1px solid #334155; border-radius:8px; color:#e2e8f0; font-size:.8rem; margin-bottom:.5rem;">
    <option value="new-attendee">New attendee signed up</option>
    <option value="event-updated">Host updated event details</option>
    <option value="event-canceled">Event was canceled</option>
    <option value="custom">Custom message</option>
  </select>

  <select id="attendee-select" style="width:100%; padding:.5rem .75rem; background:#0f172a; border:1px solid #334155; border-radius:8px; color:#e2e8f0; font-size:.8rem; margin-bottom:.5rem;">
    <option value="Alex Rivera">Alex Rivera</option>
    <option value="Jordan Kim">Jordan Kim</option>
    <option value="Sam Patel">Sam Patel</option>
    <option value="Taylor Chen">Taylor Chen</option>
    <option value="Morgan Smith">Morgan Smith</option>
    <option value="Casey Johnson" selected>Casey Johnson</option>
    <option value="Riley Williams">Riley Williams</option>
    <option value="Avery Brown">Avery Brown</option>
    <option value="Drew Thompson">Drew Thompson</option>
    <option value="Quinn Garcia">Quinn Garcia</option>
    <option value="Blake Murphy">Blake Murphy</option>
  </select>

  <input id="event-input" class="token-input" type="text" placeholder="Event name (e.g. Jazz Night)" value="Jazz Night" style="margin-bottom:.5rem;">

  <button id="btn-send-test" class="btn primary">Send Test Notification</button>

  <div id="send-result" style="font-size:.8rem; margin-top:.5rem; color:#94a3b8;"></div>

  <hr style="border: none; border-top: 1px solid #334155; margin: 1.5rem 0;">

  <h2 style="font-size: 1rem; margin-bottom: .75rem;">Test Event Reminder</h2>
  <p style="color:#94a3b8; font-size:.8rem; margin-bottom:.75rem;">Create an event starting soon, join it, and trigger the "starts in 5 minutes" reminder.</p>

  <input id="event-title-input" class="token-input" type="text" placeholder="Event title" value="Live Jam Session" style="margin-bottom:.5rem;">
  <input id="event-time-input" class="token-input" type="text" placeholder="Start time (ISO, e.g. 2026-06-15T01:00:00Z)" style="margin-bottom:.5rem; font-size:.7rem;">
  <button id="btn-create-event" class="btn primary">Create Event</button>
  <div id="event-result" style="font-size:.8rem; margin-top:.5rem; color:#94a3b8;"></div>

  <button id="btn-check-events" class="btn outline" style="margin-top:.5rem;">⏰ Check Starting Soon Now</button>
  <div id="check-result" style="font-size:.8rem; margin-top:.5rem; color:#94a3b8;"></div>

  <div class="log" id="log"></div>
</div>

<div class="toast-container" id="toast-container"></div>

<script src="/push-client.js"></script>
<script>
function log(msg) {
  const el = document.getElementById('log')
  const p = document.createElement('p')
  const ts = new Date().toLocaleTimeString()
  p.innerHTML = '<span class="ts">[' + ts + ']</span> ' + msg
  el.appendChild(p)
  el.scrollTop = el.scrollHeight
}

function getToken() { return document.getElementById('token-input').value.trim() }

async function setMetaToken(token) {
  let meta = document.querySelector('meta[name="token"]')
  if (!meta) { meta = document.createElement('meta'); meta.name = 'token'; document.head.appendChild(meta) }
  meta.content = token
}

function updateBadge(id, text, cls) {
  const el = document.getElementById(id)
  el.textContent = text
  el.className = 'badge ' + cls
}

function getPlatformNote() {
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua)
  if (isIos && isSafari) return 'ios-safari'
  if (isIos) return 'ios-other'
  return 'other'
}

function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches }

async function refreshStatus() {
  if (!('serviceWorker' in navigator)) {
    updateBadge('sw-status', 'unavailable', 'err')
    return
  }
  try {
    const reg = await navigator.serviceWorker.ready
    updateBadge('sw-status', 'registered', 'ok')
    updateBadge('permission-status', Notification.permission, Notification.permission === 'granted' ? 'ok' : Notification.permission === 'denied' ? 'err' : 'warn')

    const platform = getPlatformNote()
    updateBadge('platform-status', platform === 'ios-safari' ? 'iOS Safari' : platform === 'ios-other' ? 'iOS' : 'other', 
      platform === 'ios-safari' && !isStandalone() ? 'warn' : 'ok')
    const note = document.getElementById('platform-note')
    if (platform === 'ios-safari' && !isStandalone()) {
      note.innerHTML = '⚠️ iOS Safari requires adding this page to your <strong>Home Screen</strong> (Share → Add to Home Screen) before notifications work.'
      note.style.display = 'block'
    } else if (platform === 'ios-safari' && isStandalone()) {
      note.style.display = 'none'
    } else {
      note.style.display = 'none'
    }

    const deniedNote = document.getElementById('denied-note')
    if (Notification.permission === 'denied') {
      deniedNote.innerHTML = '🔕 Notifications are <strong>blocked</strong> in your browser. Tap the padlock icon in the URL bar → <strong>Site settings</strong> → Notifications → <strong>Allow</strong>, then reload.'
      deniedNote.style.display = 'block'
    } else {
      deniedNote.style.display = 'none'
    }

    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      updateBadge('sub-status', 'subscribed', 'ok')
      document.getElementById('btn-subscribe').disabled = true
      document.getElementById('btn-unsubscribe').disabled = false
    } else {
      updateBadge('sub-status', 'not subscribed', 'warn')
      document.getElementById('btn-subscribe').disabled = Notification.permission === 'denied' || (platform === 'ios-safari' && !isStandalone())
      document.getElementById('btn-unsubscribe').disabled = true
    }
  } catch (err) {
    updateBadge('sw-status', 'error: ' + err.message, 'err')
  }
}

document.getElementById('btn-demo-token').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/demo/token', { method: 'POST' })
    const data = await res.json()
    document.getElementById('token-input').value = data.token
    localStorage.setItem('demo_token', data.token)
    await setMetaToken(data.token)
    log('demo token generated: ' + data.userId)
    await refreshStatus()
  } catch (err) {
    log('failed to get demo token: ' + err.message)
  }
})

document.getElementById('btn-token').addEventListener('click', async () => {
  const token = getToken()
  if (!token) { log('enter a JWT token first'); return }
  await setMetaToken(token)
  log('token set')
})

document.getElementById('btn-subscribe').addEventListener('click', async () => {
  if (!getToken()) { log('enter a JWT token first'); return }
  await setMetaToken(getToken())
  log('requesting notification permission...')
  const perm = await Notification.requestPermission()
  if (perm === 'granted') {
    log('permission granted')
    if (window.__push) {
      await window.__push.onSubscribeClick()
      log('subscribed!')
    }
    await refreshStatus()
  } else {
    log('permission denied')
    await refreshStatus()
  }
})

document.getElementById('btn-unsubscribe').addEventListener('click', async () => {
  if (window.__push) {
    await window.__push.onUnsubscribeClick()
    log('unsubscribed')
  }
  await refreshStatus()
})

function showToast(data) {
  const container = document.getElementById('toast-container')
  const el = document.createElement('div')
  el.className = 'toast'
  el.innerHTML = '<button class="close" onclick="this.parentElement.remove()">×</button><h3>' + (data.title || 'Notification') + '</h3><p>' + (data.body || '') + '</p>'
  container.appendChild(el)
  setTimeout(() => { el.remove() }, 8000)
}

async function init() {
  if (!('serviceWorker' in navigator)) {
    log('service workers not supported')
    updateBadge('sw-status', 'unsupported', 'err')
    return
  }
  log('registering service worker...')
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    log('SW registered: ' + reg.scope)
    await navigator.serviceWorker.ready
  } catch (err) {
    log('SW registration failed: ' + err.message)
  }

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'push-toast') {
      showToast(event.data.data)
    }
  })

  const stored = localStorage.getItem('demo_token')
  if (stored) {
    document.getElementById('token-input').value = stored
    await setMetaToken(stored)
    log('token restored from storage')
  }

  const defaultTime = new Date(Date.now() + 5 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
  document.getElementById('event-time-input').value = defaultTime
  log('time preset to ' + defaultTime.slice(0, 19) + 'Z')

  document.getElementById('token-input').addEventListener('input', (e) => {
    localStorage.setItem('demo_token', e.target.value)
  })

  await refreshStatus()
  log('ready')
}

document.getElementById('btn-send-test').addEventListener('click', async () => {
  const token = getToken()
  if (!token) { log('enter a JWT token first'); return }

  const scenario = document.getElementById('scenario-select').value
  const name = document.getElementById('attendee-select').value
  const event = document.getElementById('event-input').value.trim() || 'an event'
  const btn = document.getElementById('btn-send-test')
  const result = document.getElementById('send-result')

  let title, text, tag
  if (scenario === 'new-attendee') {
    title = 'New attendee!'
    text = name + ' just signed up for ' + event
    tag = 'event-' + Date.now()
  } else if (scenario === 'event-updated') {
    title = 'Event updated'
    text = 'The host changed the details for ' + event
    tag = 'event-' + event.toLowerCase().replace(/\s+/g, '-')
  } else if (scenario === 'event-canceled') {
    title = 'Event canceled'
    text = event + ' has been canceled'
    tag = 'event-' + event.toLowerCase().replace(/\s+/g, '-')
  } else {
    title = prompt('Notification title:', 'Update from the host') || 'Update'
    text = prompt('Notification body:', 'Something changed with ' + event) || ''
    tag = 'custom-' + Date.now()
  }

  btn.disabled = true
  btn.textContent = 'Sending...'
  result.textContent = ''

  try {
    const res = await fetch('/api/demo/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        title,
        text,
        url: '/events/' + encodeURIComponent(event.toLowerCase().replace(/\s+/g, '-')),
        tag,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      result.style.color = '#86efac'
      result.textContent = 'Notification sent! Check your device.'
      log('sent: ' + title + ' — ' + text)
    } else {
      result.style.color = '#fca5a5'
      result.textContent = data.error || 'failed'
      log('send failed: ' + (data.error || res.status))
    }
  } catch (err) {
    result.style.color = '#fca5a5'
    result.textContent = err.message
    log('send error: ' + err.message)
  } finally {
    btn.disabled = false
    btn.textContent = 'Send Test Notification'
  }
})

document.getElementById('btn-create-event').addEventListener('click', async () => {
  const token = getToken()
  if (!token) { log('enter a JWT token first'); return }

  const title = document.getElementById('event-title-input').value.trim()
  const startTime = document.getElementById('event-time-input').value.trim()
  const btn = document.getElementById('btn-create-event')
  const result = document.getElementById('event-result')

  if (!title) { result.textContent = 'enter an event title'; return }
  if (!startTime) { result.textContent = 'enter a start time'; return }

  btn.disabled = true
  btn.textContent = 'Creating...'
  result.textContent = ''

  try {
    const res = await fetch('/api/demo/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ title, startTime }),
    })
    const data = await res.json()
    if (res.ok) {
      result.style.color = '#86efac'
      result.textContent = 'Event created! ID: ' + data.id
      log('created event: ' + data.title + ' (id=' + data.id + ') starting ' + startTime)

      const joinRes = await fetch('/api/demo/events/' + data.id + '/join', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
      })
      if (joinRes.ok) {
        result.textContent += ' — joined!'
        log('joined event ' + data.id + ' as attendee')
      }
    } else {
      result.style.color = '#fca5a5'
      result.textContent = data.error || 'failed'
    }
  } catch (err) {
    result.style.color = '#fca5a5'
    result.textContent = err.message
  } finally {
    btn.disabled = false
    btn.textContent = 'Create Event'
  }
})

document.getElementById('btn-check-events').addEventListener('click', async () => {
  const token = getToken()
  if (!token) { log('enter a JWT token first'); return }

  const btn = document.getElementById('btn-check-events')
  const result = document.getElementById('check-result')

  btn.disabled = true
  btn.textContent = 'Checking...'
  result.textContent = ''

  try {
    const res = await fetch('/api/demo/check-events', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
    })
    if (res.ok) {
      result.style.color = '#86efac'
      result.textContent = 'Checked! If any events start in 5 min, you should get a notification.'
      log('ran starting-soon check')
    } else {
      const data = await res.json()
      result.style.color = '#fca5a5'
      result.textContent = data.error || 'failed'
    }
  } catch (err) {
    result.style.color = '#fca5a5'
    result.textContent = err.message
  } finally {
    btn.disabled = false
    btn.textContent = '⏰ Check Starting Soon Now'
  }
})

init()
</script>
</body>
</html>`.trim()
