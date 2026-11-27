/**
 * The Network's Edge Function `network-clinic` (docs/NETWORK-SETUP.md, A8):
 * a clinic reads or changes its own directory entry.
 *
 *   POST { request }   a request signed with the clinic's private key
 *                      (shared/network/clinicRequest.ts)
 *   → { listed, inviteCode, name, city, country }
 *
 * No account and no anon key: the signature is the only proof. The request
 * names its clinic; that clinic's public key (kept in its directory row)
 * must have signed it, within a minute of now. A change is taken only with a
 * later time than the last one (clinic_set_listed), so a replay does nothing.
 * Every refusal looks the same from outside ("not allowed"), whatever the
 * reason: an unknown clinic, no key, a wrong signature.
 */
import { claimedClinic, importClinicPublicKey, verifyClinicRequest, type DirectoryEntry } from './generated/clinicRequest.ts'

export interface EntryRow { listed: boolean; invite_code: string; name: string; city: string | null; country: string }

export interface NetworkClinicDeps {
  /** clinic_request_key(p_clinic), with the service key. */
  publicKey: (clinicId: string) => Promise<string | null>
  /** clinic_own_entry(p_clinic). */
  entry: (clinicId: string) => Promise<EntryRow | null>
  /** clinic_set_listed(p_clinic, p_listed, p_at): 'older' when a later change was taken already. */
  setListed: (clinicId: string, listed: boolean, atMs: number) => Promise<EntryRow | 'older' | null>
  nowMs: () => number
}

type Answer = { status: number; body: Record<string, unknown> }
const notAllowed: Answer = { status: 403, body: { error: 'not_allowed' } }

const asEntry = (r: EntryRow): DirectoryEntry =>
  ({ listed: r.listed, inviteCode: r.invite_code, name: r.name, city: r.city ?? null, country: r.country })

export async function handleNetworkClinic(body: unknown, deps: NetworkClinicDeps): Promise<Answer> {
  const request = (body as { request?: unknown } | null)?.request
  const clinic = claimedClinic(request)
  if (!clinic) return { status: 400, body: { error: 'bad_request' } }

  const raw = await deps.publicKey(clinic)
  if (!raw) return notAllowed
  let key: CryptoKey
  try { key = await importClinicPublicKey(raw) } catch { return notAllowed }

  const v = await verifyClinicRequest(request as string, key, clinic, deps.nowMs())
  if (!v.ok) return v.reason === 'stale_clock' ? { status: 401, body: { error: 'clock' } } : notAllowed

  if (v.payload.op === 'get') {
    const row = await deps.entry(clinic)
    return row ? { status: 200, body: { ...asEntry(row) } } : notAllowed
  }
  const row = await deps.setListed(clinic, v.payload.listed as boolean, v.payload.iat)
  if (row === 'older') return { status: 409, body: { error: 'older_request' } }
  return row ? { status: 200, body: { ...asEntry(row) } } : notAllowed
}
