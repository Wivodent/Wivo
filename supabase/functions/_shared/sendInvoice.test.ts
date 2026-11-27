/**
 * send-invoice (sql/148): one invoice sent by hand. The database decides who
 * may (as the person); the guard decides whether now and to whom; the mail
 * goes from the clinic's address with Reply-To the person and the PDF
 * attached, in the invoice's language; the outcome is recorded (Sent, or the
 * error and the invoice as it was).
 */
import { describe, it, expect } from 'vitest'
import { handleSendInvoice, type SendInvoiceDeps, type Outgoing } from './sendInvoice'
import { invoiceHtml } from './invoiceHtml'
import { invoiceDoc } from '@shared/billing/invoiceDoc'

const INV = '11111111-1111-4111-8111-111111111111'
const prepared = (over: Record<string, unknown> = {}) => ({
  invoice: { id: INV, number: 'DEN-2026-0003', status: 'mustand', patsient: 'SIA Zobi', issue_date: '2026-11-27', due_date: '2026-12-11',
    vat_rate: 21, net_total: 100, vat_total: 21, gross_total: 121, note: null, lines: [{ description: 'Kronis', qty: 1, unit_price: 100 }], payments: [] },
  clinic: { name: 'SIA Dentiks', country: 'LV', reg_code: '40003000000' },
  email: { saatjaAadress: 'arved@dentiks.lv', saatjaNimi: 'Dentiks', paevaLimiit: 20, testAadress: null },
  language: null,
  sent_today: 0,
  caller: { id: 'u1', email: 'anna@dentiks.lv' },
  ...over,
})

function setup(opts: { prep?: ReturnType<typeof prepared>; prepError?: { code?: string; message?: string }; sendFails?: boolean | string; smtp?: boolean; allowOnly?: string } = {}) {
  const sent: Outgoing[] = []
  const logged: string[] = []
  const records: Record<string, unknown>[] = []
  const rendered: { language: string; subject: string; message: string }[] = []
  const deps: SendInvoiceDeps = {
    prepare: async () => (opts.prepError ? { data: null, error: opts.prepError } : { data: opts.prep ?? prepared(), error: null }),
    record: async args => { records.push(args); return { error: null } },
    smtpReady: () => opts.smtp ?? true,
    render: async (doc, letter) => { rendered.push({ language: doc.language, ...letter }); return { html: '<p/>', text: '', pdf: new Uint8Array([1]), filename: 'rekins-DEN-2026-0003.pdf' } },
    send: async mail => { if (opts.sendFails) throw new Error(typeof opts.sendFails === 'string' ? opts.sendFails : '550 mailbox unavailable'); sent.push(mail) },
    safeError: e => (e as Error).message,
    allowOnly: opts.allowOnly,
    log: line => { logged.push(line) },
  }
  return { deps, sent, records, rendered, logged }
}
const body = (over: Record<string, unknown> = {}) => ({ invoiceId: INV, to: ['buh@zobi.lv', 'boss@zobi.lv'], subject: 'Rēķins DEN-2026-0003', message: 'Labdien!', copyToMe: true, ...over })

