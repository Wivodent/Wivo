/**
 * Where a client's invoice goes, on the screens (sql/152): "Send by e-mail"
 * starts filled in (billing e-mail → invoice e-mail → the Network account's),
 * the automatic sender asks the same, the client's card has both fields, the
 * Network profile has "Billing e-mail for invoices", and an automatic draft
 * without an address says so with "Add e-mail" opening the client's card.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const { clientInvoiceAddress, prefillLetter } = await import('../../lib/invoiceSend')

const read = (p: string) => readFileSync(p, 'utf8')

describe('where a client’s invoice goes', () => {
  it('the billing e-mail, else the invoice e-mail, else the Network account’s address', () => {
    expect(clientInvoiceAddress({ billing_email: 'buh@zobi.lv', email: 'office@zobi.lv' }, 'anna@zobi.lv')).toBe('buh@zobi.lv')
    expect(clientInvoiceAddress({ billing_email: ' ', email: 'office@zobi.lv' }, 'anna@zobi.lv')).toBe('office@zobi.lv')
    expect(clientInvoiceAddress({ billing_email: null, email: null }, 'anna@zobi.lv')).toBe('anna@zobi.lv')
    expect(clientInvoiceAddress(null, null)).toBeNull()
  })

  it('"Send by e-mail" starts filled in with it, the copies after it', () => {
    const invoice = { number: 'DEN-2026-0003', status: 'saadetud', patsient: 'SIA Zobi', issue_date: '2026-11-27', due_date: '2026-12-11',
      vat_rate: 21, net_total: 100, vat_total: 21, gross_total: 121, note: null, lines: [] }
    const to = prefillLetter(invoice, null, 'lv', null, { email: 'anna@zobi.lv', cc_emails: ['boss@zobi.lv'] }).to
    expect(to).toEqual(['anna@zobi.lv', 'boss@zobi.lv'])
    const dialog = read('src/renderer/src/components/Invoices/SendInvoiceDialog.tsx')
    expect(dialog).toContain("supabase.rpc('invoice_recipient_email', { p_customer: invoice.customer_id })")
    expect(dialog).toContain('email: clientAddress.data ?? clientInvoiceAddress(client)')
    // Filled in only once the address has arrived: never an empty "To" that fills a moment later.
    expect(dialog).toContain('(!invoice.customer_id || clientAddress.isFetched)')
  })

  it('the automatic sender asks the database the same question', () => {
    const fn = read('supabase/functions/send-invoices/index.ts')
    expect(fn).toContain("db.rpc('customer_invoice_address', { p_customer: inv.customer_id })")
    expect(read('sql/152_client_invoice_email.sql')).toContain("if coalesce(public.customer_invoice_address(v_cust), '') !~")
  })
})

describe('the screens', () => {
  it('the client’s card: invoice e-mail and billing e-mail', () => {
    const card = read('src/renderer/src/components/Customers/CustomersView.tsx')
    expect(card).toContain("t('customers.invoiceEmail')")
    expect(card).toContain("set('billing_email', e.target.value.trim() || null)")
    expect(read('src/renderer/src/hooks/useCustomers.ts')).toContain("'billing_email'] as const")
  })

  it('an automatic draft without an address: "Not sent" and "Add e-mail", which opens the client’s card', () => {
    const note = read('src/renderer/src/components/Invoices/AutoInvoiceNote.tsx')
    expect(note).toContain("reasons.includes('no_email')")
    expect(note).toContain("t('autoInvoice.notSentNoEmail')")
    expect(note).toContain("onClick={() => onAddEmail(invoice.customer_id!)}")
    expect(read('src/renderer/src/components/Invoices/InvoicesView.tsx')).toContain('<AutoInvoiceNote invoice={invoice} onAddEmail={onOpenCustomer} />')
    expect(read('src/renderer/src/App.tsx')).toContain("onOpenCustomer={id => { setCustomersFocus(f => ({ customerId: id, n: f.n + 1 })); setView('kliendid') }}")
    expect(read('src/renderer/src/components/Customers/CustomersView.tsx')).toContain('handledFocus.current = focus.n')
  })

  it('the Network profile: "Billing e-mail for invoices", optional, once the Network has it', () => {
    const profile = read('src/renderer/src/mobile/network/NetworkApp.tsx')
    expect(profile).toContain('const hasBilling = account?.billing_email !== undefined')
    expect(profile).toContain("...(hasBilling ? { billing_email: billing.trim() || null } : {})")
    expect(profile).toContain("t('network.billingEmail')")
  })
})
