import { Hono } from 'hono'
import { getSql } from '../db'
import { authMiddleware } from '../middleware/auth'

const subscribe = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

subscribe.use('*', authMiddleware())

subscribe.post('/api/push/subscribe', async (c) => {
  const userId = c.var.userId

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid body' }, 400)
  }

  const endpoint: unknown = (body as Record<string, unknown>).endpoint
  const keys: unknown = (body as Record<string, unknown>).keys
  const userAgent: unknown = (body as Record<string, unknown>).userAgent

  if (typeof endpoint !== 'string' || !endpoint) {
    return c.json({ error: 'endpoint is required' }, 400)
  }
  if (!keys || typeof keys !== 'object') {
    return c.json({ error: 'keys are required' }, 400)
  }
  const ks = keys as Record<string, unknown>
  const p256dh: string | undefined = typeof ks.p256dh === 'string' ? ks.p256dh : undefined
  const authKey: string | undefined = typeof ks.auth === 'string' ? ks.auth : undefined
  if (!p256dh) {
    return c.json({ error: 'keys.p256dh is required' }, 400)
  }
  if (!authKey) {
    return c.json({ error: 'keys.auth is required' }, 400)
  }

  const sql = getSql(c.env.HYPERDRIVE)
  try {
    await sql`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
      VALUES (${userId}, ${endpoint}, ${p256dh}, ${authKey}, ${typeof userAgent === 'string' ? userAgent : null})
      ON CONFLICT (endpoint) DO UPDATE SET
        p256dh = EXCLUDED.p256dh,
        auth   = EXCLUDED.auth,
        user_agent = EXCLUDED.user_agent
    `
    return c.body(null, 201)
  } finally {
    await sql.end()
  }
})

subscribe.delete('/api/push/unsubscribe', async (c) => {
  const userId = c.var.userId
  const endpoint = c.req.query('endpoint')

  const sql = getSql(c.env.HYPERDRIVE)
  try {
    if (endpoint) {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`
    } else {
      await sql`DELETE FROM push_subscriptions WHERE user_id = ${userId}`
    }
    return c.body(null, 204)
  } finally {
    await sql.end()
  }
})

export default subscribe