describe('sending one invoice by hand', () => {
  it('sent: from the clinic, Reply-To the person, a hidden copy for them, the PDF, in Latvian; recorded as sent', async () => {
    const { deps, sent, records, rendered } = setup()
    const a = await handleSendInvoice('Bearer x', body(), deps)
    expect(a).toEqual({ status: 200, body: { ok: true, recorded: true, to: ['buh@zobi.lv', 'boss@zobi.lv'], redirected: false } })
    expect(sent[0]).toMatchObject({ fromAddress: 'arved@dentiks.lv', fromName: 'Dentiks', to: ['buh@zobi.lv', 'boss@zobi.lv'],
      bcc: ['anna@dentiks.lv'], replyTo: 'anna@dentiks.lv', subject: 'Rēķins DEN-2026-0003', attachment: { filename: 'rekins-DEN-2026-0003.pdf' } })
    expect(rendered[0]).toEqual({ language: 'lv', subject: 'Rēķins DEN-2026-0003', message: 'Labdien!' })
    expect(records[0]).toMatchObject({ p_invoice: INV, p_by: 'u1', p_to: ['buh@zobi.lv', 'boss@zobi.lv'], p_copy: true, p_ok: true, p_error: null })
  })

  it('the mail server refuses: what kind of refusal, the server’s words for the details, recorded, nothing marked sent', async () => {
    const said = '550 5.1.1 <buh@zobi.lv>: Recipient address rejected: User unknown'
    const { deps, records } = setup({ sendFails: said })
    const a = await handleSendInvoice('Bearer x', body(), deps)
    expect(a).toEqual({ status: 502, body: { error: 'send_failed', reason: 'recipient_rejected', detail: said } })
    expect(records[0]).toMatchObject({ p_ok: false, p_error: said })
    const kinds: [string, string][] = [['535 5.7.8 Authentication failed', 'smtp_auth'], ['Connection refused (os error 111)', 'smtp_connect'],
      ['553 5.7.1 Sender address rejected: not owned by user', 'sender_rejected']]
    for (const [text, reason] of kinds) {
      expect((await handleSendInvoice('Bearer x', body(), setup({ sendFails: text }).deps)).body).toMatchObject({ error: 'send_failed', reason })
    }
  })

  it('the function log: the invoice, the outcome, the reply code; never an address, a name or the subject', async () => {
    const failed = setup({ sendFails: '550 5.1.1 <buh@zobi.lv>: Recipient address rejected' })
    await handleSendInvoice('Bearer x', body(), failed.deps)
    const ok = setup()
    await handleSendInvoice('Bearer x', body(), ok.deps)
    const refused = setup({ prep: prepared({ sent_today: 20 }) })
    await handleSendInvoice('Bearer x', body(), refused.deps)
    expect(failed.logged).toEqual([`invoice ${INV}: send failed recipient_rejected (550 5.1.1)`])
    expect(ok.logged).toEqual([`invoice ${INV}: sent to 2`])
    expect(refused.logged).toEqual([`invoice ${INV}: refused paevalimiit`])
    for (const line of [...failed.logged, ...ok.logged, ...refused.logged]) expect(line).not.toMatch(/@|Zobi|Rēķins|Labdien/)
  })

  it('the test copy (EMAIL_ALLOW_ONLY): real addresses refused before sending; a test address must be allowed; a copy only if allowed', async () => {
    const real = setup({ allowOnly: '@wivodent.com' })
    expect((await handleSendInvoice('Bearer x', body(), real.deps)).body).toEqual({ error: 'refused', code: 'test_copy_needs_test_address' })
    expect(real.sent).toEqual([])
    const wrongTest = setup({ allowOnly: '@wivodent.com', prep: prepared({ email: { saatjaAadress: 'arved@dentiks.lv', paevaLimiit: 20, testAadress: 'test@dentiks.lv' } }) })
    expect((await handleSendInvoice('Bearer x', body(), wrongTest.deps)).body).toEqual({ error: 'refused', code: 'test_address_not_allowed' })
    const allowed = setup({ allowOnly: '@wivodent.com' })
    await handleSendInvoice('Bearer x', body({ to: ['kevin@wivodent.com'] }), allowed.deps)
    // anna@dentiks.lv (the sender's own copy) is not allowed on the test copy: left out.
    expect(allowed.sent[0]).toMatchObject({ to: ['kevin@wivodent.com'], bcc: [] })
  })

  it('a draft is issued first (sql/149): the e-mail and its PDF carry its number', async () => {
    let issued = false
    const { deps, rendered } = setup()
    const draftPrep = prepared({ invoice: { ...prepared().invoice, number: 'draft:abc' } })
    deps.prepare = async () => ({ data: issued ? prepared() : draftPrep, error: null })
    deps.issue = async () => { issued = true; return { error: null } }
    expect((await handleSendInvoice('Bearer x', body(), deps)).status).toBe(200)
    expect(issued).toBe(true)
    expect(rendered).toHaveLength(1)
  })

  it('a refused try takes no number (sql/149): the draft is issued only once every check has passed', async () => {
    let issued = 0
    const draftPrep = prepared({ invoice: { ...prepared().invoice, number: 'draft:abc' } })
    const refused = setup({ prep: draftPrep, allowOnly: 'test@dentiks.lv' })
    refused.deps.issue = async () => { issued++; return { error: null } }
    expect((await handleSendInvoice('Bearer x', body(), refused.deps)).body).toMatchObject({ error: 'refused', code: 'test_copy_needs_test_address' })
    const noSmtp = setup({ prep: draftPrep, smtp: false })
    noSmtp.deps.issue = async () => { issued++; return { error: null } }
    expect((await handleSendInvoice('Bearer x', body(), noSmtp.deps)).status).toBe(503)
    expect(issued).toBe(0)
  })

  it('the letter names the number the draft was to get, and someone took it first: nothing sent, the new number back (sql/150)', async () => {
    let issued = false
    const { deps, sent, records, logged } = setup()
    const draftPrep = prepared({ invoice: { ...prepared().invoice, number: 'draft:abc' } })
    deps.prepare = async () => ({ data: issued ? prepared({ invoice: { ...prepared().invoice, number: 'DEN-2026-0004' } }) : draftPrep, error: null })
    deps.issue = async () => { issued = true; return { error: null } }
    const a = await handleSendInvoice('Bearer x', body({ expectedNumber: 'DEN-2026-0003' }), deps)
    expect(a).toEqual({ status: 409, body: { error: 'number_changed', number: 'DEN-2026-0004' } })
    expect(sent).toHaveLength(0)
    expect(records).toHaveLength(0)
    expect(logged).toEqual([`invoice ${INV}: number changed`])
    // Sent again with the new number: it goes.
    expect((await handleSendInvoice('Bearer x', body({ expectedNumber: 'DEN-2026-0004' }), deps)).status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('the number it was to get is the one it got: sent; an older app without expectedNumber: sent as before', async () => {
    let issued = false
    const { deps, sent } = setup()
    const draftPrep = prepared({ invoice: { ...prepared().invoice, number: 'draft:abc' } })
    deps.prepare = async () => ({ data: issued ? prepared() : draftPrep, error: null })
    deps.issue = async () => { issued = true; return { error: null } }
    expect((await handleSendInvoice('Bearer x', body({ expectedNumber: 'DEN-2026-0003' }), deps)).status).toBe(200)
    expect((await handleSendInvoice('Bearer x', body(), setup().deps)).status).toBe(200)
    expect(sent).toHaveLength(1)
  })

  it('a test address that is not an address says so', async () => {
    const bad = setup({ prep: prepared({ email: { saatjaAadress: 'arved@dentiks.lv', paevaLimiit: 20, testAadress: 'not an address' } }) })
    expect((await handleSendInvoice('Bearer x', body(), bad.deps)).body).toEqual({ error: 'refused', code: 'testaadress-vigane' })
  })

  it('refused before anything is sent: no sender address, the daily cap, a bad address; not set up; not allowed', async () => {
    const noSender = setup({ prep: prepared({ email: { saatjaAadress: '' } }) })
    expect((await handleSendInvoice('Bearer x', body(), noSender.deps)).body).toEqual({ error: 'refused', code: 'saatja-puudub' })
    const cap = setup({ prep: prepared({ sent_today: 20 }) })
    expect((await handleSendInvoice('Bearer x', body(), cap.deps)).body).toEqual({ error: 'refused', code: 'paevalimiit' })
    const badTo = setup()
    expect((await handleSendInvoice('Bearer x', body({ to: ['nope'] }), badTo.deps)).body).toEqual({ error: 'refused', code: 'saaja-vigane' })
    const noSmtp = setup({ smtp: false })
    expect((await handleSendInvoice('Bearer x', body(), noSmtp.deps)).status).toBe(503)
    const denied = setup({ prepError: { code: '42501', message: 'Edit payments is needed' } })
    expect((await handleSendInvoice('Bearer x', body(), denied.deps))).toEqual({ status: 403, body: { error: 'not_allowed' } })
    for (const s of [noSender, cap, badTo, noSmtp, denied]) { expect(s.sent).toEqual([]); expect(s.records).toEqual([]) }
  })

  it('the test address takes it: no copy to the person, the typed addresses kept in the history', async () => {
    const { deps, sent, records } = setup({ prep: prepared({ email: { saatjaAadress: 'arved@dentiks.lv', paevaLimiit: 20, testAadress: 'test@dentiks.lv' } }) })
    await handleSendInvoice('Bearer x', body(), deps)
    expect(sent[0]).toMatchObject({ to: ['test@dentiks.lv'], bcc: [] })
    expect(records[0]).toMatchObject({ p_to: ['buh@zobi.lv', 'boss@zobi.lv'], p_redirected: 'test@dentiks.lv', p_ok: true })
  })

  it('no token, a bad body: answered before the database is asked', async () => {
    const { deps } = setup()
    expect((await handleSendInvoice(null, body(), deps)).status).toBe(401)
    expect((await handleSendInvoice('Bearer x', body({ invoiceId: 'x' }), deps)).status).toBe(400)
    expect((await handleSendInvoice('Bearer x', body({ to: ['a@b.lv', 3] }), deps)).status).toBe(400)
  })

  it('the e-mail’s number columns: right-aligned, never wrapping, as wide as their content; the short heading on a narrow screen', () => {
    const p = prepared()
    for (const lang of ['et', 'lv', 'en'] as const) {
      const html = invoiceHtml(invoiceDoc(p.invoice, { name: 'Dentiks' }, lang))
      const L = invoiceDoc(p.invoice, null, lang).labels
      const col = 'width:1%;text-align:right;white-space:nowrap;padding-left:16px;'
      expect(html, lang).toContain(L.quantity === L.quantityShort ? `${col}">${L.quantity}</th>` : `${col}"><span class="wv-full">${L.quantity}</span><span class="wv-short">${L.quantityShort}</span></th>`)
      expect(html, lang).toContain(`${col}"><span class="wv-full">${L.unitPrice}</span><span class="wv-short">${L.unitPriceShort}</span></th>`)
      expect(html, lang).toContain(`${col}">${L.amount}</th>`)
      expect(html).not.toMatch(/table-layout:fixed|width:\d+px;text-align:right/)
      expect(html).toContain('@media (max-width:480px)')
    }
  })

  it('an Estonian clinic’s invoice reads as before in the e-mail; a Latvian one in Latvian', () => {
    const p = prepared()
    const et = invoiceHtml(invoiceDoc({ ...p.invoice, number: '2026-0001' }, { name: 'Kliinik OÜ' }))
    expect(et).toContain('<html lang="et">')
    for (const w of ['>ARVE<', 'Maksja', 'Kokku tasuda', 'Kirjeldus', 'Ühiku hind']) expect(et).toContain(w)
    const lv = invoiceHtml(invoiceDoc(p.invoice, { name: 'SIA Dentiks' }, 'lv'))
    expect(lv).toContain('<html lang="lv">')
    for (const w of ['RĒĶINS', 'Maksātājs', 'Kopā apmaksai', 'PVN 21%']) expect(lv).toContain(w)
  })
})
