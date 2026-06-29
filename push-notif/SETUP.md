# Push Notification Service — Setup & Summary

## Architecture

```
                    ┌──────────────────────────────┐
App Backend ──────→ │  POST /api/push/send          │
 (event-driven)     │  (x-api-key auth)             │
                    └──────┬───────────────────────┘
                           │
Browser ← → Worker (Hono) ← → Hyperdrive ← → Neon Postgres
           ↕                  ↕
        Push Service       Cron (every 5m)
           ↕
      Service Worker → showNotification() → in-app toast (via postMessage)
```

## Deploy URL

**https://push-notif.ttdehof.workers.dev**

---

## Project Structure

```
push-notif/
├── src/
│   ├── index.ts              Entry point — routes + cron handler
│   ├── db.ts                 Hyperdrive Postgres connection
│   ├── sender.ts             sendPush() via @pushforge/builder
│   ├── cron.ts               Cron trigger — sends to all subs
│   ├── sw-content.ts         Service Worker JS (served at /sw.js)
│   ├── client.ts             Client lib (served at /push-client.js)
│   ├── demo-html.ts          Demo page (served at /demo)
│   ├── routes/
│   │   ├── subscribe.ts      POST/DELETE subscribe/unsubscribe (JWT auth)
│   │   ├── send.ts           POST /api/push/send (API key auth, event-driven)
│   │   └── demo.ts           POST /api/demo/token + /api/demo/send (JWT auth)
│   └── middleware/
│       └── auth.ts           JWT verification middleware
├── migrations/
│   ├── 000_create_migrations_table.sql
│   ├── 001_create_push_subscriptions.sql
│   └── 002_create_events_tables.sql
├── scripts/
│   ├── generate-keys.mjs     VAPID key generation
│   └── migrate.mjs           Migration runner
├── wrangler.jsonc            Worker config (Hyperdrive, cron)
├── worker-configuration.d.ts Generated runtime types + Env types
├── .dev.vars                 Local dev secrets
└── package.json
```

## Secrets Set

| Secret | Source |
|---|---|
| `VAPID_PUBLIC_KEY` | Generated via `scripts/generate-keys.mjs` |
| `VAPID_PRIVATE_KEY` | JWK format (required by @pushforge/builder) |
| `VAPID_SUBJECT` | `mailto:admin@example.com` (update for production) |
| `APP_URL` | `https://push-notif.ttdehof.workers.dev` |
| `JWT_SECRET` | Random 256-bit hex |
| `PUSH_API_KEY` | Random hex (for `/api/push/send`) |

## Database

**Provider:** Neon Postgres via Cloudflare Hyperdrive

**Table `push_subscriptions`:**
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `user_id` | TEXT | From JWT `sub` claim |
| `endpoint` | TEXT | UNIQUE — upsert on conflict |
| `p256dh` | TEXT | Encryption key |
| `auth` | TEXT | Auth secret |
| `user_agent` | TEXT | Nullable |
| `created_at` | TIMESTAMPTZ | Default now() |

**Index:** `idx_push_user` on `user_id`

**Table `events`:**
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `title` | TEXT | |
| `description` | TEXT | Nullable |
| `start_time` | TIMESTAMPTZ | |
| `host_user_id` | TEXT | User who created the event |
| `created_at` | TIMESTAMPTZ | Default now() |

**Index:** `idx_events_start_time` on `start_time`

**Table `event_attendees`:**
| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL | PK |
| `event_id` | BIGINT | FK → events.id |
| `user_id` | TEXT | Attendee user ID |
| `notify` | BOOLEAN | Default true |
| `created_at` | TIMESTAMPTZ | Default now() |

