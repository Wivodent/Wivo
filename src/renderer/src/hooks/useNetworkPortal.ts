/**
 * The clinic's side of orders through the Wivo Network (sql/138,
 * docs/PLAN-NETWORK-1.md): settings, connection requests, clients, orders,
 * their messages and files. Everything reads through row security (the
 * owner, and whoever reads or edits jobs); every change is a database
 * function that checks the person again. A database without sql/138 shows
 * nothing and says nothing.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useRealtimeInvalidate } from './useRealtimeInvalidate'
import type { WivoOrder } from '@shared/network/order'
import { readDirectoryEntry, setDirectoryListed, type DirectoryEntry, type DirectoryError } from '../lib/networkDirectory'
import type { OrderJobState } from '../lib/orderView'

export const PORTAL_KEY = ['network_portal'] as const

export interface NetworkSettingsRow {
  org_id: string
  enabled: boolean
  network_public_key: string | null
  network_clinic_id: string | null
  session_hours: number
}

export interface CanSee { status: boolean; messages: boolean; files: boolean; prices: boolean }

export interface NetworkClientRow {
  id: string
  state: 'requested' | 'confirmed' | 'ended'
  kind: 'person' | 'company'
  role: 'technician' | 'doctor' | 'clinic' | 'lab'
  display_name: string
  company_name: string | null
  country: string | null
  customer_id: string | null
  can_see: CanSee
  requested_at: string
  confirmed_at: string | null
  ended_at: string | null
}

export interface ClientOrderRow {
  id: string
  client_id: string
  payload: WivoOrder
  work_type: string
  patient_ref: string
  due: string | null
  status: 'received' | 'accepted' | 'rejected'
  reject_reason: string | null
  job_id: string | null
  created_at: string
}

export interface OrderMessage { id: string; from_client: boolean; body: string; created_at: string; author_id: string | null }
export interface OrderFile { id: string; file_name: string; size: number; created_at: string; completed_at: string | null }

const missing = (code?: string) => code === 'PGRST205' || code === '42P01' || code === 'PGRST202' || code === '42883'

async function rows<T>(q: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<T[]> {
  const { data, error } = await q
  if (error) {
    if (missing(error.code)) return []
    throw error
  }
  return (data ?? []) as T[]
}

/** Mounted once on the Orders page and in the menu: new orders and requests show at once. */
export function usePortalLive(enabled = true): void {
  useRealtimeInvalidate('client_order', [PORTAL_KEY], enabled)
  useRealtimeInvalidate('client_order_message', [PORTAL_KEY], enabled)
  useRealtimeInvalidate('network_client', [PORTAL_KEY], enabled)
}

export function useNetworkSettings(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<NetworkSettingsRow | null>({
    queryKey: [...PORTAL_KEY, 'settings', clinicId],
    enabled: !!clinicId && enabled,
    queryFn: async () => (await rows<NetworkSettingsRow>(supabase.from('network_settings').select('*').limit(1)))[0] ?? null,
  })
}

export function useNetworkClients(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<NetworkClientRow[]>({
    queryKey: [...PORTAL_KEY, 'clients', clinicId],
    enabled: !!clinicId && enabled,
    queryFn: () => rows<NetworkClientRow>(supabase.from('network_client').select('*').order('requested_at', { ascending: false })),
  })
}

export function useClientOrders(enabled = true) {
  const { clinicId } = useAuth()
  return useQuery<ClientOrderRow[]>({
    queryKey: [...PORTAL_KEY, 'orders', clinicId],
    enabled: !!clinicId && enabled,
    queryFn: () => rows<ClientOrderRow>(supabase.from('client_order').select('*').order('created_at', { ascending: false }).limit(500)),
  })
}

export function useOrderThread(orderId: string | null) {
  return useQuery<{ messages: OrderMessage[]; files: OrderFile[] }>({
    queryKey: [...PORTAL_KEY, 'thread', orderId],
    enabled: !!orderId,
    queryFn: async () => ({
      messages: await rows<OrderMessage>(supabase.from('client_order_message').select('*').eq('order_id', orderId!).order('created_at')),
      files: await rows<OrderFile>(supabase.from('client_order_file').select('*').eq('order_id', orderId!).not('completed_at', 'is', null).order('created_at')),
    }),
  })
}

/** What the menu's mark counts: new orders and new requests to connect. */
export function useNewOrderCount(enabled: boolean): number {
  const orders = useClientOrders(enabled).data ?? []
  const clients = useNetworkClients(enabled).data ?? []
  return orders.filter(o => o.status === 'received').length + clients.filter(c => c.state === 'requested').length
}

function useRpc<A extends Record<string, unknown>, R = unknown>(fn: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: A): Promise<R> => {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw error
      return data as R
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: PORTAL_KEY }) },
  })
}

