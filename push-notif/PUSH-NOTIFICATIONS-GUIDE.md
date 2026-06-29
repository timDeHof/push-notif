# Universal Plan: Push Notifications with Cloudflare Workers + Postgres

A project-agnostic guide for adding push notifications that handle **system notifications** (background, via Service Worker) and **in-app toasts** (foreground, via SW→client messaging).

---

## 1. Architecture Overview

```
App Backend ──→ POST /api/push/send (event-driven, x-api-key)
                     │
Browser ←→ Worker (Hono) ←→ Hyperdrive ←→ Neon Postgres
               ↕                   ↕
            Push Service       Cron (every 5m)
               ↕
         Service Worker → showNotification() (background)
                       → postMessage() → in-app toast (foreground)
```

**Key components:**
- **Worker** — serves the API, SW, client lib, handles cron
- **Postgres (Neon)** — stores subscriptions, events, attendees
- **Hyperdrive** — lets the Worker talk to Postgres with connection pooling
- **VAPID keys** — Web Push auth (EC keypair, JWK format)
- **@pushforge/builder** — Web Push encryption library for Workers

---

## 2. Prerequisites

- Cloudflare account
- Neon (or any Postgres) database
- Node.js project with npm/pnpm

---

## 3. Setup Steps

### 3.1 Scaffold

```bash
npm create cloudflare@latest push-notif -- --template=hello-world
cd push-notif
npm install hono @pushforge/builder postgres
```

Configure `wrangler.jsonc`:

```jsonc
{
  "name": "push-notif",
  "main": "src/index.ts",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],  // required for @pushforge/builder
  "triggers": {
    "crons": ["*/5 * * * *"]  // for timed reminders
  },
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "<hyperdrive-id>" }
  ]
}
```

### 3.2 Generate VAPID Keys

VAPID (Voluntary Application Server Identification) proves your server controls the origin.

```typescript
// scripts/generate-keys.mjs
import crypto from 'node:crypto'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
})

// Public key: uncompressed EC point (0x04 + x + y), base64url-encoded
const rawPub = publicKey.subarray(-65)
const vapidPub = Buffer.from(rawPub).toString('base64url')

// Private key: raw D value as JWK (required by @pushforge/builder)
const rawPriv = privateKey.subarray(-32)
const x = Buffer.from(rawPub.subarray(1, 33)).toString('base64url')
const y = Buffer.from(rawPub.subarray(33)).toString('base64url')
const d = Buffer.from(rawPriv).toString('base64url')
const vapidPriv = JSON.stringify({ kty: 'EC', x, y, crv: 'P-256', d })

console.log('VAPID_PUBLIC_KEY=' + vapidPub)
console.log('VAPID_PRIVATE_KEY=' + vapidPriv)
```

Run it, then store both as Worker secrets:

```bash
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT  # mailto:your-email@example.com
npx wrangler secret put APP_URL        # https://your-app.com
npx wrangler secret put JWT_SECRET     # random 256-bit hex
npx wrangler secret put PUSH_API_KEY   # random hex for /api/push/send
```

Add same values to `.dev.vars` for local dev.

### 3.3 Database Schema (Neon Postgres)

```sql
-- push_subscriptions: stores browser push subscriptions
CREATE TABLE push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_push_user ON push_subscriptions(user_id);

-- events / event_attendees: for timed reminders
CREATE TABLE events (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  host_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_start_time ON events(start_time);

CREATE TABLE event_attendees (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  notify BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX idx_event_attendees_user ON event_attendees(user_id);
```

Connect via Hyperdrive:

```typescript
// src/db.ts
import postgres from 'postgres'

export function getSql(hyperdrive: Hyperdrive) {
  return postgres(hyperdrive.connectionString, { prepare: false })
}
```

### 3.4 JWT Auth Middleware

```typescript
// src/middleware/auth.ts
import { createMiddleware } from 'hono/factory'
import { verify } from 'hono/jwt'

export function authMiddleware() {
  return createMiddleware<{ Bindings: Env; Variables: { userId: string } }>(async (c, next) => {
    const header = c.req.header('Authorization')
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'missing or invalid Authorization header' }, 401)
    }
    try {
      const payload = await verify(header.slice(7), c.env.JWT_SECRET, 'HS256')
      if (typeof payload.sub !== 'string') {
        return c.json({ error: 'invalid token payload' }, 401)
      }
      c.set('userId', payload.sub)
      await next()
    } catch {
      return c.json({ error: 'invalid token' }, 401)
    }
  })
}
```

---

## 4. Database Operations

### 4.1 Subscribe (Upsert)

