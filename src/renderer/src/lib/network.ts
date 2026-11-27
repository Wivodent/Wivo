/**
 * The phone app's Network mode (docs/PLAN-NETWORK-1.md): a Wivo Network
 * account's own client of the Network project, and its calls to a clinic's
 * `network-client` function.
 *
 * Two different servers, never mixed up:
 *   the Network   (VITE_NETWORK_URL): the account, the directory, connections,
 *                 and a 5-minute token for one clinic
 *   a clinic      (the directory's api_url): orders, files, messages, through
 *                 that clinic's network-client, with the session it gave
 *
 * The clinic's session lives in this tab only (sessionStorage): closing the
 * tab forgets it, and the Network token is asked for again.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { CatalogueItem, ClientOrderStatus, WivoOrder } from '@shared/network/order'
import { cleanForUpload, sha256Hex } from './fileClean'

const URL_ = (import.meta.env.VITE_NETWORK_URL ?? '').trim()
const KEY = (import.meta.env.VITE_NETWORK_ANON_KEY ?? '').trim()

/** Whether this build knows the Network at all. */
export const networkConfigured: boolean = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(URL_) && KEY.length > 20

export const network: SupabaseClient | null = networkConfigured
  ? createClient(URL_, KEY, { auth: { storageKey: 'wivo-network-auth', persistSession: true, autoRefreshToken: true } })
  : null

export type AccountKind = 'person' | 'company'
export type AccountRole = 'technician' | 'doctor' | 'clinic' | 'lab'

export interface Account {
  id: string
  kind: AccountKind
  role: AccountRole
  display_name: string
  company_name: string | null
  country: string | null
  city: string | null
  /** Network 003: e-mails from clinics about orders. Absent before it. */
  email_notifications?: boolean
  /** Network 004: where invoices go, when not the sign-in address (empty: none). Absent before it. */
  billing_email?: string | null
  /** Network 005: the Terms of Use version accepted and when (written only by accept_terms). Absent before it. */
  accepted_terms_version?: string | null
  accepted_terms_at?: string | null
}

export interface DirectoryClinic { id: string; name: string; country: string; city: string | null; api_url: string }

export interface Connection {
  id: string
  clinic_id: string
  state: 'requested' | 'confirmed' | 'ended'
  requested_at: string
  clinic?: DirectoryClinic
}

export interface ClientOrderSummary {
  id: string
  created_at: string
  work_type: string
  patient_ref: string
  due: string | null
  status: ClientOrderStatus
  reject_reason: string | null
  /** sql/146: why the clinic cancelled it. */
  cancel_reason?: string | null
  messages: number
  /** sql/153: the price as the client may see it, and its state. */
  price?: number | null
  price_state?: OrderPriceState
}

/** sql/153: an estimate at the catalogue's prices; needs a quote; quoted (to approve); approved; declined; the confirmed price. */
export type OrderPriceState = 'estimated' | 'needs_quote' | 'quoted' | 'approved' | 'declined' | 'confirmed'

export interface ClientOrderDetail {
  id: string
  created_at: string
  payload: WivoOrder
  status: ClientOrderStatus
  reject_reason: string | null
  /** sql/146: why the clinic cancelled it. */
  cancel_reason?: string | null
  /** sql/153: the price as the client may see it, and its state. */
  price?: number | null
  price_state?: OrderPriceState
  /** sql/143: needs_review on the clinic's messages; review_of / review_state on the client's answers. */
  messages: { id: string; from_client: boolean; body: string; created_at: string; needs_review?: boolean; review_of?: string | null; review_state?: 'approved' | 'changes' | null
    /** sql/145: the fit answer, and the delivery answers (Received, a problem, the clinic's resolution) with their reason. */
    fit_state?: 'fitted' | 'adjust' | null; delivery_state?: 'received' | 'problem' | 'resolved' | null; delivery_reason?: string | null }[] | null
  /** sql/143: the message a file came with (null: sent with the order), and who sent it. */
  files: { id: string; file_name: string; size: number; created_at: string; message_id?: string | null; from_client?: boolean; mime_type?: string | null }[] | null
}

