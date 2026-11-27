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
import type { CatalogueItem, ClientOrderStatus, WivoOrderV1 } from '@shared/network/order'

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
  messages: number
}

export interface ClientOrderDetail {
  id: string
  created_at: string
  payload: WivoOrderV1
  status: ClientOrderStatus
  reject_reason: string | null
  messages: { id: string; from_client: boolean; body: string; created_at: string }[] | null
  files: { id: string; file_name: string; size: number; created_at: string }[] | null
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
    order: (orderId: string) => call<ClientOrderDetail>(clinicId, apiUrl, session, 'order', { orderId }),
    newOrder: (order: WivoOrderV1) => call<string>(clinicId, apiUrl, session, 'new_order', { order }),
    message: (orderId: string, body: string) => call<string>(clinicId, apiUrl, session, 'message', { orderId, body }),
    end: async () => { await call(clinicId, apiUrl, session, 'end'); forget(clinicId) },
    download: (fileId: string, name: string) => call<{ url: string }>(clinicId, apiUrl, session, 'download', { fileId, name }),
    /** One file onto an order: a place for it, the bytes straight to the clinic's storage, then "done". */
    upload: async (orderId: string, file: File) => {
      const bytes = await file.arrayBuffer()
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('')
      const slot = await call<{ fileId: string; uploadUrl: string }>(clinicId, apiUrl, session, 'upload',
        { orderId, name: file.name.replace(/[/\\]/g, '_').slice(0, 200), size: file.size, sha256: sha, mime: file.type || null })
      if (!slot.uploadUrl?.startsWith(`${apiUrl}/storage/v1/`)) throw new NetworkError('bad_upload')
      const put = await fetch(slot.uploadUrl, { method: 'PUT', body: bytes, headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' } })
      if (!put.ok) throw new NetworkError('upload_failed')
      await call(clinicId, apiUrl, session, 'upload_done', { fileId: slot.fileId })
    },
  }
}

export const forgetClinicSession = forget
