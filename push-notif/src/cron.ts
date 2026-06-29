import { getSql } from './db'
import { sendPush, type PushPayload } from './sender'

export async function handleCron(env: Env): Promise<void> {
  const sql = getSql(env.HYPERDRIVE)

  let rows: { endpoint: string; p256dh: string; auth: string; userId: string; eventId: number; eventTitle: string }[]
  try {
    rows = await sql`
      SELECT s.endpoint, s.p256dh, s.auth, ea.user_id AS "userId",
             e.id AS "eventId", e.title AS "eventTitle"
      FROM events e
      JOIN event_attendees ea ON ea.event_id = e.id
      JOIN push_subscriptions s ON s.user_id = ea.user_id
      WHERE e.start_time BETWEEN now() AND now() + interval '5 minutes'
        AND ea.notify = true
    `
  } catch (err) {
    console.error('cron: failed to query upcoming events', err)
    return
  } finally {
    await sql.end()
  }

  const sent = new Set<string>()
  for (const row of rows) {
    const dedupKey = `${row.eventId}:${row.userId}`
    if (sent.has(dedupKey)) continue
    sent.add(dedupKey)

    const payload: PushPayload = {
      title: 'Starting soon!',
      body: `"${row.eventTitle}" begins in 5 minutes`,
      url: `/events/${row.eventId}`,
      tag: `event-${row.eventId}-starting`,
    }

    const result = await sendPush(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      env,
    )
    if (!result.ok && result.fatal) {
      console.warn('cron: fatal send failed for reminder', row.endpoint.slice(0, 40), result.error)
    }
  }

  console.log(`cron: sent ${sent.size} event reminders`)
}
