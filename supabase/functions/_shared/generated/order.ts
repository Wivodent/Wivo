// GENERATED — DO NOT EDIT. A copy of shared/network/order.ts for the Edge Functions
// (supabase/functions/README.md: a deploy may not bundle imports from outside supabase/).
// Regenerate:  node scripts/copy-shared-to-functions.mjs   (generatedCopy.test.ts checks it).

/**
 * "Wivo order", version 1 (docs/WIVO-ORDER-FORMAT.md): what an outside client
 * sends a clinic through the Network. The client's form, the clinic's Edge
 * Function and the clinic's database (client_new_order, sql/138) all read it
 * the same way; this file is the form's and the function's check, the
 * database repeats the essentials.
 *
 * NO PATIENT RECORD: the patient is the orderer's own reference, at most 40
 * characters. No name field, no personal code, no birth date, no medical card.
 */

export const ORDER_FORMAT = 'wivo-order'
/** Version 1, as every clinic before sql/141 accepts it. */
export const ORDER_VERSION = 1
/** The versions this code reads and writes. A clinic says the highest it takes in its catalogue (`order_version`). */
export const ORDER_VERSIONS = [1, 2] as const

export interface WivoOrderV1 {
  format: typeof ORDER_FORMAT
  version: 1
  /** A work type from the clinic's catalogue, by its name there. */
  work_type: string
  /** FDI tooth numbers, comma-separated ("11,21"); empty for work with no teeth. */
  teeth: string
  /** Group key → option ids, from the catalogue's groups for this work type. */
  options: Record<string, string[]>
  shade: string | null
  /** The date the client needs it by, YYYY-MM-DD. */
  due: string | null
  /** The orderer's own reference for the patient. Never a name. */
  patient_ref: string
  notes: string | null
}

/** Screw / abutment references: one for every implant, and the implants that differ. As WorkItem.kruvi / kruvid. */
export interface OrderAbutment {
  all: string | null
  /** FDI → code, for implants whose code differs from `all`. */
  teeth: Record<string, string>
}

/**
 * Version 2 (sql/141): version 1 plus where the implants are and what sits on
 * them. A bridge's pontics are its teeth that are not implants; they are not
 * a field of their own, so the two can never disagree.
 */
export interface WivoOrderV2 extends Omit<WivoOrderV1, 'version'> {
  version: 2
  /** FDI numbers among `teeth` that sit on an implant, comma-separated; "" for none. */
  implants: string
  abutment: OrderAbutment | null
  /**
   * "Other / custom request" (sql/153): not from the catalogue. `work_type` is
   * the client's own title, `notes` what is wanted; the clinic quotes a price
   * and the work starts once the client approves it.
   */
  custom?: boolean
}

export type WivoOrder = WivoOrderV1 | WivoOrderV2

/** The implants an order names (none in version 1). */
export const orderImplants = (o: Pick<WivoOrder, 'version'> & { implants?: string }): string =>
  o.version === 2 ? o.implants ?? '' : ''

/** A work type as the clinic shows it to a client (client_catalog). */
export interface CatalogueItem {
  name: string
  teeth: 'tooth' | 'arch' | 'none'
  /** An option's price: only when this client sees prices and the type has one (sql/153), this client's own amount. */
  groups: { key: string; name: string; multi: boolean; options: { id: string; name: string; price?: number; unit?: 'too' | 'hammas' }[] }[]
  /** Only when the owner lets this client see prices: this client's own (sql/153: its discount or own price). */
  price?: number | null
  unit?: 'too' | 'hammas'
  /** sql/153: how the price shows — the price, "from" it, or "on request" (none; the clinic quotes). Absent: as `price`. */
  price_form?: 'exact' | 'from' | 'request'
  /**
   * The type's own words, as the clinic set them (sql/141): the phone reads
   * from them what the new-job form reads (shared/wizard/workTypeRules: built
   * on implants, a bridge, a screw/abutment). Absent from a clinic before 141.
   */
  liik?: 'single' | 'bridge' | 'arch' | 'none' | null
  hambaviis?: 'tooth' | 'arch' | 'none' | null
  katalog?: string | null
  match?: string[] | null
  /** The highest order version this clinic takes (sql/141: 2). Absent: 1. */
  order_version?: number
}

export const LIMITS = { workType: 120, teeth: 200, shade: 20, patientRef: 40, notes: 2000, optionId: 80, options: 20, abutment: 60 } as const

const FDI = /^(?:[1-8][1-8])(?:,[1-8][1-8])*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const OPTION_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const KEYS_V1 = ['format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes']
const KEYS: Record<number, Set<string>> = { 1: new Set(KEYS_V1), 2: new Set([...KEYS_V1, 'implants', 'abutment', 'custom']) }

export type OrderProblem =
  | 'format' | 'unknown_field' | 'work_type' | 'teeth' | 'options' | 'shade' | 'due' | 'patient_ref' | 'notes'
  | 'implants' | 'abutment'
  | 'not_in_catalogue' | 'option_not_offered' | 'one_option_only'
  /** sql/153: a custom request needs its title (work_type, at most 80) and what is wanted (notes). */
  | 'custom'

