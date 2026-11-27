/**
 * sql/148: invoices for Latvia next to Estonia (the number's prefix, what an
 * EU invoice keeps on itself, VAT exempt with its reason), and one invoice
 * sent by e-mail by hand (asked as the person, recorded with the service key).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
const year = new Date().getFullYear()

async function service<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try {
    const { rows } = await db.query<{ r: T }>(sql, params)
    return rows[0]?.r as T
  } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
const pricing = (org: string, p: Record<string, unknown>) => db.query(`insert into public.clinic_settings (clinic_id, pricing) values ($1, $2::jsonb)
  on conflict (clinic_id) do update set pricing = coalesce(public.clinic_settings.pricing, '{}'::jsonb) || excluded.pricing`, [org, JSON.stringify(p)])
async function invoice(org: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cols = { clinic_id: org, number: `T-${Math.random().toString(36).slice(2, 8)}`, patsient: 'SIA Zobi', vat_rate: 21, ...extra }
  const keys = Object.keys(cols)
  const { rows } = await db.query<{ id: string }>(`insert into public.invoices (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(cols))
  await db.query(`insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kronis', 1, 100)`, [rows[0].id])
  return rows[0].id
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
  await db.query(`update public.clinics set country = 'LV' where id = $1`, [A.clinicId])
}, 120_000)

describe('the number: the clinic’s prefix before the same yearly sequence', () => {
  it('no prefix: exactly as before; a prefix: before it; spaces and odd characters never', async () => {
    const [{ n: first }] = await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.next_invoice_number($1) as n`, [A.clinicId])
    expect(first).toBe(`${year}-0001`)
    await pricing(A.clinicId, { arvePrefiks: 'DEN-' })
    const [{ n: second }] = await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.next_invoice_number($1) as n`, [A.clinicId])
    expect(second).toBe(`DEN-${year}-0002`)
    await pricing(A.clinicId, { arvePrefiks: 'D E N! ' })
    const [{ n: third }] = await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.next_invoice_number($1) as n`, [A.clinicId])
    expect(third).toBe(`DEN${year}-0003`)
    await pricing(A.clinicId, { arvePrefiks: '' })
  })
})

describe('what an invoice keeps on itself', () => {
  it('VAT exempt only at 0%, with its reason; the language one of et, lv, en', async () => {
    expect(await invoice(A.clinicId, { vat_rate: 0, vat_exempt_note: 'PVN likuma 52. panta 1. daļas 12. punkts', language: 'lv', service_date: '2026-11-20',
      buyer_reg_code: '40003000000', buyer_vat_number: 'LV40003000000', buyer_address: 'Brīvības iela 1, Rīga' })).toBeTruthy()
    await expect(invoice(A.clinicId, { vat_rate: 21, vat_exempt_note: 'exempt' })).rejects.toThrow(/invoices_vat_exempt_valid/)
    await expect(invoice(A.clinicId, { language: 'fi' })).rejects.toThrow(/invoices_language_valid/)
  })
})

describe('sending one invoice by hand', () => {
  it('asked as someone who edits payments in the invoice’s clinic', async () => {
    const id = await invoice(A.clinicId, { status: 'mustand' })
    const [{ p }] = await rowsAs<{ p: { invoice: { id: string; lines: unknown[] }; clinic: { country: string }; caller: { id: string; email: string | null }; sent_today: number } }>(
      db, { id: A.ownerId }, `select public.invoice_send_prepare($1) as p`, [id])
    expect(p.invoice.id).toBe(id)
    expect(p.invoice.lines).toHaveLength(1)
    expect(p.clinic.country).toBe('LV')
    expect(p.caller.id).toBe(A.ownerId)
    expect(await errorAs(db, { id: A.workerId }, `select public.invoice_send_prepare($1)`, [id])).toMatch(/Edit payments/)
    await grant(db, A, A.workerId, ['payments.write'])
    expect(await errorAs(db, { id: A.workerId }, `select public.invoice_send_prepare($1)`, [id])).toBeNull()
    expect(await errorAs(db, { id: B.ownerId }, `select public.invoice_send_prepare($1)`, [id])).toMatch(/not found/)
  })

  it('sent: the draft becomes Sent and the try is kept; failed: the error, still a draft', async () => {
    const ok = await invoice(A.clinicId, { status: 'mustand' })
    await service(`select public.invoice_send_record($1, $2, $3, 'Rēķins', true, null, true, null)`, [ok, A.ownerId, ['buh@zobi.lv', 'boss@zobi.lv']])
    const { rows: [i] } = await db.query<{ status: string; sent_at: string | null; send_error: string | null }>(`select status, sent_at, send_error from public.invoices where id = $1`, [ok])
    expect(i).toMatchObject({ status: 'saadetud', send_error: null })
    expect(i.sent_at).not.toBeNull()

    const bad = await invoice(A.clinicId, { status: 'mustand' })
    await service(`select public.invoice_send_record($1, $2, $3, 'Rēķins', false, null, false, '550 mailbox unavailable')`, [bad, A.ownerId, ['nobody@zobi.lv']])
    const { rows: [j] } = await db.query<{ status: string; sent_at: string | null; send_error: string | null }>(`select status, sent_at, send_error from public.invoices where id = $1`, [bad])
    expect(j).toEqual({ status: 'mustand', sent_at: null, send_error: '550 mailbox unavailable' })

    const log = await rowsAs<{ invoice_id: string; recipients: string[]; ok: boolean; subject: string; sent_by: string }>(db, { id: A.ownerId },
      `select invoice_id, recipients, ok, subject, sent_by from public.invoice_send_log order by sent_at`)
    expect(log).toEqual([
      { invoice_id: ok, recipients: ['buh@zobi.lv', 'boss@zobi.lv'], ok: true, subject: 'Rēķins', sent_by: A.ownerId },
      { invoice_id: bad, recipients: ['nobody@zobi.lv'], ok: false, subject: 'Rēķins', sent_by: A.ownerId },
    ])
    // Another clinic sees none of it; nobody signed in records a send.
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.invoice_send_log`)).toEqual([])
    expect(await errorAs(db, { id: A.ownerId }, `select public.invoice_send_record($1, $2, $3, 'x', false, null, true, null)`, [ok, A.ownerId, ['a@b.lv']])).toMatch(/permission denied/)
  })
})