/** What the client already said on an order (sql/144), and whether the clinic has feedback on. */
export interface OrderFeedback {
  enabled: boolean
  /** sql/145: the client has it (absent before 145: read as received once sent). */
  received?: boolean
  received_at?: string | null
  /** sql/145: the latest delivery problem on the order, open or resolved. */
  problem?: { reason: string; created_at: string; resolved_at: string | null; resolution: string | null } | null
  fit: { decision: 'fitted' | 'adjust'; reason: string | null; created_at: string } | null
  rating: { score: number; comment: string | null; created_at?: string; updated_at?: string } | null
}

/** A notice to the client from one clinic (sql/142): what happened, never a message's text. */
export interface ClientNotice {
  id: string
  kind: 'message' | 'accepted' | 'rejected' | 'ready' | 'sent' | 'connected' | 'declined' | 'received_reminder' | 'problem_resolved' | 'cancelled' | 'reinstated' | 'quoted'
  order_id: string | null
  ref: string | null
  reason: string | null
  created_at: string
  read_at: string | null
}

export interface ClinicSession { session: string; expires_at: string; clinic: string; can_see: Record<string, boolean> }

/** A clinic's address as the directory gives it: only a Supabase project, nothing else. */
export const validApiUrl = (u: string): boolean => /^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(u)

export class NetworkError extends Error {
  constructor(public code: string) { super(code) }
}

function need(): SupabaseClient {
  if (!network) throw new NetworkError('not_configured')
  return network
}

// ── The Network ─────────────────────────────────────────────────────────────

export async function myAccount(): Promise<Account | null> {
  const { data, error } = await need().from('account').select('*').maybeSingle()
  if (error) throw error
  return data as Account | null
}

export async function saveAccount(a: Omit<Account, 'id'>, isNew: boolean): Promise<void> {
  const n = need()
  const { data: u } = await n.auth.getUser()
  if (!u.user) throw new NetworkError('signed_out')
  const row = { ...a, updated_at: new Date().toISOString() }
  const { error } = isNew
    ? await n.from('account').insert({ id: u.user.id, ...row })
    : await n.from('account').update(row).eq('id', u.user.id)
  if (error) throw error
}

/** Network 005: the account accepts the Terms of Use and the Privacy Notice of this version, now (lib/legal). */
export async function acceptTerms(version: string): Promise<void> {
  const { error } = await need().rpc('accept_terms', { p_version: version })
  if (error) throw error
}

/** The sign-in user's metadata (sign-up writes the accepted terms version there, lib/legal). */
export async function signInMetadata(): Promise<Record<string, unknown> | null> {
  const { data } = await need().auth.getUser()
  return (data.user?.user_metadata as Record<string, unknown> | undefined) ?? null
}

export async function directory(search: string): Promise<DirectoryClinic[]> {
  let q = need().from('clinic').select('id, name, country, city, api_url').eq('listed', true).order('name').limit(50)
  const s = search.trim()
  if (s) q = q.ilike('name', `%${s.replace(/[%_]/g, '')}%`)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as DirectoryClinic[]
}

export async function clinicByInvite(code: string): Promise<DirectoryClinic | null> {
  const { data, error } = await need().rpc('clinic_by_invite', { p_code: code })
  if (error) throw error
  return ((data ?? []) as DirectoryClinic[])[0] ?? null
}

export async function myConnections(): Promise<Connection[]> {
  const n = need()
  const { data, error } = await n.from('connection').select('*').order('requested_at', { ascending: false })
  if (error) throw error
  const list = (data ?? []) as Connection[]
  if (list.length === 0) return list
  const { data: clinics } = await n.from('clinic').select('id, name, country, city, api_url').in('id', list.map(c => c.clinic_id))
  const byId = new Map(((clinics ?? []) as DirectoryClinic[]).map(c => [c.id, c]))
  return list.map(c => ({ ...c, clinic: byId.get(c.clinic_id) }))
}

export async function requestConnection(clinicId: string): Promise<void> {
  const { error } = await need().rpc('request_connection', { p_clinic: clinicId })
  if (error) throw error
}

