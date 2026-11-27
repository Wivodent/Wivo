/**
 * The clinic's Edge Function `network-client` (docs/PLAN-NETWORK-1.md): the
 * ONE door for an outside client of the Wivo Network.
 *
 *   { action: 'connect', networkToken }   → { state } or { state: 'confirmed', session, expires_at, can_see, clinic }
 *   { action, session, … }                 the client's own orders, files, messages, catalogue
 *
 * `connect` checks the Network token here (Ed25519, the Network's public key
 * from this clinic's settings, `aud` = this clinic's Network id, alive) and
 * only then asks the database. Every other action carries the session the
 * database gave, and the database checks it on every call (live, connection
 * confirmed, portal on): no call to the Network, so a Network that is down
 * does not stop a session already given (N4).
 *
 * The database is called with the service key, and only the client_*
 * functions, which are granted to the service role alone (sql/138, N5).
 * Every refusal is one of a few fixed answers: the database's own words never
 * reach the caller.
 */
import { importPublicKey, verifyNetworkToken, fromB64url } from './generated/networkToken.ts'
import { orderProblems } from './generated/order.ts'

export const DOWNLOAD_SECONDS = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SESSION = /^[0-9a-f]{64}$/
const SHA256 = /^[0-9a-f]{64}$/i
const MAX_FILE = 2 * 1024 * 1024 * 1024
/** sql/145: why a delivery went wrong. */
const PROBLEM_REASONS: readonly string[] = ['not_arrived', 'damaged', 'wrong_item', 'missing_parts', 'other']

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

export interface NetworkSettingsRow {
  org_id: string
  enabled: boolean
  network_public_key: string | null
  session_hours: number
}

export interface NetworkClientDeps {
  /** A database function with the service key. */
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>
  nowSeconds: () => number
  signDownload: (path: string, seconds: number, name?: string) => Promise<string | null>
  signUpload: (path: string) => Promise<{ url: string; token: string } | null>
}

export interface Answer { status: number; body: Record<string, unknown> }

const bad: Answer = { status: 400, body: { error: 'bad_request' } }
const sessionGone: Answer = { status: 401, body: { error: 'session' } }
const notAllowed: Answer = { status: 403, body: { error: 'not_allowed' } }

/** The database's refusal, said as one of the fixed answers. */
function refusal(e: { code?: string; message?: string }): Answer {
  if (/Session not valid/.test(e.message ?? '')) return sessionGone
  if (e.code === '42501') return notAllowed
  if (e.code === '54000') return { status: 429, body: { error: 'too_many' } }
  if (e.code === '22023') return { status: 400, body: { error: 'invalid' } }
  // sql/140: a reference the client typed that the clinic already has.
  if (e.code === '23505') return { status: 409, body: { error: 'duplicate_reference' } }
  return { status: 500, body: { error: 'failed' } }
}

/** The `aud` of a token, read BEFORE it is checked: only to find which key checks it. */
function audienceOf(token: string): string | null {
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64url(token.split('.')[0] ?? '')))
    return typeof p?.aud === 'string' && UUID.test(p.aud) ? p.aud : null
  } catch { return null }
}

const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null)

