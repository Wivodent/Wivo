import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const { prefillLetter, sendErrorFrom } = await import('./invoiceSend')
const { buyerDetailsMissing } = await import('./invoiceBuyer')

const invoice = {
  number: 'DEN-2026-0003', status: 'mustand', patsient: 'SIA Zobi', issue_date: '2026-11-27', due_date: '2026-12-11',
  vat_rate: 21, net_total: 100, vat_total: 21, gross_total: 121, note: null, lines: [{ description: 'Kronis', qty: 1, unit_price: 100 }],
}

describe('the hand-sent letter, filled in (sql/148)', () => {
  it('a Latvian invoice: the plain letter in Latvian, to the client’s invoice address and its copies', () => {
    const l = prefillLetter(invoice, { name: 'SIA Dentiks' }, 'lv', null, { email: 'buh@zobi.lv', cc_emails: ['boss@zobi.lv', 'buh@zobi.lv'] })
    expect(l.to).toEqual(['buh@zobi.lv', 'boss@zobi.lv'])
    expect(l.subject).toBe('Rēķins DEN-2026-0003 — apmaksas termiņš 11.12.2026')
    expect(l.message).toContain('Labdien, SIA Zobi!')
    expect(l.message).toContain('SIA Dentiks')
  })
  it('the clinic’s own letter when it wrote one; no address when the addressee has none', () => {
    const l = prefillLetter(invoice, { name: 'SIA Dentiks' }, 'lv', { pealkiri: 'Invoice {arve}', sissejuhatus: 'Hi {saaja}', lopp: 'Bye' }, { email: null })
    expect(l).toEqual({ to: [], subject: 'Invoice DEN-2026-0003', message: 'Hi SIA Zobi\n\nBye' })
  })
})

describe('a company client’s details on an invoice', () => {
  it('warned, not refused; a person is not asked', () => {
    expect(buyerDetailsMissing({ kind: 'clinic', reg_code: '1', vat_number: '', address: null })).toEqual(['vat', 'address'])
    expect(buyerDetailsMissing({ reg_code: null, vat_number: null, address: null })).toEqual(['reg', 'vat', 'address'])
    expect(buyerDetailsMissing({ kind: 'person' })).toEqual([])
  })
})

describe('why "Send by e-mail" failed, from what supabase-js hands back', () => {
  const http = (status: number, body: unknown) => ({ name: 'FunctionsHttpError', context: { status, json: async () => body } })
  it('the function’s own answer: refused, or the mail server’s kind with its words', async () => {
    expect((await sendErrorFrom(http(422, { error: 'refused', code: 'paevalimiit' }))).code).toBe('paevalimiit')
    const smtp = await sendErrorFrom(http(502, { error: 'send_failed', reason: 'smtp_auth', detail: '535 Authentication failed' }))
    expect([smtp.code, smtp.detail]).toEqual(['smtp_auth', '535 Authentication failed'])
    expect((await sendErrorFrom(http(503, { error: 'smtp_not_set_up' }))).code).toBe('smtp_not_set_up')
  })
  it('no answer of ours: the function is not there (not deployed), or could not be reached', async () => {
    expect((await sendErrorFrom(http(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }))).code).toBe('not_deployed')
    expect((await sendErrorFrom({ name: 'FunctionsFetchError', context: {} })).code).toBe('unreachable')
    expect((await sendErrorFrom({ name: 'FunctionsRelayError' })).code).toBe('unreachable')
    expect((await sendErrorFrom(new Error('x'))).code).toBe('failed')
  })
})
