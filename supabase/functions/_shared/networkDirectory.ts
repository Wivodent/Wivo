/**
 * The clinic's Edge Function `network-directory` (docs/NETWORK-SETUP.md, B5):
 * the owner reads or changes this clinic's Wivo Network directory entry.
 *
 *   { action: 'get' }                        → { listed, inviteCode, name, city, country }
 *   { action: 'set_listed', listed: bool }   → the same, after the change
 *
 * The order of the checks:
 *   1. the second factor (the session, asked of the database as the user);
 *   2. the database, AS THE USER: network_settings is readable only by the
 *      owner (sql/138 row security), so no row = not the owner (or nothing
 *      set up), and the Network number comes from there, never from the call;
 *   3. listing needs orders on (a directory entry that refuses orders helps
 *      nobody); hiding is always allowed;
 *   4. only then the clinic's private key signs a request for the Network
 *      (shared/network/clinicRequest.ts), and only a well-formed answer is
 *      passed on.
 */
import {
  CLINIC_REQUEST_AUDIENCE, clinicNonce, directoryEntryOf, signClinicRequest,
} from './generated/clinicRequest.ts'

export interface OwnerSettings { enabled: boolean; network_clinic_id: string | null }

export interface NetworkDirectoryDeps {
  hasMfa: () => Promise<boolean>
  /** network_settings, read AS THE USER (owner only by row security); null when nothing comes back. */
  ownerSettings: () => Promise<OwnerSettings | null>
  /** NETWORK_CLINIC_KEY imported; null when the secret is missing or broken. */
  key: () => Promise<CryptoKey | null>
  /** NETWORK_URL: https://<ref>.supabase.co, or null. */
  networkUrl: string | null
  nowMs: () => number
  /** POST JSON to the Network; null when it could not be reached. */
  post: (url: string, body: unknown) => Promise<{ status: number; data: unknown } | null>
  nonce?: () => string
}

type Answer = { status: number; body: Record<string, unknown> }

export async function handleNetworkDirectory(body: unknown, deps: NetworkDirectoryDeps): Promise<Answer> {
  const b = (body ?? {}) as { action?: unknown; listed?: unknown }
  if (b.action !== 'get' && b.action !== 'set_listed') return { status: 400, body: { error: 'bad_request' } }
  if (b.action === 'set_listed' && typeof b.listed !== 'boolean') return { status: 400, body: { error: 'bad_request' } }

  if (!(await deps.hasMfa())) return { status: 403, body: { error: 'second_factor' } }
  const settings = await deps.ownerSettings()
  if (!settings) return { status: 403, body: { error: 'not_allowed' } }
  if (!settings.network_clinic_id) return { status: 409, body: { error: 'not_set_up' } }
  if (b.action === 'set_listed' && b.listed === true && !settings.enabled) return { status: 409, body: { error: 'orders_off' } }

  const key = await deps.key()
  if (!key || !deps.networkUrl || !/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(deps.networkUrl)) {
    return { status: 503, body: { error: 'not_set_up' } }
  }

  const request = await signClinicRequest({
    v: 1, aud: CLINIC_REQUEST_AUDIENCE, clinic: settings.network_clinic_id, op: b.action,
    ...(b.action === 'set_listed' ? { listed: b.listed as boolean } : {}),
    iat: deps.nowMs(), nonce: (deps.nonce ?? clinicNonce)(),
  }, key)

  const res = await deps.post(`${deps.networkUrl}/functions/v1/network-clinic`, { request })
  if (!res) return { status: 502, body: { error: 'network_unreachable' } }
  if (res.status === 200) {
    const entry = directoryEntryOf(res.data)
    return entry ? { status: 200, body: { ...entry } } : { status: 502, body: { error: 'network_unreachable' } }
  }
  if (res.status === 409) return { status: 409, body: { error: 'try_again' } }
  if (res.status === 403) return { status: 502, body: { error: 'network_refused' } }
  return { status: 502, body: { error: 'network_unreachable' } }
}
