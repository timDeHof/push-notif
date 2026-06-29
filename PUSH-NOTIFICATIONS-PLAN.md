# PWA Push Notifications — Implementation Plan

## Success Criteria
1. User grants permission — prompted at right moment; denial rate below threshold
2. Subscription survives — tab close, browser restart, SW update don't lose it
3. Notification arrives reliably — >99% delivery on stable connections; failures logged
4. `notificationclick` navigates to correct app route every time
5. Zero console errors in SW or main thread in production
6. VAPID keys can be rotated without dropping all subscribers
7. Full flow testable locally without a production staging server

---

## Phase 0 — Foundation

### Task 1: VAPID key generation
- **What:** Generate public/private key pair, store private key as secret
- **Secret storage options:** `.env` (dev only), platform env vars, cloud secret manager (AWS/GCP/Azure), HashiCorp Vault
- **CLI:** `npx web-push generate-vapid-keys`
- **Hono runtime note:**
  - Node.js/Bun/Deno → use `web-push` (npm)
  - Cloudflare Workers → use `@pushforge/builder` or `@block65/webcrypto-web-push` or `web-push-browser`
- **AI handles:** CLI command, key conversion script
- **Human decides:** storage location based on infra

### Task 2: Choose database for subscriptions
- **Decision:** Use existing Postgres (Neon via Cloudflare Hyperdrive)
- **Why:** Already have it wired up; ACID consistency prevents stale-subscription race; one system to maintain; tiny rows (~300B) — Postgres handles it trivially
- **Upsert key:** `endpoint` is UNIQUE — re-subscribe overwrites instead of duplicating

```sql
CREATE TABLE push_subscriptions (
  id         BIGSERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_push_user ON push_subscriptions(user_id);
```

---

## Phase 1 — Backend (Hono API)

### Task 3: `POST /api/push/subscribe`
- Receive subscription JSON, associate with user, store in DB
- Validate subscription shape

### Task 4: `DELETE /api/push/unsubscribe`
- Remove subscription by `endpoint` or by user ID
- **Idempotent:** always 204 regardless of whether subscription existed or ownership mismatch (no tampering alerts — just silent success)

### Task 5: System-triggered push sender
- **Not an HTTP endpoint** — runs via Cloudflare Cron Trigger
- Cron interval: `*/5 * * * *` (every 5 min)
- Queries "unsent" notifications from app DB, sends to matching subscriptions
- No auth needed — system is the caller
- Look up subscription(s), call Web Push library, handle response

### Task 6: Web Push sender module
- Library call with VAPID keys, encrypted payload via `@pushforge/builder`
- `sendPush(subscription, payload, env) → SendResult` typed function
- 410 Gone → auto-delete stale subscription
- 429 / 5xx → log error (retry strategy tuned after real traffic observed)

---

## Phase 2 — Service Worker

### Task 7: `push` event listener
- Parse payload, construct `Notification` options (title, body, icon, badge, data)
- `self.registration.showNotification()`

### Task 8: `notificationclick` handler
- Read `data.url` from notification
- Try to focus existing tab with matching URL, else `clients.openWindow(absoluteUrl)`

---

## Phase 3 — Client App

### Task 9: SW registration
- Feature detection, `register('/sw.js')`, `updatefound` listener
- **Auto-update** — new SW skips waiting and activates immediately

### Task 10: Subscribe on user interaction
- Wire permission request to a user gesture (button click)
- `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`

### Task 11: Send subscription to backend
- `POST /api/push/subscribe` after successful subscribe (in Task 10)
- `DELETE /api/push/subscribe` on unsubscribe button in settings
- Uses existing auth (cookie/JWT) from settings page

### Task 12: Listen for subscription changes
- On app init: `pushManager.getSubscription()` → re-POST to subscribe endpoint (idempotent upsert)
- After SW update activation: re-check subscription to catch browser-side revocations
- No separate sync endpoint needed — subscribe endpoint is already idempotent

---

## Phase 4 — Polish

### Task 13: Error handling & logging
- Visible feedback to user on failure
- Backend error logging per subscription

### Task 14: Permission denial UX
- Three states in settings UI: granted (toggle on), default (toggle off), denied (disabled + instruction)
- Denial recovery: generic "unblock in browser site settings" instruction
- Brief, functional copy

### Task 15: Dev testing
- CLI: `web-push send-notification` for direct SW testing
- `curl` for testing subscribe/unsubscribe endpoints
- Browser dev tools > Application > Service Workers for SW push simulation
- Verify in Chrome, Firefox, Safari

### Task 16: Key rotation procedure
- Generate new keys, update env/secret store, update client `applicationServerKey`
- Existing subscriptions remain valid (bound by endpoint, not key)
- Document the process

---

## Hono Implementation Notes

```
npm create hono@latest my-app   # select cloudflare-workers or nodejs template
```

### Choosing a Web Push library by runtime

| Runtime | Library | Key format |
|---|---|---|
| Node.js | `web-push` | Base64 URL-encoded string |
| Cloudflare Workers | `@pushforge/builder` | `privateJWK` (JSON) |
| Bun / Deno | `@pushforge/builder` or `web-push` | Depends on API parity |

### AI delegation plan
- **AI implements:** SW, SW registration, subscribe/unsubscribe endpoints, push sender module, CLI test docs
- **Human decides:** secret storage, DB schema, notification UX, payload design, production monitoring
- **Collaborate:** API contract (request/response shapes), error handling strategy
