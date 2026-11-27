/**
 * The lab's customer: an ordering dental practice.
 *
 * NOT to be confused with `clinics`, which is the TENANT — the lab itself, what
 * `my_clinic_id()` returns and what every RLS policy scopes on. A customer is
 * scoped BY `clinic_id`; it is not a clinic. The naming collision is historical
 * and `sql/035` says so at length.
 */
import { t } from '@shared/i18n' // not @/lib/i18n: that touches `document` on load, and node tests import this
import type { MessageKey } from '@shared/i18n'

/** How this customer is billed. */
export type BillingMode = 'per_job' | 'monthly'

export const BILLING_MODE_LABEL: Record<BillingMode, string> = {
  per_job: t('customer.perJob'),
  monthly: t('customer.monthlyStatement'),
}

export const BILLING_MODE_HINT: Record<BillingMode, string> = {
  per_job: t('customer.eachJobIsInvoicedSeparatelyWhen'),
  monthly: t('customer.oneInvoiceAMonthCoveringEvery'),
}

export interface Customer {
  id: string
  clinic_id: string
  name: string
  reg_code: string | null
  vat_number: string | null
  address: string | null
  email: string | null
  /** sql/152: where invoices go, before `email` (the card, or the client's own Network profile). */
  billing_email?: string | null
  /** sql/153: off every price of the clinic's list for this client (0–100), and its own price per work type. */
  discount_pct?: number | null
  client_prices?: Record<string, number>
  cc_emails: string[]
  phone: string | null
  contact_name: string | null
  billing_mode: BillingMode
  payment_terms_days: number
  /** Per-customer price overrides. Empty = this customer pays the list price. */
  price_overrides: Record<string, unknown>
  /** Archived customers stay readable and stop being offered. */
  archived_at: string | null
  note: string | null
  /** A clinic, or a dentist / technician on their own (sql/128). Absent before it: a clinic. */
  kind?: 'clinic' | 'person'
  /** sql/149: the language of this client's invoices (null: the clinic's default) and its country (ISO, two letters). */
  invoice_language?: 'et' | 'lv' | 'en' | null
  country?: string | null
  /** sql/151: this client's automatic invoicing; each null = the clinic's choice. */
  auto_invoice_on?: boolean | null
  auto_invoice_trigger?: 'received' | 'fitted' | null
  auto_invoice_mode?: 'per_job' | 'monthly' | null
  auto_invoice_send?: 'auto' | 'draft' | null
  created_at: string
  updated_at: string
}

export type CustomerInput = Omit<
  Customer, 'id' | 'clinic_id' | 'created_at' | 'updated_at'
>

export const EMPTY_CUSTOMER: CustomerInput = {
  name: '',
  reg_code: null,
  vat_number: null,
  address: null,
  email: null,
  billing_email: null,
  discount_pct: null,
  client_prices: {},
  cc_emails: [],
  phone: null,
  contact_name: null,
  billing_mode: 'per_job',
  payment_terms_days: 14,
  price_overrides: {},
  archived_at: null,
  note: null,
  invoice_language: null,
  country: null,
  auto_invoice_on: null,
  auto_invoice_trigger: null,
  auto_invoice_mode: null,
  auto_invoice_send: null,
}

/** Who an invoice is addressed to. See `sql/035` for why `patsient` is shared. */
export type BillToKind = 'patient' | 'customer'

/** Where the finished work physically is. The pipeline ending at "done" means
 *  the bench is finished with it, not that the practice has it. */
export type DeliveryStatus = 'labor' | 'teel' | 'yle_antud'

export const DELIVERY_LABEL: Record<DeliveryStatus, string> = {
  labor:     t('customer.inTheLab'),
  teel:      t('customer.inTransit'),
  yle_antud: t('customer.delivered'),
}

/** Always Estonian, for the CSV export: its language is the recipient's, not the UI's. */
/** The message key for each delivery state. See CONSENT_KEY in types/patient. */
export const DELIVERY_KEY: Record<DeliveryStatus, MessageKey> = {
  labor:     'exports.deliveryLab',
  teel:      'exports.deliveryOnWay',
  yle_antud: 'exports.deliveryHandedOver',
}

export const DELIVERY_HEX: Record<DeliveryStatus, string> = {
  labor:     '#94A3B8',
  teel:      '#F59E0B',
  yle_antud: '#10B981',
}
