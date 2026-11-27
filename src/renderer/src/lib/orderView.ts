/**
 * Small pure pieces shared by the clinic's Orders page and the phone's
 * Network mode (docs/design/orders.html, docs/design/network-phone.html):
 * which tab an order belongs to, teeth as a short label, initials, the
 * greeting. Nothing here invents a number: every count is counted from rows.
 */
import type { CatalogueItem, ClientOrderStatus, WivoOrder, WivoOrderV1 } from '@shared/network/order'
import type { WorkType } from '@shared/pricing/workTypes'
import { workTypeRules } from '@shared/wizard/workTypeRules'
import { deliveryStep } from './delivery'

/**
 * The Orders page's tabs, in the clinic's words. Mirrors client_order_status
 * (sql/138, 145): 'arrived' is the tab "Received" (the client has it), not
 * the order's own 'received' (which is New).
 */
export type OrderTab = 'new' | 'in_progress' | 'ready' | 'sent' | 'arrived' | 'problem' | 'rejected' | 'cancelled'
export const ORDER_TABS: readonly OrderTab[] = ['new', 'in_progress', 'ready', 'sent', 'arrived', 'problem', 'rejected', 'cancelled']

export interface OrderJobState {
  id: string; status: string | null; delivery_status: string | null
  /** sql/145: when it left and arrived; absent on a database before it. */
  sent_at?: string | null; received_at?: string | null; received_via?: string | null; received_note?: string | null
  /** Who is on the job (sql/146: they and the owner rate the client). */
  assigned_to?: string | null; designed_by?: string | null
  /** sql/145: an open delivery problem on the job. */
  problem?: boolean
  /** The job's price (sql/153: an accepted order without one shows "No price"). */
  hind?: number | null
}

/**
 * An order's tab: new and rejected from the order itself; an accepted one by
 * its job on the board, the same rule the client sees (once sent: a problem,
 * received, or sent; ready at the last stage, else in progress). A job that
 * cannot be read counts as in progress.
 */
export function orderTab(order: { status: 'received' | 'accepted' | 'rejected'; job_id: string | null; cancelled_at?: string | null },
  job: OrderJobState | undefined, doneStageKey: string): OrderTab {
  if (order.status === 'received') return 'new'
  if (order.status === 'rejected') return 'rejected'
  // sql/146: its job was deleted (never "in progress" again until it is restored).
  if (order.cancelled_at) return 'cancelled'
  if (!job) return 'in_progress'
  const step = deliveryStep(job, !!job.problem)
  // A database before sql/145 knows only Sent.
  if (step !== 'not_sent' && job.sent_at === undefined) return 'sent'
  if (step === 'problem') return 'problem'
  if (step === 'received') return 'arrived'
  if (step === 'awaiting') return 'sent'
  if (job.status === doneStageKey) return 'ready'
  return 'in_progress'
}

/** What a client calls each tab (shared/network/order ClientOrderStatus). */
export const clientStatusOfTab = (tab: OrderTab): ClientOrderStatus => (tab === 'new' ? 'received' : tab)

