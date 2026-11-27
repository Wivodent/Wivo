/**
 * Invoices for Latvia next to Estonia (sql/148): the country file, the words
 * in the document's language, an exempt invoice with its reason, 21% VAT, and
 * an Estonian invoice exactly as before. Plus the hand-sending guard and the
 * letter in the invoice's language.
 */
import { describe, it, expect } from 'vitest'
import { invoiceDoc, invoiceLabels, type DocInvoice, type DocClinic } from './invoiceDoc'
import { countryInvoicing, docLanguageFor, cleanPrefix } from './countryInvoice'
import { mayHandSendInvoice, splitAddresses } from './sendGuard'
import { mailTemplateForInvoice, MAIL_TEMPLATES, DEFAULT_MAIL_TEMPLATE } from './mailTemplate'
import { translate, type MessageKey } from '../i18n'

const lvClinic: DocClinic = {
  name: 'SIA Dentiks', address: 'Brīvības iela 1', postal_code: 'LV-1010', city: 'Rīga',
  reg_code: '40003000000', vat_number: 'LV40003000000', bank_name: 'Swedbank', bank_account: 'LV00HABA0000000000000',
}
const eeClinic: DocClinic = {
  name: 'Fullgevity Dental OÜ', address: 'Pärnu mnt 1', postal_code: '10141', city: 'Tallinn',
  reg_code: '12345678', vat_number: 'EE101234567', bank_name: 'LHV Pank', bank_account: 'EE001234567890',
}
const inv = (over: Partial<DocInvoice> = {}): DocInvoice => ({
  number: 'DEN-2026-0001', status: 'saadetud', patsient: 'SIA Zobi', issue_date: '2026-11-27', due_date: '2026-12-11',
  vat_rate: 21, net_total: 100, vat_total: 21, gross_total: 121, note: null,
  lines: [{ description: 'Cirkonija kronis', qty: 1, unit_price: 100 }], ...over,
})

describe('the country file', () => {
  it('Estonia and Latvia have invoices; e-mail too (the letter is in the invoice’s language); others none', () => {
    expect(countryInvoicing('EE')).toMatchObject({ invoices: true, email: true, language: 'et', standardVatPct: 24 })
    expect(countryInvoicing('lv')).toMatchObject({ invoices: true, language: 'lv', standardVatPct: 21 })
    expect(countryInvoicing('FI').invoices).toBe(false)
    expect(docLanguageFor('LV', '')).toBe('lv')
    expect(docLanguageFor('LV', 'en')).toBe('en')
    expect(docLanguageFor('EE', 'xx')).toBe('et')
  })
  it('the number’s prefix: no spaces, only letters, digits, - / _', () => {
    expect(cleanPrefix(' DEN - 2/ä ')).toBe('DEN-2/')
    expect(cleanPrefix('ABCDEFGHIJKLMNOP')).toHaveLength(12)
  })
})

describe('the words on an invoice', () => {
  it('Estonian and English are the app’s own texts (shared/i18n invoiceDoc.*)', () => {
    const keys = ['invoice', 'number', 'date', 'dueDate', 'serviceDate', 'payer', 'description', 'quantity', 'unitPrice', 'amount',
      'totalDue', 'received', 'outstanding', 'payment', 'cancelled', 'vatExempt'] as const
    for (const lang of ['et', 'en'] as const) {
      for (const k of keys) expect(invoiceLabels(lang)[k], `${lang} ${k}`).toBe(translate(lang, `invoiceDoc.${k}` as MessageKey))
      expect(invoiceLabels(lang).reference('X')).toBe(translate(lang, 'invoiceDoc.reference', { reference: 'X' }))
    }
  })
})

describe('a Latvian clinic', () => {
  it('VAT exempt: no VAT, the reason printed, the words in Latvian', () => {
    const doc = invoiceDoc(inv({ vat_rate: 0, vat_total: 0, gross_total: 100, language: 'lv',
      vat_exempt_note: 'PVN likuma 52. panta pirmās daļas 12. punkts', buyer_reg_code: '40103000000', buyer_vat_number: 'LV40103000000',
      buyer_address: 'Elizabetes iela 2, Rīga', service_date: '2026-11-20' }), lvClinic)
    expect(doc.language).toBe('lv')
    expect(doc.labels.invoice).toBe('RĒĶINS')
    expect(doc.totals).toMatchObject({ vatExempt: true, vatLabel: 'Atbrīvots no PVN', netLabel: 'Summa (atbrīvots no PVN)',
      vatExemptNote: 'PVN likuma 52. panta pirmās daļas 12. punkts', vat: 0, gross: 100 })
    expect(doc.seller.lines).toContain('Reģ. Nr. 40003000000')
    expect(doc.seller.lines).toContain('PVN reģ. Nr. LV40003000000')
    expect(doc.buyer.lines).toEqual(['Elizabetes iela 2, Rīga', 'Reģ. Nr. 40103000000', 'PVN reģ. Nr. LV40103000000'])
    expect(doc.serviceDate).toBe('20.11.2026')
    expect(doc.payment?.reference).toBe('rēķins DEN-2026-0001')
  })

  it('21%: the taxable amount at that rate, its VAT, the total; no exemption', () => {
    const doc = invoiceDoc(inv(), lvClinic, 'lv')
    expect(doc.totals).toMatchObject({ vatExempt: false, vatExemptNote: null, vatLabel: 'PVN 21%', netLabel: 'Ar PVN 21% apliekamā summa',
      net: 100, vat: 21, gross: 121 })
    // The service date only when it differs from the invoice date.
    expect(invoiceDoc(inv({ service_date: '2026-11-27' }), lvClinic, 'lv').serviceDate).toBeNull()
  })

  it('an exempt note on an invoice that charges VAT is not an exemption', () => {
    expect(invoiceDoc(inv({ vat_exempt_note: 'x' }), lvClinic, 'lv').totals.vatExempt).toBe(false)
  })
})

