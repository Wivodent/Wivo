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
  it('a failure says why in words; the mail server’s own words only for the owner, under Details', () => {
    const dialog = read('src/renderer/src/components/Invoices/SendInvoiceDialog.tsx')
    expect(dialog).toContain('{isOwner && error.detail && <ServerDetails detail={error.detail} />}')
    expect(dialog).toContain('{e.error && isOwner && <ServerDetails detail={e.error} />}')
    for (const code of ['smtp_connect', 'smtp_auth', 'sender_rejected', 'recipient_rejected', 'not_deployed', 'paevalimiit', 'test_copy_needs_test_address', 'testaadress-vigane'])
      expect(dialog).toContain(`case '${code}':`)
    expect(read('src/renderer/src/components/Invoices/InvoicesView.tsx')).toContain('sendErrorText(classifySmtpError(invoice.send_error))')
  })
  it('Settings → Invoices holds the invoice settings, the VAT rate and terms, and the e-mail’s letter; Email keeps the mailbox', () => {
    const page = read('src/renderer/src/components/SettingsPage.tsx')
    const group = page.slice(page.indexOf("{activeGroup === 'arved' && ("))
    expect(group.slice(0, 1600)).toMatch(/<InvoiceSettingsSection onOpenClinic=[\s\S]*setNumber\('kmMaar'[\s\S]*setNumber\('makseTahtaegPaevades'[\s\S]*<InvoiceMailTemplateSection \/>/)
    expect(page).toContain("{ key: 'arved', label: t('settingsPage.invoices'), icon: FileText }")
    expect(page).toContain("case 'arved': return moduleOn('invoices') && invoicesAvailable(clinicCountry(auth.clinic))")
    expect(page).toContain("<EmailSection onOpenInvoices={() => setGroup('arved')} />")
    // Prices no longer carries them; a link points to Invoices.
    expect(page.match(/setNumber\('kmMaar'/g)).toHaveLength(1)
    expect(page).toContain("{t('settingsPage.vatAndTermsLink')}")
    const email = read('src/renderer/src/components/Settings/EmailSection.tsx')
    expect(email).not.toMatch(/patch\(\{ (pealkiri|sissejuhatus|lopp):/)
    expect(email).toContain("{t('settings.invoiceEmailTextLink')}")
    for (const f of ['patch({ host:', 'patch({ saatmineLubatud:', 'patch({ paevaLimiit:', 'patch({ testAadress:']) expect(email).toContain(f)
    const letter = read('src/renderer/src/components/Settings/InvoiceMailTemplateSection.tsx')
    for (const f of ['patch({ pealkiri:', 'patch({ sissejuhatus:', 'patch({ lopp:']) expect(letter).toContain(f)
  })
  it('the Settings home has an Invoices tile in Money; the Invoices page’s gear opens the same page', () => {
    const home = read('src/renderer/src/components/Settings/SettingsHome.tsx')
    const money = home.slice(home.indexOf('const moneyTiles'), home.indexOf('const requestHref'))
    expect(money).toContain("g('arved', t('settingsHome.invoices'), t('settingsHome.invoicesDesc'))")
    expect(read('src/renderer/src/components/Invoices/InvoicesView.tsx')).toContain("<button type=\"button\" onClick={onOpenSettings} className=\"btn-ghost p-1.5\" title={t('invoices.settings')}")
    expect(read('src/renderer/src/App.tsx')).toContain("<InvoicesView jobs={jobs} onOpenSettings={() => { setSettingsAt(a => ({ group: 'arved', n: a.n + 1 })); setView('settings') }} />")
  })
  it('a settings group opens at the top, not where the home page was scrolled to (Money → Invoices)', () => {
    const page = read('src/renderer/src/components/SettingsPage.tsx')
    expect(page).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(shownGroup\.current === activeGroup\) return\s*shownGroup\.current = activeGroup\s*scroller\.current\?\.scrollTo\(\{ top: 0 \}\)\s*\}, \[activeGroup\]\)/)
    expect(page).toContain('<div ref={scroller} className="flex-1 overflow-y-auto">')
  })
})
