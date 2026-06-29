import { generateKeyPair } from 'crypto'
import { promisify } from 'util'

const generateKeyPairAsync = promisify(generateKeyPair)

const { publicKey: pubJwk, privateKey: privJwk } = await generateKeyPairAsync('ec', {
  namedCurve: 'P-256',
  privateKeyEncoding: { type: 'pkcs8', format: 'jwk' },
  publicKeyEncoding: { type: 'spki', format: 'jwk' },
})

function base64url(buf) {
  return Buffer.from(buf).toString('base64url')
}

const x = Buffer.from(pubJwk.x, 'base64url')
const y = Buffer.from(pubJwk.y, 'base64url')
const rawPublic = Buffer.concat([Buffer.from([0x04]), x, y])
const clientKey = rawPublic.toString('base64url')

console.log('=== VAPID Public Key (for client subscribe) ===')
console.log(clientKey)
console.log()
console.log('=== VAPID Private Key (JWK - store as wrangler secret) ===')
console.log(JSON.stringify(privJwk))
console.log()
console.log('=== Set Cloudflare secrets ===')
console.log(`echo "${clientKey}" | wrangler secret put VAPID_PUBLIC_KEY`)
console.log(`echo '${JSON.stringify(privJwk)}' | wrangler secret put VAPID_PRIVATE_KEY`)
console.log('echo "mailto:admin@example.com" | wrangler secret put VAPID_SUBJECT')
