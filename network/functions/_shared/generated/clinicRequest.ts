// GENERATED — DO NOT EDIT. A copy of shared/network/clinicRequest.ts for the Edge Functions
// (supabase/functions/README.md: a deploy may not bundle imports from outside supabase/).
// Regenerate:  node scripts/copy-shared-to-functions.mjs   (generatedCopy.test.ts checks it).

/**
 * A clinic's own signed request to the Wivo Network (docs/NETWORK-SETUP.md,
 * A8 and B5): how a clinic changes its directory entry (listed or not) and
 * reads its invite code, without a Network account and without the anon key
 * touching the table.
 *
 *   request = base64url(payload JSON) "." base64url(signature)
 *   signed  = Ed25519 over the bytes of "WIVO-NETWORK-CLINIC-1\n" + base64url(payload)
 *
 * The private key is a secret of the CLINIC's project (NETWORK_CLINIC_KEY,
 * used only by its Edge Function network-directory, after the database said
 * the caller is the owner with the second factor). The Network keeps only the
 * public key, in the clinic's directory row: a copy of the Network's database
 * cannot speak for any clinic.
 *
 * Its own domain prefix: never a Network token (WIVO-NETWORK-1), a licence or
 * a work record, and none of those ever one of these. `iat` is in
 * MILLISECONDS: the Network takes a change only with a later `iat` than the
 * last one it took (a replayed request does nothing), and any request only
 * within a minute of its own clock.
 *
 * Dependency-free on purpose (no import even from token.ts): copied into
 * supabase/functions/_shared/generated and network/functions/_shared/generated
 * (scripts/copy-shared-to-functions.mjs).
 */

export const CLINIC_REQUEST_DOMAIN = 'WIVO-NETWORK-CLINIC-1\n'
export const CLINIC_REQUEST_AUDIENCE = 'wivo-network'
/** How far a request's time may be from the Network's clock. */
export const CLINIC_REQUEST_WINDOW_MS = 60_000

export type ClinicRequestOp = 'get' | 'set_listed'

export interface ClinicRequestPayload {
  v: 1
  aud: typeof CLINIC_REQUEST_AUDIENCE
  /** The clinic's id in the Network directory. */
  clinic: string
  op: ClinicRequestOp
  /** Only with op = set_listed. */
  listed?: boolean
  /** Milliseconds since 1970. */
  iat: number
  /** Random, so two requests in the same millisecond still differ. */
  nonce: string
}

/** What the Network answers about a clinic's own entry. */
export interface DirectoryEntry {
  listed: boolean
  inviteCode: string
  name: string
  city: string | null
  country: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const INVITE_CODE = /^[a-z0-9]{12,40}$/

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url')
  const pad = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const asBuffer = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

/** The payload as it may be signed, or why not. Both sides use this one check. */
export function clinicPayloadProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'not an object'
  const x = p as Record<string, unknown>
  if (x.v !== 1) return 'version'
  if (x.aud !== CLINIC_REQUEST_AUDIENCE) return 'audience'
  if (typeof x.clinic !== 'string' || !UUID.test(x.clinic)) return 'clinic'
  if (x.op !== 'get' && x.op !== 'set_listed') return 'op'
  if (x.op === 'set_listed' && typeof x.listed !== 'boolean') return 'listed'
  if (x.op === 'get' && x.listed !== undefined) return 'listed'
  if (!Number.isSafeInteger(x.iat) || (x.iat as number) <= 0) return 'iat'
  if (typeof x.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(x.nonce)) return 'nonce'
  return null
}

/** A fresh nonce (16 random bytes, base64url). */
export function clinicNonce(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(16)))
}

export async function importClinicSigningKey(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', asBuffer(fromB64url(pkcs8B64.trim().replace(/\s+/g, ''))), { name: 'Ed25519' }, false, ['sign'])
}
export async function importClinicPublicKey(rawB64url: string): Promise<CryptoKey> {
  const raw = fromB64url(rawB64url.trim())
  if (raw.length !== 32) throw new Error('An Ed25519 public key is 32 bytes')
  return crypto.subtle.importKey('raw', asBuffer(raw), { name: 'Ed25519' }, false, ['verify'])
}

export async function signClinicRequest(payload: ClinicRequestPayload, key: CryptoKey): Promise<string> {
  const problem = clinicPayloadProblem(payload)
  if (problem) throw new Error(`Clinic request payload: ${problem}`)
  const body = b64url(utf8(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, asBuffer(utf8(CLINIC_REQUEST_DOMAIN + body))))
  return `${body}.${b64url(sig)}`
}

/**
 * Which clinic a request SAYS it is from, before anything is checked: only
 * to find that clinic's public key. Never trusted for anything else.
 */
export function claimedClinic(request: unknown): string | null {
  if (typeof request !== 'string' || request.length > 2000) return null
  const parts = request.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) as { clinic?: unknown }
    return typeof p?.clinic === 'string' && UUID.test(p.clinic) ? p.clinic.toLowerCase() : null
  } catch { return null }
}

export type ClinicVerifyResult =
  | { ok: true; payload: ClinicRequestPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'payload' | 'other_clinic' | 'stale_clock' }

/** Signed by THIS clinic's key, for this clinic, and within a minute of `nowMs`. */
export async function verifyClinicRequest(request: string, key: CryptoKey, clinic: string, nowMs: number): Promise<ClinicVerifyResult> {
  const parts = typeof request === 'string' ? request.split('.') : []
  if (parts.length !== 2 || !parts[0] || !parts[1] || request.length > 2000) return { ok: false, reason: 'malformed' }
  let sig: Uint8Array
  try { sig = fromB64url(parts[1]) } catch { return { ok: false, reason: 'malformed' } }
  const good = await crypto.subtle.verify({ name: 'Ed25519' }, key, asBuffer(sig), asBuffer(utf8(CLINIC_REQUEST_DOMAIN + parts[0])))
  if (!good) return { ok: false, reason: 'signature' }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) } catch { return { ok: false, reason: 'malformed' } }
  if (clinicPayloadProblem(payload)) return { ok: false, reason: 'payload' }
  const p = payload as ClinicRequestPayload
  if (p.clinic.toLowerCase() !== clinic.toLowerCase()) return { ok: false, reason: 'other_clinic' }
  if (Math.abs(nowMs - p.iat) > CLINIC_REQUEST_WINDOW_MS) return { ok: false, reason: 'stale_clock' }
  return { ok: true, payload: p }
}

/** What the Network answered, as a clinic may trust it: anything else is no answer. */
export function directoryEntryOf(x: unknown): DirectoryEntry | null {
  if (!x || typeof x !== 'object') return null
  const e = x as Record<string, unknown>
  if (typeof e.listed !== 'boolean') return null
  if (typeof e.inviteCode !== 'string' || !INVITE_CODE.test(e.inviteCode)) return null
  if (typeof e.name !== 'string' || e.name.length === 0 || e.name.length > 160) return null
  if (e.city !== null && (typeof e.city !== 'string' || e.city.length > 120)) return null
  if (typeof e.country !== 'string' || !/^[A-Z]{2}$/.test(e.country)) return null
  return { listed: e.listed, inviteCode: e.inviteCode, name: e.name, city: e.city as string | null, country: e.country }
}

/** A new key pair for one clinic: the private key (PKCS#8) for its project's secrets, the public key (raw) for its Network row. */
export async function makeClinicKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { privateKey: b64url(priv), publicKey: b64url(pub) }
}
