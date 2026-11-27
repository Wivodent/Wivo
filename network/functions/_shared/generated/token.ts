// GENERATED — DO NOT EDIT. A copy of shared/network/token.ts for the Edge Functions
// (supabase/functions/README.md: a deploy may not bundle imports from outside supabase/).
// Regenerate:  node scripts/copy-shared-to-functions.mjs   (generatedCopy.test.ts checks it).

/**
 * The Wivo Network token (docs/PLAN-NETWORK-1.md, N2): what the Network
 * signs for one signed-in account and ONE clinic, and what that clinic checks
 * before it opens a client session.
 *
 *   token   = base64url(payload JSON) "." base64url(signature)
 *   signed  = Ed25519 over the bytes of "WIVO-NETWORK-1\n" + base64url(payload)
 *
 * The prefix is this token's own domain: a Network token can never pass for a
 * licence (LICENCE_SIGNING_DOMAIN) or a work record (WIVO-WORK-1), and those
 * never for it. Web Crypto only, so the same file runs in the Network's and
 * the clinic's Edge Functions (Deno) and in the tests (Node).
 *
 * Dependency-free on purpose: copied into supabase/functions/_shared/generated
 * and network/functions/_shared/generated (scripts/copy-shared-to-functions.mjs).
 */

export const NETWORK_TOKEN_DOMAIN = 'WIVO-NETWORK-1\n'
export const NETWORK_ISSUER = 'wivo-network'
/** How long a token lives: only long enough to open a session. */
export const NETWORK_TOKEN_SECONDS = 300
/** A clock that runs a little ahead or behind is not an attack. */
export const CLOCK_SKEW_SECONDS = 60

export type AccountKind = 'person' | 'company'
export type AccountRole = 'technician' | 'doctor' | 'clinic' | 'lab'
export const ACCOUNT_KINDS: readonly AccountKind[] = ['person', 'company']
export const ACCOUNT_ROLES: readonly AccountRole[] = ['technician', 'doctor', 'clinic', 'lab']
/** Wivo Network's languages (shared/i18n NETWORK_LANGUAGES; a copy, as this file has no imports). */
export type AccountLang = 'en' | 'lv' | 'ru' | 'et'
export const ACCOUNT_LANGS: readonly AccountLang[] = ['en', 'lv', 'ru', 'et']

