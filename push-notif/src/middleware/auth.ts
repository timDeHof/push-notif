import { verify } from 'hono/jwt'
import type { MiddlewareHandler } from 'hono'

type Variables = {
  userId: string
}

export function authMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'missing or invalid Authorization header' }, 401)
    }

    const token = auth.slice(7)

    let payload: Record<string, unknown>
    try {
      payload = await verify(token, c.env.JWT_SECRET, 'HS256')
    } catch {
      return c.json({ error: 'invalid token' }, 401)
    }

    const sub = payload.sub
    if (typeof sub !== 'string' || !sub) {
      return c.json({ error: 'token missing sub claim' }, 401)
    }

    c.set('userId', sub)
    await next()
  }
}
