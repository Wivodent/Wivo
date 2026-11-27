/**
 * Small pure pieces shared by the clinic's Orders page and the phone's
 * Network mode (docs/design/orders.html, docs/design/network-phone.html):
 * which tab an order belongs to, teeth as a short label, initials, the
 * greeting. Nothing here invents a number: every count is counted from rows.
 */
import type { ClientOrderStatus } from '@shared/network/order'

/** The Orders page's tabs, in the clinic's words. Mirrors client_order_status (sql/138). */
export type OrderTab = 'new' | 'in_progress' | 'ready' | 'sent' | 'rejected'
export const ORDER_TABS: readonly OrderTab[] = ['new', 'in_progress', 'ready', 'sent', 'rejected']

export interface OrderJobState { id: string; status: string | null; delivery_status: string | null }

/**
 * An order's tab: new and rejected from the order itself; an accepted one by
 * its job on the board, the same rule the client sees (sent once the job is
 * on its way or handed over, ready at the last stage, else in progress). A
 * job that cannot be read counts as in progress.
 */
export function orderTab(order: { status: 'received' | 'accepted' | 'rejected'; job_id: string | null },
  job: OrderJobState | undefined, doneStageKey: string): OrderTab {
  if (order.status === 'received') return 'new'
  if (order.status === 'rejected') return 'rejected'
  if (!job) return 'in_progress'
  if (job.delivery_status === 'teel' || job.delivery_status === 'yle_antud') return 'sent'
  if (job.status === doneStageKey) return 'ready'
  return 'in_progress'
}

/** What a client calls each tab (shared/network/order ClientOrderStatus). */
export const clientStatusOfTab = (tab: OrderTab): ClientOrderStatus => (tab === 'new' ? 'received' : tab)

export function countByTab<T>(items: readonly T[], tabOf: (item: T) => OrderTab): Record<OrderTab, number> {
  const out: Record<OrderTab, number> = { new: 0, in_progress: 0, ready: 0, sent: 0, rejected: 0 }
  for (const it of items) out[tabOf(it)]++
  return out
}

/** The arches in mouth order, as a dentist reads them: right to left across the midline. */
export const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const
export const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const

/** Comma-separated FDI numbers as in an order ("11,21"), as a list of numbers; anything else is dropped. */
export function parseTeeth(teeth: string): number[] {
  const seen = new Set<number>()
  for (const part of teeth.split(',')) {
    const n = Number(part.trim())
    if (UPPER_TEETH.includes(n as never) || LOWER_TEETH.includes(n as never)) seen.add(n)
  }
  return [...seen]
}

/** Numbers back to the order's form, in mouth order. */
export function formatTeeth(list: readonly number[]): string {
  const set = new Set(list)
  return [...UPPER_TEETH, ...LOWER_TEETH].filter(n => set.has(n)).join(',')
}

/**
 * Teeth as a short label: neighbours in an arch run together ("13–23"), a
 * run of two stays two numbers ("11, 21"). Empty for no teeth.
 */
export function teethLabel(teeth: string): string {
  const set = new Set(parseTeeth(teeth))
  const parts: string[] = []
  for (const arch of [UPPER_TEETH, LOWER_TEETH]) {
    let run: number[] = []
    const flush = () => {
      if (run.length >= 3) parts.push(`${run[0]}–${run[run.length - 1]}`)
      else parts.push(...run.map(String))
      run = []
    }
    for (const n of arch) {
      if (set.has(n)) run.push(n)
      else if (run.length) flush()
    }
    if (run.length) flush()
  }
  return parts.join(', ')
}

/** Up to two initials of a name, for a round badge. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...words[0]][0] ?? ''
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : ''
  return (first + last).toUpperCase()
}

export type DayPart = 'morning' | 'afternoon' | 'evening'
export const dayPart = (hour: number): DayPart => (hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening')

/** The names of an order's chosen options, in the order of its groups; an id without a name is left out. */
export function chosenOptionLabels(options: Record<string, string[]> | null | undefined, nameOf: (groupKey: string, id: string) => string | undefined): string[] {
  const out: string[] = []
  for (const [key, ids] of Object.entries(options ?? {})) {
    for (const id of ids ?? []) {
      const name = nameOf(key, id)
      if (name) out.push(name)
    }
  }
  return out
}

/** A file's extension for its little tile ("STL"), or empty. */
export function fileBadge(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim())
  return m ? m[1].toUpperCase() : ''
}

/** Wivo has connected the clinic: the Network's key and the clinic's Network number are set (scripts/network-connect.mjs). */
export const networkConfigured = (row: { network_public_key: string | null; network_clinic_id: string | null } | null | undefined): boolean =>
  !!row?.network_public_key && !!row?.network_clinic_id

/** The steps of the phone's New order form. Picking the clinic is a step only when it was really asked. */
export type FormStep = 'clinic' | 'work' | 'details' | 'review'

/** The step's number and how many steps there are, counting only the ones the person sees. */
export function stepNumber(step: FormStep, withClinicStep: boolean): { number: number; total: number } {
  const visible: FormStep[] = withClinicStep ? ['clinic', 'work', 'details', 'review'] : ['work', 'details', 'review']
  const i = visible.indexOf(step)
  return { number: i < 0 ? 1 : i + 1, total: visible.length }
}

/** Whether leaving the form would lose something the person filled in (and should be asked first). */
export function orderTouched(o: { work_type: string; teeth: string; options: Record<string, string[]>; shade: string | null; due: string | null; patient_ref: string; notes: string | null }, files: number): boolean {
  return files > 0 || o.work_type !== '' || o.teeth !== '' || Object.values(o.options).some(v => v.length > 0)
    || !!o.shade || !!o.due || o.patient_ref.trim() !== '' || !!o.notes?.trim()
}
