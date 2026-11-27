import { useEffect, useId } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase, getActiveClinicId } from '../lib/supabase'
import type {
  Invoice, InvoiceFull, InvoiceLine, InvoiceLineInput, Payment, PaymentInput,
  InvoiceStatus, PaymentMethod
} from '../types/invoice'
import { t } from '@/lib/i18n'
import { isLostAnswer } from '../lib/lostAnswer'

const QUERY_KEY = ['invoices']
/** How long realtime waits for the rest of a burst before reloading the list. */
export const REALTIME_SETTLE_MS = 400

/**
 * Invoices with their lines and payments, in one query.
 *
 * Loaded together rather than per-invoice: the list has to show what is still
 * owed on every row, and that is a function of the payments. Fetching those
 * lazily would make the list render totals that are wrong until each row
 * happened to resolve.
 */
export function useInvoices() {
  const qc = useQueryClient()
  // Unique per mount — a realtime topic is global to the Supabase client and
  // re-subscribing to an existing topic throws (the 1.1.4 outage).
  const channelId = useId()

  useEffect(() => {
    // One reload per burst: deleting an invoice with ten lines is a dozen
    // events, and each used to reload every invoice with its lines and
    // payments, on every screen that lists them (the slow delete, 2026-11-27).
    let timer: ReturnType<typeof setTimeout> | null = null
    const soon = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; void qc.invalidateQueries({ queryKey: QUERY_KEY }) }, REALTIME_SETTLE_MS)
    }
    const channel = supabase
      .channel(`invoices-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoice_lines' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, soon)
      .subscribe()
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<InvoiceFull[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('*, lines:invoice_lines(*), payments(*)')
        .order('issue_date', { ascending: false })
        .order('number', { ascending: false })
      if (error) throw error
      return (data as InvoiceFull[]).map(inv => ({
        ...inv,
        lines: [...(inv.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order),
        payments: [...(inv.payments ?? [])].sort((a, b) => a.paid_at.localeCompare(b.paid_at)),
      }))
    }
  })
}

export interface CreateInvoiceInput {
  patient_id: string | null
  /** The addressee's NAME. A patient's or a customer's — see types/invoice.ts. */
  patsient: string
  // Who this is billed to. The DB has a check constraint tying these together:
  // 'customer' requires customer_id, 'patient' requires it to be null.
  customer_id?: string | null
  bill_to_kind?: 'patient' | 'customer'
  period_start?: string | null
  period_end?: string | null
  issue_date: string
  due_date: string | null
  vat_rate: number
  note?: string | null
  /** sql/148 (see types/invoice). */
  language?: 'et' | 'lv' | 'en' | null
  service_date?: string | null
  vat_exempt_note?: string | null
  buyer_reg_code?: string | null
  buyer_vat_number?: string | null
  buyer_address?: string | null
  lines: Omit<InvoiceLineInput, 'invoice_id'>[]
}

/** The invoice columns sql/148 added: left out when the database does not have them yet. */
export const COUNTRY_INVOICE_COLUMNS = ['language', 'service_date', 'vat_exempt_note', 'buyer_reg_code', 'buyer_vat_number', 'buyer_address'] as const

/**
 * Insert one invoice row. A database before sql/148 refuses the new columns:
 * the same row without them (an Estonian invoice loses nothing by it).
 */
export async function insertInvoiceRow(row: Record<string, unknown>): Promise<Invoice> {
  const first = await supabase.from('invoices').insert(row).select().single()
  if (!first.error) return first.data as Invoice
  if (first.error.code !== 'PGRST204' && first.error.code !== '42703') throw first.error
  const plain = Object.fromEntries(Object.entries(row).filter(([k]) => !(COUNTRY_INVOICE_COLUMNS as readonly string[]).includes(k)))
  const again = await supabase.from('invoices').insert(plain).select().single()
  if (again.error) throw again.error
  return again.data as Invoice
}

export function useCreateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateInvoiceInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error(t('useInvoices.noClinicTheInvoiceCannotBe'))

      const { data: userData } = await supabase.auth.getUser()

      // A new invoice is a draft and gets its number only when it is issued
      // (sql/149): a deleted draft leaves no hole in the numbers. A database
      // before 149 wants a number now; the number comes from the database,
      // never from counting rows here (two workstations would pick the same).
      const numberNow = async (): Promise<string> => {
        const { data, error } = await supabase.rpc('next_invoice_number', { p_clinic: clinicId })
        if (error) throw error
        return data as string
      }
      const row = {
        clinic_id: clinicId,
        patient_id: input.patient_id,
        patsient: input.patsient,
        customer_id: input.customer_id ?? null,
        bill_to_kind: input.bill_to_kind ?? 'patient',
        period_start: input.period_start ?? null,
        period_end: input.period_end ?? null,
        issue_date: input.issue_date,
        due_date: input.due_date,
        vat_rate: input.vat_rate,
        note: input.note ?? null,
        language: input.language ?? null,
        service_date: input.service_date ?? null,
        vat_exempt_note: input.vat_exempt_note ?? null,
        buyer_reg_code: input.buyer_reg_code ?? null,
        buyer_vat_number: input.buyer_vat_number ?? null,
        buyer_address: input.buyer_address ?? null,
        created_by: userData?.user?.id ?? null,
      }
      let invoice: Invoice
      try {
        invoice = await insertInvoiceRow(row)
      } catch (e) {
        if ((e as { code?: string }).code !== '23502') throw e
        invoice = await insertInvoiceRow({ ...row, number: await numberNow() })
      }

      if (input.lines.length > 0) {
        const { error: lineError } = await supabase.from('invoice_lines').insert(
          input.lines.map((l, i) => ({ ...l, invoice_id: (invoice as Invoice).id, sort_order: i }))
        )
        // The invoice exists but is empty — surfacing the error beats leaving
        // the user staring at a document that silently lost its lines.
        if (lineError) throw lineError
      }
      return invoice as Invoice
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<Invoice> & { id: string }) => {
      const { data, error } = await supabase
        .from('invoices')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as Invoice
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/**
 * Delete a draft (sql/149: only a draft without payments; the database says
 * so). A lost answer ("Failed to fetch": the request may well have reached the
 * database) is checked before it is reported: gone means deleted.
 */
export function useDeleteInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      try {
        const { error } = await supabase.rpc('delete_invoice', { p_invoice: id })
        if (!error) return
        if (error.code !== 'PGRST202' && error.code !== '42883') throw error
        const plain = await supabase.from('invoices').delete().eq('id', id)
        if (plain.error) throw plain.error
      } catch (e) {
        if (!isLostAnswer(e)) throw e
        const still = await supabase.from('invoices').select('id').eq('id', id).maybeSingle()
        if (!still.error && !still.data) return
        throw new Error(t('invoices.deleteUnreachable'))
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/** Cancel an issued invoice, with its reason (sql/149). */
export function useCancelInvoice() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc('cancel_invoice', { p_invoice: id, p_reason: reason })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

/** A credit note for an issued invoice (sql/149): returns the new invoice. */
export function useCreateCreditNote() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('create_credit_note', { p_invoice: id, p_reason: reason })
      if (error) throw error
      return data as string
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useSetInvoiceStatus() {
  const update = useUpdateInvoice()
  return (id: string, status: InvoiceStatus) => update.mutateAsync({ id, status })
}

// ── Lines ────────────────────────────────────────────────────────────────────
// Totals are recomputed by a database trigger, so nothing here writes them.

export function useAddInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (line: InvoiceLineInput) => {
      const { data, error } = await supabase.from('invoice_lines').insert(line).select().single()
      if (error) throw error
      return data as InvoiceLine
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useUpdateInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<InvoiceLine> & { id: string }) => {
      const { data, error } = await supabase
        .from('invoice_lines').update(patch).eq('id', id).select().single()
      if (error) throw error
      return data as InvoiceLine
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeleteInvoiceLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('invoice_lines').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

// ── Payments ─────────────────────────────────────────────────────────────────

/**
 * Every payment in the clinic, including those recorded against a JOB rather
 * than an invoice (the `makstud` route). The invoice query only ever sees its
 * own, so anything counting how money arrives has to read this instead.
 */
export function usePayments() {
  const qc = useQueryClient()
  const channelId = useId()

  useEffect(() => {
    const channel = supabase
      .channel(`payments-all-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, () => {
        qc.invalidateQueries({ queryKey: ['payments'] })
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [qc, channelId])

  return useQuery<Payment[]>({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('*')
        .order('paid_at', { ascending: false })
      if (error) throw error
      return data as Payment[]
    }
  })
}

