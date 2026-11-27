#!/usr/bin/env node
/**
 * One clinic's own key pair for the Wivo Network (docs/NETWORK-SETUP.md, A8).
 * With it the clinic's Edge Function network-directory signs its requests
 * to the Network (the owner shows or hides the clinic in the directory, and
 * reads the invite link).
 *
 *   node network/scripts/make-clinic-key.mjs <folder outside the repo> <clinic id> https://<NETWORK_REF>.supabase.co
 *
 * Writes two files into that folder, never into the repo and never to the
 * screen:
 *   <clinic>-network-clinic.env   NETWORK_CLINIC_KEY=<private key> and
 *                                 NETWORK_URL=<the Network>, for
 *                                 `supabase secrets set --env-file …` on the
 *                                 CLINIC's project; DELETE it afterwards
 *   <clinic>-network-clinic-public-key.txt
 *                                 the public key, for the clinic's row in the
 *                                 Network (clinic_public_key); public by design
 *
 * Refuses a folder inside the repo: a private key there is one `git add -A`
 * away from being everyone's.
 */
import { webcrypto } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [target, clinic, networkUrl] = process.argv.slice(2)
if (!target || !clinic || !networkUrl) {
  console.error('Usage: node network/scripts/make-clinic-key.mjs <folder outside the repo> <clinic id, e.g. dentiks> https://<NETWORK_REF>.supabase.co')
  process.exit(2)
}
if (!/^[a-z0-9-]{2,40}$/.test(clinic)) {
  console.error('The clinic id is the name of its clinics/<id>.json, e.g. dentiks.')
  process.exit(2)
}
const url = networkUrl.trim().replace(/\/+$/, '')
if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) {
  console.error('The Network address looks like https://<20 letters>.supabase.co')
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
const envFile = join(dir, `${clinic}-network-clinic.env`)
const pubFile = join(dir, `${clinic}-network-clinic-public-key.txt`)
if (existsSync(envFile)) {
  console.error(`${envFile} is already there. Move or delete it first: one key pair, not two.`)
  process.exit(2)
}

const b64url = (u) => Buffer.from(u).toString('base64url')
const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
const priv = new Uint8Array(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey))
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey))

writeFileSync(envFile, `NETWORK_CLINIC_KEY=${b64url(priv)}\nNETWORK_URL=${url}\n`, { mode: 0o600 })
writeFileSync(pubFile, `${b64url(pub)}\n`)
console.log(`Private key: ${envFile}  (for supabase secrets set --env-file on the clinic's project, then DELETE it)`)
console.log(`Public key:  ${pubFile}  (for the clinic's row in the Network: clinic_public_key)`)