export function countByTab<T>(items: readonly T[], tabOf: (item: T) => OrderTab): Record<OrderTab, number> {
  const out: Record<OrderTab, number> = { new: 0, in_progress: 0, ready: 0, sent: 0, arrived: 0, problem: 0, rejected: 0, cancelled: 0 }
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

// ── Implants in an order from outside (sql/141, Wivo order v2) ───────────────

/** What the new-job form knows about a work type, read from the clinic's catalogue entry (shared/wizard/workTypeRules). */
export function catalogueRules(item: CatalogueItem): { implantBased: boolean; isBridge: boolean; supportsAbutment: boolean; toothMode: 'tooth' | 'arch' | 'none' } {
  const type = {
    nimi: item.name, hex: '#000000', match: item.match ?? [], katalog: item.katalog ?? undefined,
    liik: item.liik ?? undefined, hambaviis: item.hambaviis ?? undefined,
  } as unknown as WorkType
  const r = workTypeRules(item.name, [type])
  return { implantBased: r.implantBased, isBridge: r.isBridge, supportsAbutment: r.supportsAbutment || r.implantBased, toothMode: r.toothMode }
}

/** How many implants an All-on-N carries, from its name (All-on-4 → 4); null for anything else. */
export function expectedImplants(name: string): number | null {
  const m = /all[\s-]?on[\s-]?(\d)/i.exec(name)
  return m ? Number(m[1]) : null
}

/**
 * The implants after the teeth changed: those still among the teeth stay; for
 * work built on implants (tooth by tooth), a newly picked tooth IS an implant
 * until someone says otherwise, e.g. a bridge's pontic — as the new-job form.
 */
export function withAutoImplants(prevTeeth: readonly number[], nextTeeth: readonly number[], implants: readonly number[], autoMark: boolean): number[] {
  const next = new Set(nextTeeth)
  const before = new Set(prevTeeth)
  const kept = implants.filter(t => next.has(t))
  const added = autoMark ? nextTeeth.filter(t => !before.has(t) && !kept.includes(t)) : []
  return parseTeeth(formatTeeth([...kept, ...added]))
}

/** Teeth, implants and (for a bridge built on implants) pontics, in mouth order. */
export function implantSummary(teeth: readonly number[], implants: readonly number[], isBridge: boolean, implantBased: boolean): { teeth: number; implants: number[]; pontics: number[] } {
  const marked = new Set(implants)
  const ordered = parseTeeth(formatTeeth([...teeth]))
  return {
    teeth: ordered.length,
    implants: ordered.filter(t => marked.has(t)),
    pontics: isBridge && implantBased ? ordered.filter(t => !marked.has(t)) : [],
  }
}

/** The order as it is sent: version 2 with the implants and abutment when the clinic takes it, else version 1 without them. */
export function wireOrder(form: WivoOrderV1, extra: { implants: readonly number[]; abutmentAll: string; abutmentTeeth: Record<string, string>; custom?: boolean }, v2: boolean): WivoOrder {
  if (!v2) return { ...form, version: 1 }
  // sql/153: "Other / custom request": no implants or abutment of the catalogue's types, flagged.
  if (extra.custom) return { ...form, version: 2, implants: '', abutment: null, custom: true }
  const implants = parseTeeth(formatTeeth([...extra.implants])).filter(t => parseTeeth(form.teeth).includes(t))
  const all = extra.abutmentAll.trim()
  const teeth: Record<string, string> = {}
  for (const t of implants) {
    const own = (extra.abutmentTeeth[String(t)] ?? '').trim()
    if (own && own !== all) teeth[String(t)] = own
  }
  const abutment = implants.length && (all || Object.keys(teeth).length) ? { all: all || null, teeth } : null
  return { ...form, version: 2, implants: formatTeeth(implants), abutment }
}

/** An amount as the order shows it: two decimals only when it has cents. */
export const priceAmount = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2))

export interface CataloguePriceWords { perTooth: string; from: (price: string) => string; onRequest: string }

/**
 * A work type's price as the catalogue shows it to this client (sql/153):
 * "450 € / tooth", "from 450 € / tooth", "Price on request", or nothing when
 * the clinic shows this client no prices. Whether it may see them is the
 * clinic's answer in the catalogue itself (client_catalog reads the
 * connection's "Prices" right on every call), never a copy kept with the
 * session, which can be hours old.
 */
export function cataloguePriceText(c: Pick<CatalogueItem, 'price' | 'unit' | 'price_form'>, words: CataloguePriceWords): string {
  if (c.price_form === 'request') return words.onRequest
  if (c.price == null) return ''
  const text = `${priceAmount(c.price)} €${c.unit === 'hammas' ? ` / ${words.perTooth}` : ''}`
  return c.price_form === 'from' ? words.from(text) : text
}

/**
 * What an order comes to at the catalogue's prices (sql/153), as the clinic's
 * client_order_estimate counts it: the type's price (its "from" price when it
 * shows one) times the teeth for a per-tooth type, plus each chosen option per
 * job or per tooth. Null: no price shown (on request, prices hidden, or no
 * teeth yet for a per-tooth type).
 */