/**
 * Mark jobs paid: writes a payment row per job AND keeps the legacy
 * `makstud` / `makse_kuupaev` fields in step, because several screens still
 * read them. One trip through here so the two can never disagree.
 */
export function useMarkJobsPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      /** `amount` is what is being PAID NOW; `total` is what the job is worth,
       *  so a part payment can be told apart from a full one. */
      jobs: { id: string; amount: number; total?: number }[]
      method: PaymentMethod
      paid_at: string
      reference: string | null
    }) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error(t('useInvoices.noClinicThePaymentCannotBe'))
      const { data: userData } = await supabase.auth.getUser()

      const payable = input.jobs.filter(j => j.amount > 0)
      if (payable.length > 0) {
        const { error } = await supabase.from('payments').insert(
          payable.map(j => ({
            clinic_id: clinicId,
            invoice_id: null,
            job_id: j.id,
            amount: j.amount,
            method: input.method,
            paid_at: input.paid_at,
            reference: input.reference,
            recorded_by: userData?.user?.id ?? null,
          }))
        )
        if (error) throw error
      }

      // Only jobs that are now FULLY settled get the flag. A part payment is
      // recorded as money received but leaves the job owing the rest — marking
      // it paid would hide a debt, which is the one thing this must not do.
      const settled = input.jobs.filter(j => {
        const total = j.total ?? j.amount
        return total <= 0 || j.amount >= total - 0.005
      })

      const CHUNK = 15
      for (let i = 0; i < settled.length; i += CHUNK) {
        await Promise.all(settled.slice(i, i + CHUNK).map(j =>
          supabase.from('jobs')
            .update({ makstud: true, makse_kuupaev: input.paid_at, updated_at: new Date().toISOString() })
            .eq('id', j.id)
        ))
      }
      return { settled: settled.length, partial: input.jobs.length - settled.length }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['jobs'] })
    }
  })
}

export function useAddPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PaymentInput) => {
      const clinicId = getActiveClinicId()
      if (!clinicId) throw new Error(t('useInvoices.noClinicThePaymentCannotBe'))
      const { data: userData } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('payments')
        .insert({ ...input, clinic_id: clinicId, recorded_by: userData?.user?.id ?? null })
        .select()
        .single()
      if (error) throw error
      return data as Payment
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}

export function useDeletePayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  })
}