/** What is wrong with an order, or [] when it may be sent. With the catalogue, its choices are checked too. */
export function orderProblems(o: unknown, catalogue?: readonly CatalogueItem[], today?: string): OrderProblem[] {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['format']
  const x = o as Record<string, unknown>
  const out: OrderProblem[] = []
  const keys = KEYS[x.version as number]
  if (x.format !== ORDER_FORMAT || !keys) out.push('format')
  if (Object.keys(x).some(k => !(keys ?? KEYS[1]).has(k))) out.push('unknown_field')
  if (x.version === 2) {
    const teeth = typeof x.teeth === 'string' ? x.teeth.split(',') : []
    const implants = typeof x.implants === 'string' ? x.implants : null
    const implantList = implants ? implants.split(',') : []
    if (implants === null || (implants !== '' && !FDI.test(implants)) || implantList.some(t => !teeth.includes(t))) out.push('implants')
    const a = x.abutment
    const code = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= LIMITS.abutment
    const abutmentOk = a === null || (!!a && typeof a === 'object' && !Array.isArray(a)
      && Object.keys(a).every(k => k === 'all' || k === 'teeth')
      && ((a as OrderAbutment).all === null || code((a as OrderAbutment).all))
      && !!(a as OrderAbutment).teeth && typeof (a as OrderAbutment).teeth === 'object' && !Array.isArray((a as OrderAbutment).teeth)
      && Object.entries((a as OrderAbutment).teeth).every(([k, v]) => implantList.includes(k) && code(v)))
    if (!abutmentOk || (a && implantList.length === 0)) out.push('abutment')
  }
  if (typeof x.work_type !== 'string' || !x.work_type.trim() || x.work_type.length > LIMITS.workType) out.push('work_type')
  if (typeof x.teeth !== 'string' || x.teeth.length > LIMITS.teeth || (x.teeth !== '' && !FDI.test(x.teeth))) out.push('teeth')
  const opts = x.options
  const optsOk = !!opts && typeof opts === 'object' && !Array.isArray(opts)
    && Object.keys(opts).length <= LIMITS.options
    && Object.entries(opts as Record<string, unknown>).every(([k, v]) =>
      OPTION_ID.test(k) && k.length <= LIMITS.optionId && Array.isArray(v) && v.length <= LIMITS.options
      && v.every(id => typeof id === 'string' && OPTION_ID.test(id) && id.length <= LIMITS.optionId))
  if (!optsOk) out.push('options')
  if (x.shade !== null && (typeof x.shade !== 'string' || x.shade.length > LIMITS.shade)) out.push('shade')
  if (x.due !== null && (typeof x.due !== 'string' || !DATE.test(x.due) || Number.isNaN(Date.parse(x.due))
    || (today !== undefined && x.due < today))) out.push('due')
  if (typeof x.patient_ref !== 'string' || !x.patient_ref.trim() || x.patient_ref.length > LIMITS.patientRef) out.push('patient_ref')
  if (x.notes !== null && (typeof x.notes !== 'string' || x.notes.length > LIMITS.notes)) out.push('notes')

  // sql/153: "Other / custom request": outside the catalogue, a title and what is wanted.
  const custom = x.version === 2 && x.custom === true
  if (x.custom !== undefined && (x.version !== 2 || typeof x.custom !== 'boolean')) out.push('custom')
  if (custom && ((typeof x.work_type === 'string' && x.work_type.trim().length > 80) || typeof x.notes !== 'string' || !x.notes.trim())) out.push('custom')

  if (catalogue && typeof x.work_type === 'string' && !custom) {
    const item = catalogue.find(c => c.name === x.work_type)
    if (!item) out.push('not_in_catalogue')
    else if (optsOk) {
      for (const [key, ids] of Object.entries(opts as Record<string, string[]>)) {
        const g = item.groups.find(gr => gr.key === key)
        if (!g || ids.some(id => !g.options.some(op => op.id === id))) { out.push('option_not_offered'); break }
        if (!g.multi && ids.length > 1) { out.push('one_option_only'); break }
      }
    }
  }
  return [...new Set(out)]
}

/** A new, empty order, as the form starts it (version 1; the form adds the implants when the clinic takes version 2). */
export function emptyOrder(): WivoOrderV1 {
  return { format: ORDER_FORMAT, version: ORDER_VERSION, work_type: '', teeth: '', options: {}, shade: null, due: null, patient_ref: '', notes: null }
}

/** What a client sees an order as (client_orders): the clinic's progress in four words, or refused. */
/**
 * 'received' is the clinic having the order (shown as New); after 'sent'
 * (sql/145) comes 'arrived' (the client said Received) or 'problem' (a
 * delivery problem the clinic has not resolved yet). 'cancelled' (sql/146):
 * the clinic deleted the job the order became; restoring it takes the order
 * back to where it was.
 */
export type ClientOrderStatus = 'received' | 'in_progress' | 'ready' | 'sent' | 'arrived' | 'problem' | 'rejected' | 'cancelled'
export const CLIENT_ORDER_STATUSES: readonly ClientOrderStatus[] = ['received', 'in_progress', 'ready', 'sent', 'arrived', 'problem', 'rejected', 'cancelled']