export const useSaveNetworkSettings = () =>
  useRpc<{ p_enabled: boolean; p_public_key: string | null; p_network_clinic: string | null; p_session_hours: number }>('network_save_settings')
export const useConfirmClient = () => useRpc<{ p_client: string; p_list: 'clients' | 'clinics'; p_can_see: CanSee }, string>('network_confirm_client')
export const useClientVisibility = () => useRpc<{ p_client: string; p_can_see: CanSee }>('network_set_client_visibility')
export const useEndClient = () => useRpc<{ p_client: string }>('network_end_client')
export const useAcceptOrder = () => useRpc<{ p_order: string; p_template: string | null }, string>('accept_client_order')
export const useRejectOrder = () => useRpc<{ p_order: string; p_reason: string }>('reject_client_order')
export const usePostOrderMessage = () => useRpc<{ p_order: string; p_body: string }, string>('post_order_message')

/** Which list a request goes to by default: a person under Clients, a clinic or a lab under Clinics. */
export const defaultList = (c: Pick<NetworkClientRow, 'role'>): 'clients' | 'clinics' =>
  c.role === 'clinic' || c.role === 'lab' ? 'clinics' : 'clients'

/** A client's name as the clinic shows it. */
export const clientName = (c: Pick<NetworkClientRow, 'display_name' | 'company_name'> | undefined): string =>
  !c ? '—' : c.company_name ? `${c.company_name} (${c.display_name})` : c.display_name

/**
 * This clinic's own entry in the Network directory (listed, invite code), through network-directory. Owner only.
 * Its own key, not under PORTAL_KEY: every order and request invalidates that, and each read here asks the Network.
 */
export const DIRECTORY_KEY = ['network_directory'] as const
export function useDirectoryEntry(enabled: boolean) {
  const { clinicId } = useAuth()
  return useQuery<DirectoryEntry, DirectoryError>({
    queryKey: [...DIRECTORY_KEY, clinicId],
    enabled: !!clinicId && enabled,
    retry: false,
    staleTime: 60_000,
    queryFn: readDirectoryEntry,
  })
}

export function useSetDirectoryListed() {
  const qc = useQueryClient()
  const { clinicId } = useAuth()
  return useMutation<DirectoryEntry, DirectoryError, boolean>({
    mutationFn: setDirectoryListed,
    onSuccess: entry => { qc.setQueryData([...DIRECTORY_KEY, clinicId], entry) },
  })
}

/** A long id list read in parts: one address holds only so many ids. */
async function inChunks<T>(ids: readonly string[], read: (part: string[]) => Promise<T[]>, size = 100): Promise<T[]> {
  const parts: string[][] = []
  for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size))
  return (await Promise.all(parts.map(read))).flat()
}

/** The Orders page hears the board: a job moved to its last stage or sent changes its order's tab. */
export function useOrderJobsLive(enabled = true): void {
  useRealtimeInvalidate('jobs', [[...PORTAL_KEY, 'jobs']], enabled)
}

export interface OrderCounts { files: Map<string, number>; messages: Map<string, number> }

/**
 * How many finished files and messages each order has, counted from the rows
 * the person may read (row security as for the orders). Two reads for all
 * orders, not one per order.
 */
export function useOrderCounts(orderIds: readonly string[]) {
  const { clinicId } = useAuth()
  const ids = [...orderIds].sort()
  return useQuery<OrderCounts>({
    queryKey: [...PORTAL_KEY, 'counts', clinicId, ids.join(',')],
    enabled: !!clinicId && ids.length > 0,
    queryFn: async () => {
      const count = (list: { order_id: string }[]) => {
        const m = new Map<string, number>()
        for (const r of list) m.set(r.order_id, (m.get(r.order_id) ?? 0) + 1)
        return m
      }
      const [files, messages] = await Promise.all([
        inChunks(ids, part => rows<{ order_id: string }>(supabase.from('client_order_file').select('order_id').in('order_id', part).not('completed_at', 'is', null))),
        inChunks(ids, part => rows<{ order_id: string }>(supabase.from('client_order_message').select('order_id').in('order_id', part))),
      ])
      return { files: count(files), messages: count(messages) }
    },
  })
}

/** The board state of the jobs accepted orders became: which tab each order is in (lib/orderView orderTab). */
export function useOrderJobs(jobIds: readonly string[]) {
  const { clinicId } = useAuth()
  const ids = [...new Set(jobIds)].sort()
  return useQuery<Map<string, OrderJobState>>({
    queryKey: [...PORTAL_KEY, 'jobs', clinicId, ids.join(',')],
    enabled: !!clinicId && ids.length > 0,
    queryFn: async () => {
      const list = await inChunks(ids, part => rows<OrderJobState>(supabase.from('jobs').select('id, status, delivery_status').in('id', part).is('deleted_at', null)))
      return new Map(list.map(j => [j.id, j]))
    },
  })
}
