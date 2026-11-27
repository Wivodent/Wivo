import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import { fetchCustomers } from '../lib/customersRead'
import { usePermissions } from './usePermissions'
import type { Customer, CustomerInput } from '../types/customer'

const QUERY_KEY = ['customers']

/**
 * All customers, archived included — the caller filters.
 *
 * Archived ones are still fetched because history needs their names: a job or
 * an invoice from two years ago points at a customer who may no longer be
 * active, and a picker hiding them would render that history nameless.
 *
 * Whole rows only for View jobs or View payments (owners and admins always);
 * everyone else gets id, name and archived — what a job shows (sql/118).
 */
export function useCustomers() {
  const qc = useQueryClient()
  const { can } = usePermissions()
  const full = can('jobs.read') || can('payments.read')
  // Unique per mount: a realtime topic is global to the Supabase client, so two
  // components using this hook at once would otherwise collide on the topic and
  // the second `.on()` throws. Same reason as usePatients.
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`customers-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => {
        qc.invalidateQueries({ queryKey: QUERY_KEY })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Customer[]>({
    queryKey: [...QUERY_KEY, full ? 'full' : 'basic'],
    queryFn: () => fetchCustomers(full),
  })
}

/**
 * A database without sql/128 has no `kind`: the save is repeated without it,
 * so a client can still be added and changed there (as a clinic).
 */
/** Columns a database may not have yet: kind (sql/128), invoice_language and country (sql/149), automatic invoicing (sql/151). */
const LATER_COLUMNS = ['kind', 'invoice_language', 'country', 'auto_invoice_on', 'auto_invoice_trigger', 'auto_invoice_mode', 'auto_invoice_send', 'billing_email', 'discount_pct', 'client_prices'] as const

const lacksKind = (error: { code?: string; message?: string } | null): boolean =>
  !!error && (error.code === 'PGRST204' || error.code === '42703') && LATER_COLUMNS.some(c => (error.message ?? '').includes(c))

/** The row without the columns the database refused (each named in its message), or all of them. */
function withoutKind<T extends object>(row: T, error?: { message?: string } | null): T {
  const named = LATER_COLUMNS.filter(c => (error?.message ?? '').includes(c))
  const drop = new Set<string>(named.length ? named : LATER_COLUMNS)
  return Object.fromEntries(Object.entries(row).filter(([k]) => !drop.has(k))) as T
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    // Nothing read back: the details are not readable from the table (sql/118).
    mutationFn: async (input: CustomerInput) => {
      const row = { ...input, clinic_id: getActiveClinicId() }
      let { error } = await supabase.from('customers').insert(row)
      if (lacksKind(error)) ({ error } = await supabase.from('customers').insert(withoutKind(row, error)))
      if (lacksKind(error)) ({ error } = await supabase.from('customers').insert(withoutKind(row)))
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CustomerInput> }) => {
      const row = { ...patch, updated_at: new Date().toISOString() }
      let { error } = await supabase.from('customers').update(row).eq('id', id)
      if (lacksKind(error)) ({ error } = await supabase.from('customers').update(withoutKind(row, error)).eq('id', id))
      if (lacksKind(error)) ({ error } = await supabase.from('customers').update(withoutKind(row)).eq('id', id))
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/**
 * Archive, not delete.
 *
 * A customer with invoices behind them is history. `jobs.customer_id` and
 * `invoices.customer_id` are both `on delete set null`, so a real delete would
 * quietly orphan every job and document that named them. Archiving keeps the
 * link and stops the customer being offered.
 */
export function useArchiveCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const { error } = await supabase
        .from('customers')
        .update({
          archived_at: archived ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/**
 * Hard delete. Refused by the caller when the customer has any history — see
 * the archive note above. Kept for the "typed the wrong name, no work yet" case.
 */
export function useDeleteCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
