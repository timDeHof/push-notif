import { buildPushHTTPRequest } from '@pushforge/builder'
import { getSql } from './db'

export type PushPayload = {
  title: string
  body: string
  url: string
  tag?: string
}

export type SendResult =
  | { ok: true }
  | { ok: false; error: string; fatal?: boolean }

export async function sendPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: PushPayload,
  env: Env,
): Promise<SendResult> {
  let privateJWK: JsonWebKey
  try {
    privateJWK = JSON.parse(env.VAPID_PRIVATE_KEY)
  } catch {
    return { ok: false, error: 'invalid VAPID_PRIVATE_KEY', fatal: true }
  }

  let built: { endpoint: string; headers: Headers | Record<string, string>; body: ArrayBuffer }
  try {
    built = await buildPushHTTPRequest({
      privateJWK,
      subscription,
      message: {
        payload,
        adminContact: env.VAPID_SUBJECT,
      },
    })
  } catch (err) {
    return { ok: false, error: `buildPushHTTPRequest: ${err}` }
  }

  let response: Response
  try {
    response = await fetch(built.endpoint, {
      method: 'POST',
      headers: built.headers instanceof Headers ? built.headers : new Headers(built.headers),
      body: built.body,
    })
  } catch (err) {
    return { ok: false, error: `fetch failed: ${err}` }
  }

  if (response.status === 201) {
    return { ok: true }
  }

  if (response.status === 410) {
    const sql = getSql(env.HYPERDRIVE)
    try {
      await sql`DELETE FROM push_subscriptions WHERE endpoint = ${subscription.endpoint}`
    } finally {
      await sql.end()
    }
    return { ok: false, error: 'subscription expired (410)', fatal: true }
  }

  const body = await response.text().catch(() => '')
  return { ok: false, error: `${response.status} ${body}` }
}
