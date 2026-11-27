#!/usr/bin/env node
/**
 * The Network's signing key pair (docs/NETWORK-SETUP.md, step 4).
 *
 *   node network/scripts/make-network-key.mjs <folder outside the repo>
 *
 * Writes two files into that folder, never into the repo and never to the
 * screen:
 *   network-signing.env   NETWORK_SIGNING_KEY=<private key>   for
 *                         `supabase secrets set --env-file …` on the Network
 *                         project; DELETE it afterwards
 *   network-public-key.txt the public key, for every clinic's
 *                         Settings → Network (public by design)
 *
 * Refuses a folder inside the repo: a private key there is one `git add -A`
 * away from being everyone's.
 */
import { webcrypto } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const target = process.argv[2]
if (!target) {
  console.error('Usage: node network/scripts/make-network-key.mjs <folder outside the repo>')
  process.exit(2)
}
const dir = resolve(target)
const rel = relative(repo, dir)
if (!rel.startsWith('..') && !isAbsolute(rel)) {
  console.error('That folder is inside the repo. Choose one outside it (for example your Documents folder).')
  process.exit(2)
}
if (!existsSync(dir)) {
  console.error(`No such folder: ${dir}`)
  process.exit(2)
}
const envFile = join(dir, 'network-signing.env')
const pubFile = join(dir, 'network-public-key.txt')
if (existsSync(envFile)) {
  console.error(`${envFile} is already there. Move or delete it first: one key pair, not two.`)
  process.exit(2)
}

const b64url = (u) => Buffer.from(u).toString('base64url')
const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const priv = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))

writeFileSync(envFile, `NETWORK_SIGNING_KEY=${b64url(priv)}\n`, { mode: 0o600 })
writeFileSync(pubFile, `${b64url(pub)}\n`)
console.log(`Private key: ${envFile}  (for supabase secrets set --env-file, then DELETE it)`)
console.log(`Public key:  ${pubFile}  (for each clinic's Settings → Network)`)