describe('an Estonian clinic: as before', () => {
  it('the same words and lines as every Estonian invoice so far', () => {
    const doc = invoiceDoc(inv({ number: '2026-0007', vat_rate: 24, vat_total: 24, gross_total: 124, patsient: 'Mari Maasikas' }), eeClinic)
    expect(doc.language).toBe('et')
    expect(doc.seller.lines).toEqual(['Pärnu mnt 1', '10141 Tallinn', 'Reg nr 12345678', 'KMKR EE101234567'])
    expect(doc.buyer).toEqual({ name: 'Mari Maasikas', lines: [] })
    expect(doc.totals).toMatchObject({ vatLabel: 'Käibemaks 24%', netLabel: 'Summa', vatExempt: false })
    expect(doc.payment?.reference).toBe('arve 2026-0007')
    expect(doc.serviceDate).toBeNull()
    expect(doc.labels.invoice).toBe('ARVE')
  })
})

describe('sending one invoice by hand', () => {
  const policy = { saatjaAadress: 'arved@dentiks.lv', paevaLimiit: 20, testAadress: null }
  it('a person’s act: a draft, or one already sent, goes; the cap, a missing sender, a cancelled invoice or a bad address do not', () => {
    expect(mayHandSendInvoice({ status: 'mustand' }, policy, ['buh@zobi.lv', ' boss@zobi.lv', 'buh@zobi.lv'], 'Rēķins', 0))
      .toEqual({ send: true, to: ['buh@zobi.lv', 'boss@zobi.lv'], redirected: false })
    expect(mayHandSendInvoice({ status: 'saadetud' }, { ...policy, saatjaAadress: '' }, ['a@b.lv'], 'x', 0)).toEqual({ send: false, code: 'saatja-puudub' })
    expect(mayHandSendInvoice({ status: 'tuhistatud' }, policy, ['a@b.lv'], 'x', 0)).toEqual({ send: false, code: 'tuhistatud' })
    expect(mayHandSendInvoice({ status: 'saadetud' }, policy, ['a@b.lv'], 'x', 20)).toEqual({ send: false, code: 'paevalimiit' })
    expect(mayHandSendInvoice({ status: 'saadetud' }, policy, ['not-an-address'], 'x', 0)).toEqual({ send: false, code: 'saaja-vigane' })
    expect(mayHandSendInvoice({ status: 'saadetud' }, policy, [], 'x', 0)).toEqual({ send: false, code: 'saajad-puuduvad' })
    expect(mayHandSendInvoice({ status: 'saadetud' }, policy, ['a@b.lv'], '  ', 0)).toEqual({ send: false, code: 'teema-puudub' })
  })
  it('the test address takes every copy while it is set', () => {
    expect(mayHandSendInvoice({ status: 'saadetud' }, { ...policy, testAadress: 'test@dentiks.lv' }, ['buh@zobi.lv'], 'x', 0))
      .toEqual({ send: true, to: ['test@dentiks.lv'], redirected: true })
  })
  it('addresses typed with commas, semicolons or spaces', () => {
    expect(splitAddresses('a@b.lv, c@d.lv; e@f.lv\ng@h.lv')).toEqual(['a@b.lv', 'c@d.lv', 'e@f.lv', 'g@h.lv'])
  })
  it('the letter: the clinic’s own when written, else the plain one in the invoice’s language', () => {
    expect(mailTemplateForInvoice(null, 'lv')).toEqual(MAIL_TEMPLATES.lv)
    expect(mailTemplateForInvoice(DEFAULT_MAIL_TEMPLATE, 'lv')).toEqual(MAIL_TEMPLATES.lv)
    const own = { pealkiri: 'Mūsu rēķins {arve}', sissejuhatus: 'Sveiki!', lopp: '' }
    expect(mailTemplateForInvoice(own, 'lv')).toEqual({ ...own, lopp: MAIL_TEMPLATES.lv.lopp })
    expect(mailTemplateForInvoice(null, 'et')).toEqual(DEFAULT_MAIL_TEMPLATE)
  })
})