export async function endConnection(connectionId: string): Promise<void> {
  const { error } = await need().rpc('end_connection', { p_connection: connectionId })
  if (error) throw error
}

async function reportState(connectionId: string, state: 'confirmed' | 'ended'): Promise<void> {
  await need().rpc('report_connection_state', { p_connection: connectionId, p_state: state })
}

async function networkToken(clinicId: string): Promise<string> {
  const { data, error } = await need().functions.invoke('network-token', { body: { clinicId } })
  if (error || typeof data?.token !== 'string') throw new NetworkError('no_token')
  return data.token
}

// ── A clinic ────────────────────────────────────────────────────────────────

const SESSION_KEY = (clinicId: string) => `wivo-network-session:${clinicId}`

function storedSession(clinicId: string): ClinicSession | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY(clinicId)) ?? 'null') as ClinicSession | null
    return s && new Date(s.expires_at).getTime() > Date.now() + 60_000 ? s : null
  } catch { return null }
}
const forget = (clinicId: string) => { try { sessionStorage.removeItem(SESSION_KEY(clinicId)) } catch { /* private mode */ } }

async function post(apiUrl: string, body: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> }> {
  if (!validApiUrl(apiUrl)) throw new NetworkError('bad_clinic')
  const res = await fetch(`${apiUrl}/functions/v1/network-client`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-wivo-version': __APP_VERSION__ },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> = {}
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

/**
 * Ask the clinic in: a fresh Network token, then the clinic decides. A
 * confirmed connection gets a session; a request waits for the owner.
 */
export async function connect(conn: Connection & { clinic: DirectoryClinic }): Promise<{ state: Connection['state']; session?: ClinicSession }> {
  const kept = storedSession(conn.clinic_id)
  if (kept) return { state: 'confirmed', session: kept }
  const token = await networkToken(conn.clinic_id)
  const { status, data } = await post(conn.clinic.api_url, { action: 'connect', networkToken: token })
  if (status !== 200) throw new NetworkError(String(data.error ?? 'failed'))
  const state = data.state as Connection['state']
  if (state === 'confirmed' && typeof data.session === 'string') {
    const s: ClinicSession = { session: data.session, expires_at: String(data.expires_at), clinic: String(data.clinic ?? conn.clinic.name), can_see: (data.can_see ?? {}) as Record<string, boolean> }
    try { sessionStorage.setItem(SESSION_KEY(conn.clinic_id), JSON.stringify(s)) } catch { /* private mode */ }
    if (conn.state === 'requested') void reportState(conn.id, 'confirmed').catch(() => {})
    return { state, session: s }
  }
  if (state === 'ended' && conn.state !== 'ended') void reportState(conn.id, 'ended').catch(() => {})
  return { state }
}

/** One call to the clinic with its session. A session it no longer takes is forgotten. */
async function call<T>(clinicId: string, apiUrl: string, session: string, action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { status, data } = await post(apiUrl, { action, session, ...args })
  if (status === 401) { forget(clinicId); throw new NetworkError('session') }
  if (status !== 200) throw new NetworkError(String(data.error ?? 'failed'))
  return ('data' in data ? data.data : data) as T
}

export function clinicApi(clinicId: string, apiUrl: string, session: string) {
  return {
    catalog: () => call<CatalogueItem[]>(clinicId, apiUrl, session, 'catalog'),
    orders: () => call<ClientOrderSummary[]>(clinicId, apiUrl, session, 'orders'),
    /** The client's notices from this clinic (sql/142); [] from a clinic before it. */
    notices: () => call<ClientNotice[]>(clinicId, apiUrl, session, 'notifications').catch(() => [] as ClientNotice[]),
    /** Marks these notices read, or (no ids) all of them. */
    readNotices: (ids?: string[]) => call<number>(clinicId, apiUrl, session, 'notifications_read', ids ? { ids } : {}),
    /** The reference the clinic would give the next order (sql/140); given out only when it is sent. */
    nextRef: () => call<string>(clinicId, apiUrl, session, 'next_ref'),
    order: (orderId: string) => call<ClientOrderDetail>(clinicId, apiUrl, session, 'order', { orderId }),
    newOrder: (order: WivoOrder) => call<string>(clinicId, apiUrl, session, 'new_order', { order }),
    message: (orderId: string, body: string) => call<string>(clinicId, apiUrl, session, 'message', { orderId, body }),
    end: async () => { await call(clinicId, apiUrl, session, 'end'); forget(clinicId) },
    download: (fileId: string, name: string) => call<{ url: string }>(clinicId, apiUrl, session, 'download', { fileId, name }),
    /** One file onto an order: a place for it, the bytes straight to the clinic's storage, then "done". */
    upload: (orderId: string, file: File) => sendFile(clinicId, apiUrl, session, 'upload', { orderId }, file),
    /** One file with one of the client's own messages (sql/143). */
    messageUpload: (messageId: string, file: File) => sendFile(clinicId, apiUrl, session, 'message_upload', { messageId }, file),
    /** sql/144: how the sent work fitted (Needs adjustment: a reason and a text); returns the message, for its photos. */
    fit: (orderId: string, decision: 'fitted' | 'adjust', reason?: string, note?: string) =>
      call<string>(clinicId, apiUrl, session, 'fit', { orderId, decision, reason: reason ?? null, note: note ?? null }),
    /** sql/144: the client's rating of this clinic for one order, 1–5. */
    rateClinic: (orderId: string, score: number, comment?: string) =>
      call<null>(clinicId, apiUrl, session, 'rate_clinic', { orderId, score, comment: comment ?? null }),
    /** sql/153: the clinic's price for the order: approved (the work starts) or declined. */
    priceDecision: (orderId: string, approve: boolean) => call<{ approved: boolean }>(clinicId, apiUrl, session, 'price_decision', { orderId, approve }),
    /** sql/145: the order arrived. */
    received: (orderId: string) => call<null>(clinicId, apiUrl, session, 'received', { orderId }),
    /** sql/145: a problem with the delivery (a reason and a text); returns the message, for its photos. */
    reportProblem: (orderId: string, reason: string, note: string) =>
      call<string>(clinicId, apiUrl, session, 'problem', { orderId, reason, note }),
    /** sql/144: whether feedback is on here, and what the client already said on this order. */
    feedback: (orderId: string) => call<OrderFeedback>(clinicId, apiUrl, session, 'feedback', { orderId })
      .catch(() => ({ enabled: false, fit: null, rating: null }) as OrderFeedback),
    /** Approve a message that needs review, or request changes (the comment is required then). */
    review: (messageId: string, decision: 'approved' | 'changes', comment?: string) =>
      call<string>(clinicId, apiUrl, session, 'review', { messageId, decision, comment: comment ?? null }),
  }
}

/**
 * A file to the clinic: cleaned first as every job file is (lib/fileClean:
 * a photo loses its location, camera and dates; a scan the names exporters
 * write into it), then a place for it, the bytes straight to the clinic's
 * storage, then "done".
 */
async function sendFile(clinicId: string, apiUrl: string, session: string, action: 'upload' | 'message_upload', where: Record<string, string>, file: File): Promise<void> {
  const bytes = cleanForUpload(new Uint8Array(await file.arrayBuffer()), file.name)
  const sha = await sha256Hex(bytes)
  const slot = await call<{ fileId: string; uploadUrl: string }>(clinicId, apiUrl, session, action,
    { ...where, name: file.name.replace(/[/\\]/g, '_').slice(0, 200), size: bytes.length, sha256: sha, mime: file.type || null })
  if (!slot.uploadUrl?.startsWith(`${apiUrl}/storage/v1/`)) throw new NetworkError('bad_upload')
  const put = await fetch(slot.uploadUrl, { method: 'PUT', body: bytes.slice().buffer as ArrayBuffer, headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' } })
  if (!put.ok) throw new NetworkError('upload_failed')
  await call(clinicId, apiUrl, session, 'upload_done', { fileId: slot.fileId })
}

export const forgetClinicSession = forget
