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
  /** Network 003; absent before it. */
  email?: string | null
  email_notifications?: boolean
}

export interface NetworkTokenDeps {
  /** token_claims(p_clinic), called AS THE ACCOUNT. */
  claims: (clinicId: string) => Promise<ClaimsRow | null>
  /** token_contact(p_clinic) (Network 003), AS THE ACCOUNT; null when it is not there. */
  contact?: (clinicId: string) => Promise<{ email: string | null; email_notifications: boolean } | null>
  /** token_billing(p_clinic) (Network 004), AS THE ACCOUNT; undefined when the Network does not have it yet. */
  billing?: (clinicId: string) => Promise<string | null | undefined>
  key: CryptoKey
  nowSeconds: () => number
}

export async function handleNetworkToken(body: unknown, deps: NetworkTokenDeps): Promise<{ status: number; body: Record<string, unknown> }> {
  const clinicId = (body as { clinicId?: unknown } | null)?.clinicId
  if (typeof clinicId !== 'string' || !UUID.test(clinicId)) return { status: 400, body: { error: 'bad request' } }
  const claims = await deps.claims(clinicId)
  if (!claims) return { status: 403, body: { error: 'not allowed' } }
  const contact = deps.contact ? await deps.contact(clinicId).catch(() => null) : null
  const row: ClaimsRow = contact ? { ...claims, email: contact.email, email_notifications: contact.email_notifications } : claims
  // Network 004: the billing e-mail, when the Network has the column (null: the account gave none).
  const billing = deps.billing ? await deps.billing(clinicId).catch(() => undefined) : undefined
  const iat = deps.nowSeconds()
  const token = await signNetworkToken({
    v: 1, iss: NETWORK_ISSUER, aud: row.clinic_id, sub: row.account_id, conn: row.connection_id,
    name: row.name, kind: row.kind, role: row.role, company: row.company ?? null, country: row.country ?? null,
    ...(row.email !== undefined ? { email: row.email ?? null, mail: row.email_notifications ?? true } : {}),
    ...(billing !== undefined ? { billing } : {}),
    iat, exp: iat + NETWORK_TOKEN_SECONDS,
  }, deps.key)
  return { status: 200, body: { token, expiresIn: NETWORK_TOKEN_SECONDS, apiUrl: row.api_url } }
}
