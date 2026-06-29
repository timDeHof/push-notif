import { Hono } from 'hono'
import { sign } from 'hono/jwt'
import { authMiddleware } from '../middleware/auth'
import { getSql } from '../db'
import { sendPush } from '../sender'

const demo = new Hono<{ Bindings: Env; Variables: { userId: string } }>()

demo.post('/api/demo/token', async (c) => {
  const userId = 'demo-' + crypto.randomUUID().slice(0, 8)
  const token = await sign(
    { sub: userId, iat: Math.floor(Date.now() / 1000) },
    c.env.JWT_SECRET,
    'HS256',
  )
  return c.json({ token, userId })
})

demo.post('/api/demo/send', authMiddleware(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid body' }, 400)
  }

  const { title, text, url, tag } = body as Record<string, unknown>
  if (typeof title !== 'string' || !title) {
    return c.json({ error: 'title is required' }, 400)
  }

  const userId = c.var.userId
  const payload = {
    title,
    body: typeof text === 'string' ? text : '',
    url: typeof url === 'string' ? url : '/',
    tag: typeof tag === 'string' ? tag : undefined,
  }

  const sql = getSql(c.env.HYPERDRIVE)
  let rows: { endpoint: string; p256dh: string; auth: string }[]
  try {
    rows = await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${userId}
    `
  } catch {
    return c.json({ error: 'db error' }, 500)
  } finally {
    await sql.end()
  }

  if (rows.length === 0) {
    return c.json({ error: 'no subscription — enable notifications first' }, 400)
  }

  for (const row of rows) {
    const result = await sendPush(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      c.env,
    )
    if (!result.ok) {
      console.error('demo send failed', result.error)
    }
  }

  return c.json({ ok: true })
})

demo.get('/api/demo/events', authMiddleware(), async (c) => {
  const sql = getSql(c.env.HYPERDRIVE)
  try {
    const rows = await sql`
      SELECT e.id, e.title, e.description, e.start_time, e.host_user_id,
             (SELECT count(*) FROM event_attendees WHERE event_id = e.id)::int AS attendee_count
      FROM events e
      ORDER BY e.start_time ASC
      LIMIT 50
    `
    return c.json(rows)
  } catch {
    return c.json({ error: 'db error' }, 500)
  } finally {
    await sql.end()
  }
})

demo.post('/api/demo/events', authMiddleware(), async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.title !== 'string' || !body.title) {
    return c.json({ error: 'title is required' }, 400)
  }
  if (typeof body.startTime !== 'string' || !body.startTime) {
    return c.json({ error: 'startTime is required (ISO 8601 string)' }, 400)
  }

  const sql = getSql(c.env.HYPERDRIVE)
  try {
    const [row] = await sql`
      INSERT INTO events (title, description, start_time, host_user_id)
      VALUES (${body.title}, ${body.description ?? null}, ${body.startTime}, ${c.var.userId})
      RETURNING id, title, start_time
    `
    return c.json(row, 201)
  } catch {
    return c.json({ error: 'db error' }, 500)
  } finally {
    await sql.end()
  }
})

demo.post('/api/demo/events/:id/join', authMiddleware(), async (c) => {
  const eventId = Number(c.req.param('id'))
  if (!eventId) return c.json({ error: 'invalid event id' }, 400)

  const sql = getSql(c.env.HYPERDRIVE)
  try {
    await sql`
      INSERT INTO event_attendees (event_id, user_id)
      VALUES (${eventId}, ${c.var.userId})
      ON CONFLICT (event_id, user_id) DO NOTHING
    `
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'db error' }, 500)
  } finally {
    await sql.end()
  }
})

demo.post('/api/demo/check-events', authMiddleware(), async (c) => {
  const { handleCron } = await import('../cron')
  await handleCron(c.env)
  return c.json({ ok: true })
})

export default demo
