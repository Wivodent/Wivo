/**
 * Automatic invoicing (sql/151): the clinic's choice (Settings → Invoices →
 * "Automatic invoicing", in clinic_settings.pricing.autoArve) with a client's
 * own on top (customers.auto_invoice_*, empty = the clinic's). The database
 * decides and makes the invoice (auto_invoice_policy, auto_invoice_make); this
 * is the same rule for the screens that explain it.
 *
 *   trigger  received | fitted      the client confirms Received / Fitted
 *   mode     per_job  | monthly     one invoice per job / the client's monthly invoice
 *   send     auto     | draft       issued and e-mailed / a draft for review
 *
 * NO DEPENDENCIES (shared/README.md).
 */
export type AutoTrigger = 'received' | 'fitted'
export type AutoMode = 'per_job' | 'monthly'
export type AutoSend = 'auto' | 'draft'

export interface AutoInvoicePolicy { on: boolean; trigger: AutoTrigger; mode: AutoMode; send: AutoSend }

/** Off; and when switched on, Received, one invoice per job, a draft for review. */
export const AUTO_INVOICE_OFF: AutoInvoicePolicy = { on: false, trigger: 'received', mode: 'per_job', send: 'draft' }

export const AUTO_TRIGGERS: readonly AutoTrigger[] = ['received', 'fitted']
export const AUTO_MODES: readonly AutoMode[] = ['per_job', 'monthly']
export const AUTO_SENDS: readonly AutoSend[] = ['draft', 'auto']

const pick = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : fallback

/** The clinic's setting as stored (anything else reads as its default). */
export function normaliseAutoInvoice(v: unknown): AutoInvoicePolicy {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  return {
    on: o.on === true,
    trigger: pick(o.trigger, AUTO_TRIGGERS, AUTO_INVOICE_OFF.trigger),
    mode: pick(o.mode, AUTO_MODES, AUTO_INVOICE_OFF.mode),
    send: pick(o.send, AUTO_SENDS, AUTO_INVOICE_OFF.send),
  }
}

/** A client's own choice: each part null = the clinic's. */
export interface ClientAutoInvoice {
  auto_invoice_on?: boolean | null
  auto_invoice_trigger?: AutoTrigger | null
  auto_invoice_mode?: AutoMode | null
  auto_invoice_send?: AutoSend | null
}

/** What applies to this client (as the database's auto_invoice_policy). */
export function policyForClient(clinic: AutoInvoicePolicy, client: ClientAutoInvoice | null | undefined): AutoInvoicePolicy {
  return {
    on: client?.auto_invoice_on ?? clinic.on,
    trigger: client?.auto_invoice_trigger ?? clinic.trigger,
    mode: client?.auto_invoice_mode ?? clinic.mode,
    send: client?.auto_invoice_send ?? clinic.send,
  }
}

/** Why an automatic invoice is a draft (invoices.auto_reasons); 'review' = the policy asked for one. */
export type AutoReason = 'no_price' | 'no_email' | 'buyer_details' | 'mail_off' | 'review' | 'failed'
export const AUTO_REASONS: readonly AutoReason[] = ['no_price', 'no_email', 'buyer_details', 'mail_off', 'review', 'failed']
export const isAutoReason = (v: unknown): v is AutoReason => typeof v === 'string' && (AUTO_REASONS as readonly string[]).includes(v)