export async function handleNetworkClient(body: unknown, deps: NetworkClientDeps): Promise<Answer> {
  if (!body || typeof body !== 'object') return bad
  const b = body as Record<string, unknown>
  const action = b.action

  if (action === 'connect') {
    const token = str(b.networkToken, 4000)
    const aud = token ? audienceOf(token) : null
    if (!token || !aud) return bad
    const { data, error } = await deps.rpc('network_settings_for', { p_network_clinic: aud })
    const s = Array.isArray(data) ? (data[0] as NetworkSettingsRow | undefined) : undefined
    if (error || !s || !s.enabled || !s.network_public_key) return { status: 403, body: { error: 'not_taking_orders' } }
    let key: CryptoKey
    try { key = await importPublicKey(s.network_public_key) } catch { return { status: 500, body: { error: 'not_set_up' } } }
    const v = await verifyNetworkToken(token, key, aud, deps.nowSeconds())
    if (!v.ok) return { status: 401, body: { error: 'network_token', reason: v.reason } }
    const p = v.payload
    const r = await deps.rpc('network_connect', {
      p_network_clinic: p.aud, p_account: p.sub, p_connection: p.conn,
      p_profile: { name: p.name, kind: p.kind, role: p.role, company: p.company, country: p.country },
    })
    if (r.error) return refusal(r.error)
    // The address and the e-mail choice the token carries (Network 003), for the
    // clinic's e-mails about orders (sql/142). A database without 142 says no:
    // that changes nothing about the connection.
    if (p.email !== undefined) {
      await deps.rpc('client_set_contact', { p_network_clinic: p.aud, p_account: p.sub, p_email: p.email, p_mail: p.mail ?? true }).catch(() => null)
    }
    // The billing e-mail the token carries (Network 004), onto the client's record here (sql/152).
    // A database without 152 says no: that changes nothing about the connection.
    if (p.billing !== undefined) {
      await deps.rpc('client_set_billing', { p_network_clinic: p.aud, p_account: p.sub, p_billing: p.billing }).catch(() => null)
    }
    return { status: 200, body: r.data as Record<string, unknown> }
  }

  const session = typeof b.session === 'string' && SESSION.test(b.session) ? b.session : null
  if (!session) return sessionGone
  const call = async (fn: string, args: Record<string, unknown> = {}): Promise<Answer> => {
    const r = await deps.rpc(fn, { p_session: session, ...args })
    if (r.error) return refusal(r.error)
    return { status: 200, body: { data: r.data } }
  }
  const id = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)

  switch (action) {
    case 'catalog': return call('client_catalog')
    case 'orders': return call('client_orders')
    // The client's notices here (sql/142), and marking them read.
    case 'notifications': return call('client_notifications')
    case 'notifications_read': {
      const ids = Array.isArray(b.ids) ? b.ids.filter(x => typeof x === 'string' && UUID.test(x)).slice(0, 100) : null
      if (Array.isArray(b.ids) && ids!.length !== b.ids.length) return bad
      return call('client_notifications_read', { p_ids: ids })
    }
    // The reference the New order form shows filled in (sql/140); given out only when the order is sent.
    case 'next_ref': return call('client_reference_preview')
    case 'order': {
      const orderId = id(b.orderId)
      return orderId ? call('client_order_detail', { p_order: orderId }) : bad
    }
    // sql/153: the client approves or declines the clinic's price for its order.
    case 'price_decision': {
      const orderId = id(b.orderId)
      return orderId && typeof b.approve === 'boolean' ? call('client_price_decision', { p_order: orderId, p_approve: b.approve }) : bad
    }
    case 'new_order': {
      if (orderProblems(b.order).length > 0) return { status: 400, body: { error: 'invalid', problems: orderProblems(b.order) } }
      return call('client_new_order', { p_payload: b.order })
    }
    case 'message': {
      const orderId = id(b.orderId)
      const text = typeof b.body === 'string' ? b.body.trim() : ''
      if (!orderId || text.length < 1 || text.length > 4000) return bad
      return call('client_post_message', { p_order: orderId, p_body: text })
    }
    case 'upload': {
      const orderId = id(b.orderId)
      const name = str(b.name, 200)
      const size = typeof b.size === 'number' && Number.isInteger(b.size) && b.size >= 0 && b.size <= MAX_FILE ? b.size : null
      const sha = typeof b.sha256 === 'string' && SHA256.test(b.sha256) ? b.sha256.toLowerCase() : null
      if (!orderId || !name || /[/\\]/.test(name) || size === null || !sha) return bad
      const r = await deps.rpc('client_file_slot', {
        p_session: session, p_order: orderId, p_name: name, p_size: size, p_sha256: sha,
        p_mime: str(b.mime, 120),
      })
      if (r.error) return refusal(r.error)
      const slot = r.data as { file_id: string; path: string }
      const signed = await deps.signUpload(slot.path)
      if (!signed) return { status: 500, body: { error: 'failed' } }
      // The path is the clinic's; the client gets only what uploads to it.
      return { status: 200, body: { fileId: slot.file_id, uploadUrl: signed.url, uploadToken: signed.token } }
    }
    // sql/143: a file with one of the client's own messages; the same upload as an order's files.
    case 'message_upload': {
      const messageId = id(b.messageId)
      const name = str(b.name, 200)
      const size = typeof b.size === 'number' && Number.isInteger(b.size) && b.size >= 0 && b.size <= MAX_FILE ? b.size : null
      const sha = typeof b.sha256 === 'string' && SHA256.test(b.sha256) ? b.sha256.toLowerCase() : null
      if (!messageId || !name || /[/\\]/.test(name) || size === null || !sha) return bad
      const r = await deps.rpc('client_message_file_slot', {
        p_session: session, p_message: messageId, p_name: name, p_size: size, p_sha256: sha, p_mime: str(b.mime, 120),
      })
      if (r.error) return refusal(r.error)
      const slot = r.data as { file_id: string; path: string }
      const signed = await deps.signUpload(slot.path)
      if (!signed) return { status: 500, body: { error: 'failed' } }
      return { status: 200, body: { fileId: slot.file_id, uploadUrl: signed.url, uploadToken: signed.token } }
    }
    // sql/143: Approve, or Request changes with a comment.
    case 'review': {
      const messageId = id(b.messageId)
      const decision = b.decision === 'approved' || b.decision === 'changes' ? b.decision : null
      const comment = typeof b.comment === 'string' ? b.comment.trim().slice(0, 4000) : ''
      if (!messageId || !decision || (decision === 'changes' && !comment)) return bad
      return call('client_review', { p_message: messageId, p_decision: decision, p_comment: comment || null })
    }
    // sql/144 (module ratings): how the sent work fitted, the client's rating of the clinic, what it already said.
    case 'fit': {
      const orderId = id(b.orderId)
      const decision = b.decision === 'fitted' || b.decision === 'adjust' ? b.decision : null
      const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 80) : ''
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 4000) : ''
      if (!orderId || !decision || (decision === 'adjust' && (!reason || !note))) return bad
      return call('client_fit', { p_order: orderId, p_decision: decision, p_reason: reason || null, p_note: note || null })
    }
    case 'rate_clinic': {
      const orderId = id(b.orderId)
      const score = typeof b.score === 'number' && Number.isInteger(b.score) && b.score >= 1 && b.score <= 5 ? b.score : null
      const comment = typeof b.comment === 'string' ? b.comment.trim().slice(0, 1000) : ''
      if (!orderId || score === null) return bad
      return call('client_rate_clinic', { p_order: orderId, p_score: score, p_comment: comment || null })
    }
    // sql/145: the order arrived, or a problem with the delivery (a reason and a text; photos go with its message).
    case 'received': {
      const orderId = id(b.orderId)
      return orderId ? call('client_received', { p_order: orderId }) : bad
    }
    case 'problem': {
      const orderId = id(b.orderId)
      const reason = typeof b.reason === 'string' && PROBLEM_REASONS.includes(b.reason) ? b.reason : null
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 4000) : ''
      if (!orderId || !reason || !note) return bad
      return call('client_report_problem', { p_order: orderId, p_reason: reason, p_note: note })
    }
    case 'feedback': {
      const orderId = id(b.orderId)
      return orderId ? call('client_feedback', { p_order: orderId }) : bad
    }
    case 'upload_done': {
      const fileId = id(b.fileId)
      return fileId ? call('client_file_done', { p_file: fileId }) : bad
    }
    case 'download': {
      const fileId = id(b.fileId)
      if (!fileId) return bad
      const r = await deps.rpc('client_file_path', { p_session: session, p_file: fileId })
      if (r.error || typeof r.data !== 'string') return r.error ? refusal(r.error) : notAllowed
      const url = await deps.signDownload(r.data, DOWNLOAD_SECONDS, str(b.name, 200) ?? undefined)
      return url ? { status: 200, body: { url, expiresIn: DOWNLOAD_SECONDS } } : { status: 500, body: { error: 'failed' } }
    }
    case 'end': return call('client_end')
    default: return bad
  }
}