```typescript
// POST /api/push/subscribe — JWT required
const sql = getSql(env.HYPERDRIVE)
await sql`
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
  VALUES (${userId}, ${endpoint}, ${p256dh}, ${auth})
  ON CONFLICT (endpoint) DO UPDATE SET user_id = ${userId}, p256dh = ${p256dh}, auth = ${auth}
`
```

**Idempotent** — safe to call on every page load. The `endpoint` is unique per browser/device.

### 4.2 Unsubscribe

```typescript
// DELETE /api/push/unsubscribe — JWT required
// Remove all for user:
await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`
// Or remove a specific endpoint:
await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
```

Always return 204 regardless of whether a row was deleted.

### 4.3 Look up subscriptions for sending

```typescript
const rows = await sql`
  SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${targetUserId}
`
```

---

## 5. Sending Push Notifications

### 5.1 Send Function (Web Push via @pushforge/builder)

```typescript
// src/sender.ts
import { buildPushPayload, type PushSubscription } from '@pushforge/builder'

export interface PushPayload {
  title: string
  body?: string
  url?: string
  icon?: string
  badge?: string
  tag?: string
  data?: Record<string, unknown>
}

export async function sendPush(
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload,
  env: Env,
): Promise<{ ok: boolean; fatal?: boolean; error?: string }> {
  try {
    const request = await buildPushPayload({
      subscription: sub as PushSubscription,
      payload: JSON.stringify(payload),
      vapid: {
        subject: env.VAPID_SUBJECT,
        publicKey: env.VAPID_PUBLIC_KEY,
        privateKey: env.VAPID_PRIVATE_KEY,
      },
    })

    const res = await fetch(request.endpoint, request)
    if (res.status === 410) {
      // Subscription expired — clean up
      const sql = postgres(env.HYPERDRIVE.connectionString, { prepare: false })
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`
      await sql.end()
      return { ok: false, fatal: true, error: 'subscription expired' }
    }
    return { ok: res.ok }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
```

Key behavior: **auto-delete on 410 Gone** so stale subscriptions are cleaned up.

### 5.2 Event-Driven Send Endpoint

```typescript
// POST /api/push/send — x-api-key auth
// Used by your app backend to trigger notifications on events
app.post('/api/push/send', async (c) => {
  const apiKey = c.req.header('x-api-key')
  if (!apiKey || apiKey !== c.env.PUSH_API_KEY) {
    return c.json({ error: 'invalid api key' }, 401)
  }

  const { userId, userIds, title, body, url, tag } = await c.req.json()

  const ids: string[] = []
  if (Array.isArray(userIds)) ids.push(...userIds.filter(Boolean))
  if (typeof userId === 'string' && userId) ids.push(userId)
  if (ids.length === 0) return c.json({ error: 'userId or userIds is required' }, 400)

  const sql = getSql(c.env.HYPERDRIVE)
  const rows = await sql`
    SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN ${sql(ids)}
  `
  await sql.end()

  if (rows.length === 0) return c.json({ error: 'no subscriptions for any user' }, 404)

  for (const row of rows) {
    await sendPush(row, { title, body, url, tag }, c.env)
  }
  return c.json({ ok: true, sent: rows.length })
})
```

Accepts:
- `{ "userId": "..." }` — single user (backwards compatible)
- `{ "userIds": ["...", "..."] }` — batch of users
- `{ "userId": "...", "userIds": ["..."] }` — both merged

### 5.3 Cron-Based Reminders

```typescript
// src/cron.ts — runs every 5 minutes via Worker cron trigger
export async function handleCron(env: Env): Promise<void> {
  const sql = getSql(env.HYPERDRIVE)

  const rows = await sql`
    SELECT s.endpoint, s.p256dh, s.auth, ea.user_id,
           e.id AS event_id, e.title AS event_title
    FROM events e
    JOIN event_attendees ea ON ea.event_id = e.id
    JOIN push_subscriptions s ON s.user_id = ea.user_id
    WHERE e.start_time BETWEEN now() AND now() + interval '5 minutes'
      AND ea.notify = true
  `
  await sql.end()

  const sent = new Set()
  for (const row of rows) {
    const key = `${row.event_id}:${row.user_id}`
    if (sent.has(key)) continue
    sent.add(key)

    await sendPush(row, {
      title: 'Starting soon!',
      body: `"${row.event_title}" begins in 5 minutes`,
      url: `/events/${row.event_id}`,
      tag: `event-${row.event_id}-starting`,
    }, env)
  }
}
```

---

## 6. Service Worker (`/sw.js`)

Served dynamically by the Worker. Handles both **system notifications** and **in-app toasts**.

```javascript
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'Notification', {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      data: data.data,
      tag: data.tag,
    }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
     .then((clients) => {
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
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const match = clients.find((c) => c.url === url)
        return match ? match.focus() : clients.openWindow(url)
      }),
  )
})

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(clients.claim()))
```

**Key detail:** The SW posts a message back to all open tabs after showing the system notification. This lets the page display an in-app toast.

---

## 7. Client Library (`/push-client.js`)

Served dynamically by the Worker. Reads JWT from `<meta name="token">`.

```javascript
async function subscribe(reg) {
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: VAPID_PUBLIC_KEY,
  })
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
    body: JSON.stringify(sub.toJSON()),
  })
}

async function unsubscribe() {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await fetch('/api/push/unsubscribe', { method: 'DELETE', headers: authHeaders() })
}

// Auto-sync on page load
navigator.serviceWorker.ready.then(async (reg) => {
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sendSubscriptionToServer(sub.toJSON())
})
```

**Integration into your app:**
1. Set `<meta name="token" content="${userJWT}">` in your HTML
2. Include `<script src="/push-client.js"></script>`
3. Wire toggle to `window.__push.onSubscribeClick()` / `onUnsubscribeClick()`
4. Listen for SW messages to show in-app toasts:

```javascript
navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data?.type === 'push-toast') {
    showInAppToast(event.data.data)
  }
})
```

---

## 8. Notification UX Patterns

### 8.1 Permission Denied State

When `Notification.permission === 'denied'`, show instructions:

```
🔕 Notifications are blocked in your browser.
Tap the padlock icon in the URL bar → Site settings → Notifications → Allow
```

On **iOS Safari**, push notifications only work after adding the site to the Home Screen as a PWA. The page should detect this and show a banner.

### 8.2 In-App Toast vs System Notification

| State | Behavior |
|---|---|
| Browser in background | System notification (notification tray) |
| Page active / foreground | In-app toast only (or both) |
| iOS (not in Home Screen) | Neither — show PWA install banner |

**Toast UI** can be a simple fixed-position element that auto-dismisses after 8 seconds.

### 8.3 Notification Tagging

Use the `tag` field to group/stack notifications:
- Same `tag` → replaces previous notification (good for "5 new attendees" → only show latest)
- No `tag` → each notification stacks separately

---

## 9. Security Model

| Endpoint | Auth | Who calls it |
|---|---|---|
| `POST /api/push/subscribe` | JWT (HS256) | Browser (via client lib) |
| `DELETE /api/push/unsubscribe` | JWT | Browser (via client lib) |
| `POST /api/push/send` | `x-api-key` header | Your app backend only |
| `GET /sw.js` | None | Browser |
| `GET /push-client.js` | None | Browser |

- **JWT** identifies the user via `sub` claim. Issue tokens from your app's login flow.
- **API key** is a shared secret stored in Worker env. Never expose it to the browser.

---

## 10. Testing Flow

1. Open `/demo` (or your page with the client lib)
2. Generate a JWT token for the current user
3. Click **Enable Notifications** — browser prompts for permission
4. Send a test notification from your backend
5. Verify: system notification appears when tab is backgrounded, toast appears when tab is active

---

## 11. Production Checklist

- [ ] Replace `mailto:admin@example.com` with a real contact
- [ ] Generate a unique `JWT_SECRET` per environment
- [ ] Generate a unique `PUSH_API_KEY` per environment
- [ ] Set up proper JWT issuance from your app's auth service
- [ ] Configure `APP_URL` to match your production domain
- [ ] Add a `notificationclick` handler that deep-links into your app
- [ ] Customize cron reminders to match your app's data model
- [ ] Test on iOS Safari (PWA required) and Android Chrome
- [ ] Handle `Notification.permission === 'denied'` gracefully in UI
- [ ] Add `manifest.json` for iOS PWA support

---

## 12. Files You Need

```
src/
├── index.ts              — Route registration + cron export
├── db.ts                 — Hyperdrive Postgres connection
├── sender.ts             — sendPush() via @pushforge/builder
├── cron.ts               — Cron trigger handler
├── sw-content.ts         — Service Worker JS (served at /sw.js)
├── client.ts             — Client lib (served at /push-client.js)
├── routes/
│   ├── subscribe.ts      — POST/DELETE subscribe/unsubscribe
│   └── send.ts           — POST /api/push/send (event-driven)
└── middleware/
    └── auth.ts           — JWT verification middleware
migrations/
├── 001_create_push_subscriptions.sql
└── 002_create_events_tables.sql
wrangler.jsonc            — Hyperdrive + cron config
worker-configuration.d.ts — Runtime types (Env interface)
.dev.vars                 — Local secrets
```

---

## 13. Key Wrangler Config

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "triggers": { "crons": ["*/5 * * * *"] },
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "..." }]
}
```

`nodejs_compat` is required for @pushforge/builder (crypto APIs).
