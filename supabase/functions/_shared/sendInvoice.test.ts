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

function setup(opts: { prep?: ReturnType<typeof prepared>; prepError?: { code?: string; message?: string }; sendFails?: boolean; smtp?: boolean } = {}) {
  const sent: Outgoing[] = []
  const records: Record<string, unknown>[] = []
  const rendered: { language: string; subject: string; message: string }[] = []
  const deps: SendInvoiceDeps = {
    prepare: async () => (opts.prepError ? { data: null, error: opts.prepError } : { data: opts.prep ?? prepared(), error: null }),
    record: async args => { records.push(args); return { error: null } },
    smtpReady: () => opts.smtp ?? true,
    render: async (doc, letter) => { rendered.push({ language: doc.language, ...letter }); return { html: '<p/>', text: '', pdf: new Uint8Array([1]), filename: 'rekins-DEN-2026-0003.pdf' } },
    send: async mail => { if (opts.sendFails) throw new Error('550 mailbox unavailable'); sent.push(mail) },
    safeError: e => (e as Error).message,
  }
  return { deps, sent, records, rendered }
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

  it('the mail server refuses: the error is recorded, nothing is marked sent, and the answer says so', async () => {
    const { deps, records } = setup({ sendFails: true })
    const a = await handleSendInvoice('Bearer x', body(), deps)
    expect(a).toEqual({ status: 502, body: { error: 'send_failed', message: '550 mailbox unavailable' } })
    expect(records[0]).toMatchObject({ p_ok: false, p_error: '550 mailbox unavailable' })
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
