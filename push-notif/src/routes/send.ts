import { Hono } from 'hono'
import { getSql } from '../db'
import { sendPush, type PushPayload } from '../sender'

const send = new Hono<{ Bindings: Env }>()

send.post('/api/push/send', async (c) => {
  const apiKey = c.req.header('x-api-key')
  if (!apiKey || apiKey !== c.env.PUSH_API_KEY) {
    return c.json({ error: 'invalid api key' }, 401)
  }

  const body = await c.req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid body' }, 400)
  }

  const { userId, userIds, title, body: text, url, tag } = body as Record<string, unknown>

  if (typeof title !== 'string' || !title) {
    return c.json({ error: 'title is required' }, 400)
  }

  const ids: string[] = []
  if (Array.isArray(userIds)) {
    ids.push(...userIds.filter((u): u is string => typeof u === 'string' && u.length > 0))
  }
  if (typeof userId === 'string' && userId) {
    ids.push(userId)
  }
  if (ids.length === 0) {
    return c.json({ error: 'userId or userIds is required' }, 400)
  }

  const payload: PushPayload = {
    title,
    body: typeof text === 'string' ? text : '',
    url: typeof url === 'string' ? url : '/',
    tag: typeof tag === 'string' ? tag : undefined,
  }

  const sql = getSql(c.env.HYPERDRIVE)
  let rows: { endpoint: string; p256dh: string; auth: string }[]
  try {
    rows = await sql`
      SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN ${sql(ids)}
    `
  } catch (err) {
    return c.json({ error: 'db query failed' }, 500)
  } finally {
    await sql.end()
  }

  if (rows.length === 0) {
    return c.json({ error: 'no subscriptions for any user' }, 404)
  }

  const results: { ok: boolean; error?: string }[] = []
  for (const row of rows) {
    const result = await sendPush(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      c.env,
    )
    results.push(result)
  }

  return c.json({ sent: results.filter((r) => r.ok).length, total: results.length })
})

export default send