**Index:** `idx_event_attendees_user` on `user_id`, unique on `(event_id, user_id)`

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/push/health` | No | Health check |
| `POST` | `/api/push/subscribe` | JWT | Upsert subscription |
| `DELETE` | `/api/push/unsubscribe` | JWT | Remove by endpoint or all for user |
| `POST` | `/api/push/send` | API key | Send push to a specific user (event-driven) |
| `POST` | `/api/demo/token` | No | Issue demo JWT |
| `POST` | `/api/demo/send` | JWT | Demo send — pushes to the authenticated user |
| `GET` | `/api/demo/events` | JWT | List upcoming events |
| `POST` | `/api/demo/events` | JWT | Create an event (body: `title`, `startTime`) |
| `POST` | `/api/demo/events/:id/join` | JWT | Join an event as attendee |
| `POST` | `/api/demo/check-events` | JWT | Manually trigger "starting soon" check |
| `GET` | `/demo` | No | Interactive demo page |
| `GET` | `/sw.js` | No | Service Worker script |
| `GET` | `/push-client.js` | No | Client library |

## Auth

### JWT (subscribe/unsubscribe/demo send)
- **Algorithm:** HS256
- **Header:** `Authorization: Bearer <token>`
- **Claim:** `sub` → user ID
- **Middleware:** `src/middleware/auth.ts` — verifies JWT, sets `c.var.userId`

### API Key (send endpoint)
- **Header:** `x-api-key: <key>`
- **Usage:** Call from your app backend to trigger push notifications on events (e.g. new attendee → notify host)
- **Request body:**
  ```json
  {
    "userId": "host-user-id",
    "title": "New attendee!",
    "body": "Alex signed up for Jazz Night",
    "url": "/events/jazz-night",
    "tag": "event-123"
  }
  ```
  Or send to multiple users at once:
  ```json
  {
    "userIds": ["attendee-1", "attendee-2"],
    "title": "Event updated",
    "body": "The host changed the details"
  }
  ```
  `userId` and `userIds` can also be combined — merged into one query.
- `tag` groups notifications — same tag replaces previous, omit to stack separately

## Service Worker (`/sw.js`)

| Event | Behavior |
|---|---|
| `push` | `event.data.json()` → `showNotification()` + `postMessage({ type: 'push-toast' })` to all window clients |
| `notificationclick` | Focus existing tab or `openWindow(data.url)` |
| `install` | `skipWaiting()` — auto-update |
| `activate` | `clients.claim()` |

The SW also posts a message to all open tabs when a push arrives, enabling in-app toast UI.

## Client Library (`/push-client.js`)

Reads JWT from `<meta name="token">`, auto-registers SW, syncs subscription on load.

**Exported functions via `window.__push`:**
- `onSubscribeClick()` — request permission + subscribe
- `onUnsubscribeClick()` — unsubscribe locally + DELETE to server
- `syncSubscription()` — re-POST existing subscription
- `registerSw()` — register `/sw.js` with update listener

## Cron

- **Schedule:** `*/5 * * * *`
- **Behavior:** Queries events starting within the next 5 minutes, finds attendees with push subscriptions, and sends "Starting soon!" reminders
- **Customize:** Edit `src/cron.ts` to change the query or notification payload

## Demo Page (`/demo`)

Interactive page for testing the full push flow without building a frontend:

1. **Subscribe:** Click "Get Demo Token" → "Enable Notifications"
2. **Send test notifications:** Pick a scenario (new attendee, host updated, event canceled, or custom) and click "Send Test Notification"
3. **Test event reminders:** Create an event with a start time ~5 minutes in the future (auto-filled), join it, then click "Check Starting Soon Now" to trigger the reminder immediately
4. **Receive:** Notification appears as an in-app toast popup (visible while on page) + system notification (when browser is backgrounded)
5. **Troubleshooting:** If notifications are blocked, the page shows a red banner with browser settings instructions. On iOS Safari, a yellow banner explains the PWA requirement (must add to Home Screen first).

## Implementation Steps

1. Scaffolded Hono + Cloudflare Workers project
2. Generated VAPID keys (JWK format for @pushforge/builder)
3. Created Postgres schema and migration runner
4. Implemented subscribe/unsubscribe endpoints with JWT auth
5. Built Web Push sender module using @pushforge/builder
6. Created cron trigger handler
7. Wrote Service Worker (push, notificationclick, auto-update, SW→client message)
8. Created client library (registration, subscribe, unsubscribe, sync)
9. Built interactive demo page with demo token and demo send endpoints
10. Added event-driven send endpoint (`POST /api/push/send`) with API key auth
11. Wired up Hyperdrive binding to Neon Postgres
12. Set all secrets (VAPID keys, JWT_SECRET, APP_URL, PUSH_API_KEY)
13. Deployed to Cloudflare Workers
14. Added in-app toast UI and platform diagnostics to demo page
15. Created events + event_attendees tables for "starts in 5 min" reminders
16. Updated cron to query upcoming events and send timed reminders
17. Added demo event endpoints (create, join, manual check trigger)

## Local Development

```bash
npm run dev          # wrangler dev — runs locally with Hyperdrive
npm run migrate      # Apply DB migrations (requires DATABASE_URL env)
npm run keys:generate  # Generate new VAPID keys
npm run deploy       # Deploy to Cloudflare
```