export function catalogueEstimate(item: Pick<CatalogueItem, 'price' | 'unit' | 'price_form' | 'groups'> | undefined, teeth: string,
  options: Record<string, string[]>): { amount: number; from: boolean } | null {
  if (!item || item.price == null || item.price_form === 'request') return null
  const count = parseTeeth(teeth).length
  if (item.unit === 'hammas' && count === 0) return null
  let total = item.price * (item.unit === 'hammas' ? count : 1)
  for (const [key, ids] of Object.entries(options)) {
    const g = item.groups.find(x => x.key === key)
    for (const id of ids) {
      const o = g?.options.find(x => x.id === id)
      if (o?.price) total += o.price * (o.unit === 'hammas' ? count : 1)
    }
  }
  return { amount: Math.round(total * 100) / 100, from: item.price_form === 'from' }
}

/**
 * What the client is told when the work is sent with a courier, a tracking
 * number or a note: one message, or null when none was given (the "on its
 * way" notice says enough then). Labels come from the caller's language.
 */
export function sentMessage(
  f: { courier: string; tracking: string; note: string },
  labels: { title: string; courier: (c: string) => string; tracking: (n: string) => string },
): string | null {
  const courier = f.courier.trim()
  const tracking = f.tracking.trim()
  const note = f.note.trim()
  if (!courier && !tracking && !note) return null
  return [labels.title, courier && labels.courier(courier), tracking && labels.tracking(tracking), note].filter(Boolean).join('\n').slice(0, 4000)
}

// ── An order's conversation: files with their messages, reviews (sql/143) ────

export interface ThreadMessage { id: string; from_client: boolean; body: string; created_at: string; needs_review?: boolean; review_of?: string | null; review_state?: 'approved' | 'changes' | null
  /** sql/144: the client's "Fitted" / "Needs adjustment" on sent work. */
  fit_state?: 'fitted' | 'adjust' | null
  /** sql/145: the client's Received or delivery problem (with its reason), or the clinic's resolution (with how). */
  delivery_state?: 'received' | 'problem' | 'resolved' | null
  delivery_reason?: string | null }
export interface ThreadFile { id: string; file_name: string; size: number; created_at: string; message_id?: string | null; from_client?: boolean; mime_type?: string | null }

/** Each message with its files, in order; files sent with the order itself (no message) apart. */
export function threadItems<M extends ThreadMessage, F extends ThreadFile>(messages: readonly M[], files: readonly F[]): { messages: (M & { files: F[] })[]; orderFiles: F[] } {
  const byMessage = new Map<string, F[]>()
  const orderFiles: F[] = []
  for (const f of files) {
    if (f.message_id && messages.some(m => m.id === f.message_id)) byMessage.set(f.message_id, [...(byMessage.get(f.message_id) ?? []), f])
    else orderFiles.push(f)
  }
  return { messages: messages.map(m => ({ ...m, files: byMessage.get(m.id) ?? [] })), orderFiles }
}

/** The client's latest answer to a message that needs review, or null while it waits. */
export function reviewAnswer<M extends ThreadMessage>(messageId: string, messages: readonly M[]): M | null {
  const answers = messages.filter(m => m.review_of === messageId && m.review_state)
  return answers.length ? answers.reduce((a, b) => (a.created_at >= b.created_at ? a : b)) : null
}

/** The latest review answer on the whole order, for the job page: approved or changes, and when. */
export function latestReview<M extends ThreadMessage>(messages: readonly M[]): M | null {
  const answers = messages.filter(m => m.review_state)
  return answers.length ? answers.reduce((a, b) => (a.created_at >= b.created_at ? a : b)) : null
}

/** A picture the browser can show as a preview (by type, else by name). */
export function isImageFile(f: Pick<ThreadFile, 'file_name' | 'mime_type'>): boolean {
  if (f.mime_type) return /^image\/(jpeg|png|webp|gif|heic|heif)$/i.test(f.mime_type)
  return /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(f.file_name)
}
