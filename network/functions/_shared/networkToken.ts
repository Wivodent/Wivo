/**
 * The Network's Edge Function `network-token` (docs/PLAN-NETWORK-1.md, N2):
 *
 *   POST { clinicId } with the account's own token (aal2)
 *   → { token, expiresIn, apiUrl }   a signed token for that ONE clinic
 *
 * The database decides first, as the account (token_claims: the second
 * factor, a profile, a connection to that clinic that is not ended); only then
 * is the token signed with the Network's private key.
 */
import { NETWORK_ISSUER, NETWORK_TOKEN_SECONDS, signNetworkToken, type AccountKind, type AccountRole } from './generated/token.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ClaimsRow {
  account_id: string
  connection_id: string
  name: string
  kind: AccountKind
  role: AccountRole
  company: string | null
  country: string | null
  clinic_id: string
  api_url: string
}

export interface NetworkTokenDeps {
  /** token_claims(p_clinic), called AS THE ACCOUNT. */
  claims: (clinicId: string) => Promise<ClaimsRow | null>
  key: CryptoKey
  nowSeconds: () => number
}

export async function handleNetworkToken(body: unknown, deps: NetworkTokenDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const clinicId = (body as { clinicId?: unknown } | null)?.clinicId
  if (typeof clinicId !== 'string' || !UUID.test(clinicId)) return { status: 400, body: { error: 'bad request' } }
  const row = await deps.claims(clinicId)
  if (!row) return { status: 403, body: { error: 'not allowed' } }
  const iat = deps.nowSeconds()
  const token = await signNetworkToken({
    v: 1, iss: NETWORK_ISSUER, aud: row.clinic_id, sub: row.account_id, conn: row.connection_id,
    name: row.name, kind: row.kind, role: row.role, company: row.company ?? null, country: row.country ?? null,
    iat, exp: iat + NETWORK_TOKEN_SECONDS,
  }, deps.key)
  return { status: 200, body: { token, expiresIn: NETWORK_TOKEN_SECONDS, apiUrl: row.api_url } }
}