export interface NetworkTokenPayload {
  v: 1
  iss: typeof NETWORK_ISSUER
  /** The clinic's id in the Network directory: the one clinic this token is for. */
  aud: string
  /** The account. */
  sub: string
  /** The connection in the Network. */
  conn: string
  name: string
  kind: AccountKind
  role: AccountRole
  company: string | null
  country: string | null
  /**
   * The account's sign-in address and whether it wants e-mails about its
   * orders (Network 003): the clinic e-mails "New message on … from …" only
   * then (the clinic's sql/142). Absent from older tokens.
   */
  email?: string | null
  mail?: boolean
  /**
   * The address the account's invoices go to, when it gave one (Network 004):
   * the clinic's record of the account gets it as its billing e-mail
   * (the clinic's sql/152). Absent from older tokens.
   */
  billing?: string | null
  /**
   * The language the account chose (Network 006): the clinic's e-mails about
   * its orders are written in it (the clinic's sql/154). Absent from older
   * tokens; null when not chosen yet.
   */
  lang?: AccountLang | null
  iat: number
  exp: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── base64url, without Buffer (Deno and the browser have none) ──────────────
export function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function fromB64url(text: string): Uint8Array {
  const pad = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const asBuffer = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer

/** The payload as it may be signed, or why not. Shared by both sides, so they cannot disagree. */
export function payloadProblem(p: unknown): string | null {
  if (!p || typeof p !== 'object') return 'not an object'
  const x = p as Record<string, unknown>
  if (x.v !== 1) return 'version'
  if (x.iss !== NETWORK_ISSUER) return 'issuer'
  for (const k of ['aud', 'sub', 'conn'] as const) if (typeof x[k] !== 'string' || !UUID.test(x[k] as string)) return k
  if (typeof x.name !== 'string' || x.name.trim().length === 0 || x.name.length > 120) return 'name'
  if (!ACCOUNT_KINDS.includes(x.kind as AccountKind)) return 'kind'
  if (!ACCOUNT_ROLES.includes(x.role as AccountRole)) return 'role'
  if (x.company !== null && (typeof x.company !== 'string' || x.company.length > 160)) return 'company'
  if (x.country !== null && (typeof x.country !== 'string' || !/^[A-Z]{2}$/.test(x.country))) return 'country'
  if (x.email !== undefined && x.email !== null
    && (typeof x.email !== 'string' || x.email.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(x.email))) return 'email'
  if (x.mail !== undefined && typeof x.mail !== 'boolean') return 'mail'
  if (x.billing !== undefined && x.billing !== null
    && (typeof x.billing !== 'string' || x.billing.length > 254 || !/^[^@\s]+@[^@\s]+$/.test(x.billing))) return 'billing'
  if (x.lang !== undefined && x.lang !== null && !ACCOUNT_LANGS.includes(x.lang as AccountLang)) return 'lang'
  if (!Number.isInteger(x.iat) || !Number.isInteger(x.exp)) return 'times'
  if ((x.exp as number) <= (x.iat as number) || (x.exp as number) - (x.iat as number) > NETWORK_TOKEN_SECONDS) return 'lifetime'
  return null
}

export async function importSigningKey(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', asBuffer(fromB64url(pkcs8B64.trim().replace(/\s+/g, ''))), { name: 'Ed25519' }, false, ['sign'])
}
export async function importPublicKey(rawB64url: string): Promise<CryptoKey> {
  const raw = fromB64url(rawB64url.trim())
  if (raw.length !== 32) throw new Error('An Ed25519 public key is 32 bytes')
  return crypto.subtle.importKey('raw', asBuffer(raw), { name: 'Ed25519' }, false, ['verify'])
}

export async function signNetworkToken(payload: NetworkTokenPayload, key: CryptoKey): Promise<string> {
  const problem = payloadProblem(payload)
  if (problem) throw new Error(`Network token payload: ${problem}`)
  const body = b64url(utf8(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, asBuffer(utf8(NETWORK_TOKEN_DOMAIN + body))))
  return `${body}.${b64url(sig)}`
}

export type VerifyResult =
  | { ok: true; payload: NetworkTokenPayload }
  | { ok: false; reason: 'malformed' | 'signature' | 'payload' | 'expired' | 'not_yet' | 'other_clinic' }

/**
 * A token for THIS clinic, signed by the Network, still alive. `clinic` is the
 * clinic's own Network id from its settings: a token for another clinic fails
 * here, whatever else it says.
 */
export async function verifyNetworkToken(token: string, key: CryptoKey, clinic: string, nowSeconds: number): Promise<VerifyResult> {
  const parts = typeof token === 'string' ? token.split('.') : []
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4000) return { ok: false, reason: 'malformed' }
  let sig: Uint8Array
  try { sig = fromB64url(parts[1]) } catch { return { ok: false, reason: 'malformed' } }
  const good = await crypto.subtle.verify({ name: 'Ed25519' }, key, asBuffer(sig), asBuffer(utf8(NETWORK_TOKEN_DOMAIN + parts[0])))
  if (!good) return { ok: false, reason: 'signature' }
  let payload: unknown
  try { payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0]))) } catch { return { ok: false, reason: 'malformed' } }
  if (payloadProblem(payload)) return { ok: false, reason: 'payload' }
  const p = payload as NetworkTokenPayload
  if (p.aud.toLowerCase() !== clinic.toLowerCase()) return { ok: false, reason: 'other_clinic' }
  if (p.exp + CLOCK_SKEW_SECONDS < nowSeconds) return { ok: false, reason: 'expired' }
  if (p.iat - CLOCK_SKEW_SECONDS > nowSeconds) return { ok: false, reason: 'not_yet' }
  return { ok: true, payload: p }
}

/** A new key pair: the private key (PKCS#8, base64url) for the Network's secrets, the public key (raw, base64url) for the clinics. */
export async function makeNetworkKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const priv = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey))
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { privateKey: b64url(priv), publicKey: b64url(pub) }
}
