import { Hono } from 'hono'
import subscribe from './routes/subscribe'
import demo from './routes/demo'
import sendRoute from './routes/send'
import { handleCron } from './cron'
import { swJs } from './sw-content'
import { clientJs } from './client'
import { demoHtml } from './demo-html'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/push/health', (c) => c.json({ ok: true }))



app.get('/sw.js', (c) =>
  c.body(swJs, 200, { 'Content-Type': 'application/javascript' }),
)

app.get('/push-client.js', (c) =>
  c.body(
    clientJs.replace('__VAPID_PUBLIC_KEY__', c.env.VAPID_PUBLIC_KEY),
    200,
    { 'Content-Type': 'application/javascript' },
  ),
)

app.get('/demo', (c) =>
  c.body(demoHtml, 200, { 'Content-Type': 'text/html' }),
)

app.route('/', demo)
app.route('/', sendRoute)
app.route('/', subscribe)

const handler: ExportedHandler<Env> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx)
  },
  scheduled(_controller, env) {
    return handleCron(env)
  },
}
export default handler
