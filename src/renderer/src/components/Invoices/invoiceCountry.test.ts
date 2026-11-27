/**
 * Invoices for Latvia (sql/148), as the screens use them: the settings, the
 * form, the printed page, the e-mail section and the hand-sent e-mail.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(p, 'utf8')

describe('Latvian invoices on the screens', () => {
  it('the printed page uses the document’s words in its language, never the interface’s', () => {
    const view = read('src/renderer/src/components/Invoices/InvoicePrintView.tsx')
    expect(view).toContain("invoiceDoc(invoice, clinic, docLanguageFor(clinicCountry(clinic), settings.arveKeel))")
    expect(view).not.toContain('translate(')
    expect(view).toContain('{totals.vatExemptNote && (')
    expect(view).toContain('{doc.serviceDate && (')
  })
  it('the form keeps the language, the service date, the exemption and the client’s details on the invoice', () => {
    const form = read('src/renderer/src/components/Invoices/InvoiceForm.tsx')
    for (const f of ['language: docLanguageFor(', 'service_date:', 'vat_exempt_note: exempt ?', 'buyer_reg_code:', 'buyer_vat_number:', 'buyer_address:'])
      expect(form).toContain(f)
    expect(form).toContain('buyerDetailsMissing(chosenCustomer)')
  })
  it('the e-mail section and the invoice settings show for every country with invoices (Latvia too)', () => {
    const page = read('src/renderer/src/components/SettingsPage.tsx')
    expect(page).toContain("case 'epost': return moduleOn('invoices') && invoicesAvailable(clinicCountry(auth.clinic))")
    expect(page).toContain('<InvoiceSettingsSection onOpenClinic=')
  })
  it('the invoice panel sends by hand and shows the history', () => {
    const panel = read('src/renderer/src/components/Invoices/InvoicesView.tsx')
    expect(panel).toContain("{canWrite && invoice.status !== 'tuhistatud' && (")
    expect(panel).toContain('<SendInvoiceDialog invoice={invoice}')
    expect(panel).toContain('<InvoiceSendHistory invoiceId={invoice.id}')
  })
})
