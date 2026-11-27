/**
 * Two requests from testing (2026-11-27, sql/149):
 *
 *  1. The invoice's language belongs to the client and the invoice, not only
 *     to the clinic: a client's own language, English for a client abroad,
 *     else the clinic's default; chosen per invoice and kept on it, and the
 *     e-mail's letter follows it.
 *  2. Deleting an invoice: only a draft, which has no number of the sequence
 *     yet; an issued one is cancelled (with a reason) or credited. A lost
 *     answer ("Failed to fetch") is checked before it is called a failure,
 *     and the dialog waits instead of showing an error.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { startingInvoiceLanguage } from '../../lib/invoiceLanguage'
import { isLostAnswer } from '../../lib/lostAnswer'
import { mailTemplateForInvoice, MAIL_TEMPLATES, DEFAULT_MAIL_TEMPLATE } from '@shared/billing/mailTemplate'
import { invoiceDoc, isDraftNumber, type DocInvoice } from '@shared/billing/invoiceDoc'
import { invoiceNumberText } from '../../types/invoice'

const read = (p: string) => readFileSync(p, 'utf8')

const invoice = (over: Partial<DocInvoice> = {}): DocInvoice => ({
  number: '2026-0007', status: 'saadetud', patsient: 'Zobu klīnika SIA',
  issue_date: '2026-11-02', due_date: '2026-11-16', vat_rate: 21,
  net_total: 100, vat_total: 21, gross_total: 121, note: null,
  lines: [{ description: 'Crown 11', qty: 1, unit_price: 100 }], payments: [],
  ...over,
})
const bank = { name: 'Dentiks SIA', bank_name: 'Swedbank', bank_account: 'LV00HABA0000000000000' }

describe('which language a new invoice starts in', () => {
  const lv = { country: 'LV', defaultLanguage: 'lv' as const }
  it('the client’s own language wins', () => {
    expect(startingInvoiceLanguage({ invoice_language: 'et', country: 'LV' }, lv)).toEqual({ language: 'et', abroad: false })
    expect(startingInvoiceLanguage({ invoice_language: 'en', country: null }, lv)).toEqual({ language: 'en', abroad: false })
  })
  it('a client in another country without a language: English, suggested', () => {
    expect(startingInvoiceLanguage({ invoice_language: null, country: 'EE' }, lv)).toEqual({ language: 'en', abroad: true })
    expect(startingInvoiceLanguage({ country: ' ee ' }, lv)).toEqual({ language: 'en', abroad: true })
  })
  it('a client at home, unknown or a patient: the clinic’s default', () => {
    expect(startingInvoiceLanguage({ invoice_language: null, country: 'LV' }, lv)).toEqual({ language: 'lv', abroad: false })
    expect(startingInvoiceLanguage({ invoice_language: null, country: null }, lv)).toEqual({ language: 'lv', abroad: false })
    expect(startingInvoiceLanguage(null, { country: 'EE', defaultLanguage: 'et' })).toEqual({ language: 'et', abroad: false })
  })
  it('a value the database would refuse is not taken as a language', () => {
    expect(startingInvoiceLanguage({ invoice_language: 'ru', country: 'LV' }, lv).language).toBe('lv')
  })
})

describe('the e-mail’s letter in the invoice’s language', () => {
  const own = { pealkiri: 'Mūsu rēķins {arve}', sissejuhatus: 'Sveiki!', lopp: 'Dentiks' }
  it('the clinic’s own letter for an invoice in the clinic’s language', () => {
    expect(mailTemplateForInvoice(own, 'lv', 'lv')).toEqual(own)
  })
  it('an invoice in another language gets the plain letter in that language, not the clinic’s Latvian one', () => {
    expect(mailTemplateForInvoice(own, 'en', 'lv')).toEqual(MAIL_TEMPLATES.en)
    expect(mailTemplateForInvoice(own, 'et', 'lv')).toEqual(DEFAULT_MAIL_TEMPLATE)
  })
  it('the invoice keeps its language: the document follows it, whatever the clinic’s default', () => {
    expect(invoiceDoc(invoice({ language: 'en' }), bank, 'lv').language).toBe('en')
    expect(invoiceDoc(invoice({ language: null }), bank, 'lv').language).toBe('lv')
  })
  it('the sender and the dialog pass the clinic’s default next to the invoice’s language', () => {
    expect(read('src/renderer/src/lib/invoiceSend.ts')).toContain('mailTemplateForInvoice(clinicTemplate, doc.language, language)')
    const fn = read('supabase/functions/send-invoices/index.ts')
    expect(fn).toContain('const doc = invoiceDoc(inv, clinic, clinicLanguage)')
    expect(fn).toContain('doc.language, clinicLanguage)')
  })
})

describe('the forms', () => {
  it('the new invoice has a language select, starting from the client’s, saved on the invoice', () => {
    const form = read('src/renderer/src/components/Invoices/InvoiceForm.tsx')
    expect(form).toContain('startingInvoiceLanguage(client,')
    expect(form).toContain('const language: DocLanguage = chosenLanguage ?? starting.language')
    expect(form).toContain("t('invoices.language')")
    expect(form).toContain("t('invoices.languageAbroadHint')")
    expect(form).toContain('const words = invoiceLabels(language).line')
    expect(form).toMatch(/^\s+language,$/m)
  })
  it('the client card has its invoice language and country', () => {
    const card = read('src/renderer/src/components/Customers/CustomersView.tsx')
    expect(card).toContain("set('invoice_language',")
    expect(card).toContain("t('customers.invoiceLanguageDefault')")
    expect(card).toContain("set('country',")
    // A database before sql/149 still saves the rest of the client.
    expect(read('src/renderer/src/hooks/useCustomers.ts')).toContain("const LATER_COLUMNS = ['kind', 'invoice_language', 'country',")
  })
})

describe('a draft has no number of the sequence', () => {
  it('a placeholder reads as the word "draft", in the document’s language', () => {
    expect(isDraftNumber('draft:4b1c')).toBe(true)
    expect(isDraftNumber('2026-0001')).toBe(false)
    expect(invoiceNumberText('draft:4b1c', 'Draft')).toBe('Draft')
    expect(invoiceNumberText('2026-0001', 'Draft')).toBe('2026-0001')
    const lv = invoiceDoc(invoice({ number: 'draft:4b1c', status: 'mustand' }), bank, 'lv')
    expect(lv.number).toBe('MELNRAKSTS')
    expect(lv.draft).toBe(true)
    expect(lv.payment?.reference).toBe('MELNRAKSTS')
    expect(invoiceDoc(invoice({ number: 'draft:4b1c', status: 'mustand' }), bank, 'en').number).toBe('DRAFT')
  })
  it('an issued invoice keeps its number and is no draft', () => {
    const d = invoiceDoc(invoice(), bank, 'en')
    expect(d.number).toBe('2026-0007')
    expect(d.draft).toBe(false)
  })
})

describe('deleting, cancelling, crediting', () => {
  it('a lost answer is told apart from a refusal', () => {
    expect(isLostAnswer(new TypeError('Failed to fetch'))).toBe(true)
    expect(isLostAnswer({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true)
    expect(isLostAnswer({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true)
    expect(isLostAnswer({ message: 'Load failed' })).toBe(true)
    expect(isLostAnswer({ message: 'Only a draft can be deleted', code: 'P0001' })).toBe(false)
    expect(isLostAnswer(null)).toBe(false)
  })
  it('the delete goes through the database’s rule, and a lost answer is checked before it is reported', () => {
    const hook = read('src/renderer/src/hooks/useInvoices.ts')
    expect(hook).toContain("supabase.rpc('delete_invoice', { p_invoice: id })")
    expect(hook).toContain('if (!isLostAnswer(e)) throw e')
    expect(hook).toContain("if (!still.error && !still.data) return")
    expect(hook).toContain("supabase.rpc('cancel_invoice', { p_invoice: id, p_reason: reason })")
    expect(hook).toContain("supabase.rpc('create_credit_note', { p_invoice: id, p_reason: reason })")
    // One reload per burst of realtime events, not one per event.
    expect(hook).toContain('setTimeout(() => { timer = null; void qc.invalidateQueries({ queryKey: QUERY_KEY }) }, REALTIME_SETTLE_MS)')
  })
  it('a draft is deleted, an issued invoice cancelled or credited, each asked first', () => {
    const ui = read('src/renderer/src/components/Invoices/InvoiceLifecycle.tsx')
    expect(ui).toContain("{invoice.status === 'mustand' && (")
    expect(ui).toContain("const issued = invoice.status === 'saadetud' || invoice.status === 'makstud'")
    expect(ui).toContain("t('invoices.deleteDraftAsk')")
    expect(ui).toContain("t('invoices.cancelInvoiceAsk',")
    // A reason is required for cancelling and crediting.
    expect(ui).toContain("disabled={busy || (asking !== 'delete' && !reason.trim())}")
    // While it works: a spinner and "Deleting…", the dialog stays and cannot be closed.
    expect(ui).toContain("t('invoices.deleting')")
    expect(ui).toContain('onClick={() => !busy && setAsking(null)}')
    const view = read('src/renderer/src/components/Invoices/InvoicesView.tsx')
    expect(view).toContain('<InvoiceLifecycle')
    expect(view).not.toContain("t('invoices.deletePermanently')")
  })
})
