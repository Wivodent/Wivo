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
export const ORDER_VERSION = 1

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

/** A work type as the clinic shows it to a client (client_catalog). */
export interface CatalogueItem {
  name: string
  teeth: 'tooth' | 'arch' | 'none'
  groups: { key: string; name: string; multi: boolean; options: { id: string; name: string }[] }[]
  /** Only when the owner lets this client see prices. */
  price?: number | null
  unit?: 'too' | 'hammas'
}

export const LIMITS = { workType: 120, teeth: 200, shade: 20, patientRef: 40, notes: 2000, optionId: 80, options: 20 } as const

const FDI = /^(?:[1-8][1-8])(?:,[1-8][1-8])*$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const OPTION_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const KEYS = new Set(['format', 'version', 'work_type', 'teeth', 'options', 'shade', 'due', 'patient_ref', 'notes'])

export type OrderProblem =
  | 'format' | 'unknown_field' | 'work_type' | 'teeth' | 'options' | 'shade' | 'due' | 'patient_ref' | 'notes'
  | 'not_in_catalogue' | 'option_not_offered' | 'one_option_only'

/** What is wrong with an order, or [] when it may be sent. With the catalogue, its choices are checked too. */
export function orderProblems(o: unknown, catalogue?: readonly CatalogueItem[], today?: string): OrderProblem[] {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return ['format']
  const x = o as Record<string, unknown>
  const out: OrderProblem[] = []
  if (x.format !== ORDER_FORMAT || x.version !== ORDER_VERSION) out.push('format')
  if (Object.keys(x).some(k => !KEYS.has(k))) out.push('unknown_field')
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

  if (catalogue && typeof x.work_type === 'string') {
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

/** A new, empty order, as the form starts it. */
export function emptyOrder(): WivoOrderV1 {
  return { format: ORDER_FORMAT, version: ORDER_VERSION, work_type: '', teeth: '', options: {}, shade: null, due: null, patient_ref: '', notes: null }
}

/** What a client sees an order as (client_orders): the clinic's progress in four words, or refused. */
export type ClientOrderStatus = 'received' | 'in_progress' | 'ready' | 'sent' | 'rejected'
export const CLIENT_ORDER_STATUSES: readonly ClientOrderStatus[] = ['received', 'in_progress', 'ready', 'sent', 'rejected']
