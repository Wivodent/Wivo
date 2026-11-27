/**
 * Automatic invoicing on the screens (sql/151): the clinic's setting (off by
 * default) and a client's override, saved with the clinic's prices; "Created
 * automatically" and why a draft on the invoice; the owner's "Invoice ready to
 * check" opening that invoice. The database decides (sql/test/autoInvoicing).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { AUTO_INVOICE_OFF, AUTO_REASONS, normaliseAutoInvoice, policyForClient } from '@shared/billing/autoInvoice'
import { notificationTarget } from '../../lib/notificationTarget'
import { COLUMN_OF, toRow } from '../../lib/clinicSettings'

const read = (p: string) => readFileSync(p, 'utf8')
const SQL = read('sql/151_auto_invoicing.sql')

describe('the rule the screens explain', () => {
  it('off by default; anything stored that is not a choice reads as its default', () => {
    expect(normaliseAutoInvoice(undefined)).toEqual(AUTO_INVOICE_OFF)
    expect(AUTO_INVOICE_OFF).toEqual({ on: false, trigger: 'received', mode: 'per_job', send: 'draft' })
    expect(normaliseAutoInvoice({ on: 'yes', trigger: 'paid', mode: 'monthly', send: 'auto' })).toEqual({ on: false, trigger: 'received', mode: 'monthly', send: 'auto' })
  })
  it('a client’s choice over the clinic’s, part by part (as auto_invoice_policy)', () => {
    const clinic = { on: true, trigger: 'received', mode: 'per_job', send: 'draft' } as const
    expect(policyForClient(clinic, null)).toEqual(clinic)
    expect(policyForClient(clinic, { auto_invoice_on: false })).toEqual({ ...clinic, on: false })
    expect(policyForClient({ ...clinic, on: false }, { auto_invoice_on: true, auto_invoice_mode: 'monthly' })).toEqual({ ...clinic, on: true, mode: 'monthly' })
  })
  it('the reasons the database writes are the reasons the screens know', () => {
    const inDb = /auto_reasons <@ array\[([^\]]+)\]/.exec(SQL)![1].match(/'([a-z_]+)'/g)!.map(s => s.replace(/'/g, ''))
    for (const r of inDb) expect(AUTO_REASONS).toContain(r)
  })
})

describe('saved with the clinic’s prices', () => {
  it('the setting goes into clinic_settings.pricing.autoArve, where the database reads it', () => {
    expect(COLUMN_OF.autoArve).toBe('pricing')
    const row = toRow({ autoArve: { on: true, trigger: 'fitted', mode: 'monthly', send: 'auto' } } as never, [])
    expect((row.pricing as { autoArve?: unknown }).autoArve).toEqual({ on: true, trigger: 'fitted', mode: 'monthly', send: 'auto' })
    expect(SQL).toContain("select pricing->'autoArve' from public.clinic_settings")
  })
})

describe('the screens', () => {
  it('Settings → Invoices has it; a client’s card overrides it', () => {
    expect(read('src/renderer/src/components/SettingsPage.tsx')).toContain("<AutoInvoiceSection onOpenEmail={() => setGroup('epost')} />")
    const section = read('src/renderer/src/components/Settings/AutoInvoiceSection.tsx')
    expect(section).toContain("onChange={e => setAutoArve({ on: e.target.checked })}")
    expect(section).toContain("t('autoInvoice.mailOff')")
    expect(read('src/renderer/src/components/Customers/CustomersView.tsx')).toContain('<ClientAutoInvoiceFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} />')
    expect(read('src/renderer/src/hooks/useCustomers.ts')).toContain("'auto_invoice_on', 'auto_invoice_trigger', 'auto_invoice_mode', 'auto_invoice_send'")
  })
  it('the invoice says it was made automatically, and why it is a draft', () => {
    expect(read('src/renderer/src/components/Invoices/InvoicesView.tsx')).toContain('<AutoInvoiceNote invoice={invoice} />')
    const note = read('src/renderer/src/components/Invoices/AutoInvoiceNote.tsx')
    expect(note).toContain("t('autoInvoice.draftBecause',")
    expect(note).toContain("invoice.status === 'mustand' && reasons.length > 0")
  })
  it('“Invoice ready to check” opens that invoice; the e-mail’s subject never names the client', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const ctx = { isOwnJob: () => false, partnersOn: false }
    expect(notificationTarget({ kind: 'invoice_ready', job_id: null, detail: { invoice: id } }, ctx)).toEqual({ to: 'invoice', invoiceId: id })
    expect(notificationTarget({ kind: 'invoice_ready', job_id: null, detail: { failed: true } }, ctx)).toBeNull()
    expect(read('src/renderer/src/App.tsx')).toContain("setInvoicesFocus(f => ({ invoiceId: target.invoiceId, n: f.n + 1 })); setView('arved')")
    expect(read('supabase/functions/_shared/notifySender.ts')).toContain("invoice_ready: 'An invoice is ready to check'")
  })
})
