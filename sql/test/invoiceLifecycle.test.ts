/**
 * sql/149: a draft has no number until it is issued (no holes when drafts are
 * deleted); only a draft without money on it is deleted; an issued invoice is
 * cancelled with a reason or credited by a credit note of its own number;
 * all of it in the audit log; a client's invoice language and country.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
const year = new Date().getFullYear()

/** A draft as the app now makes it: no number. */
async function draft(extra: Record<string, unknown> = {}): Promise<string> {
  const cols = { clinic_id: A.clinicId, patsient: 'SIA Zobi', vat_rate: 21, status: 'mustand', ...extra }
  const keys = Object.keys(cols)
  const [{ id }] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
    `insert into public.invoices (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(cols))
  await rowsAs(db, { id: A.ownerId }, `insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Kronis', 2, 100)`, [id])
  return id
}
const inv = async (id: string) => (await db.query<{ number: string | null; status: string; gross_total: string; cancel_reason: string | null }>(
  `select number, status, gross_total, cancel_reason from public.invoices where id = $1`, [id])).rows[0]

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
}, 120_000)

describe('a draft has no number until it is issued', () => {
  it('no number as a draft (its placeholder); the next one when marked Sent; a deleted draft leaves no hole', async () => {
    const a = await draft()
    const gone = await draft()
    const b = await draft()
    expect((await inv(a)).number).toBe(`draft:${a}`)
    await rowsAs(db, { id: A.ownerId }, `select public.delete_invoice($1)`, [gone])
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'saadetud' where id = $1`, [a])
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'saadetud' where id = $1`, [b])
    expect((await inv(a)).number).toBe(`${year}-0001`)
    expect((await inv(b)).number).toBe(`${year}-0002`)
  })

  it('issued before it is e-mailed (the e-mail carries the number); once only', async () => {
    const d = await draft()
    const [{ n }] = await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.invoice_issue($1) as n`, [d])
    expect(n).toBe(`${year}-0003`)
    const [{ n: again }] = await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.invoice_issue($1) as n`, [d])
    expect(again).toBe(n)
    expect((await inv(d)).status).toBe('mustand')
  })

  it('only a draft may hold a placeholder; an issued one gets its number however it is made', async () => {
    await expect(db.query(`insert into public.invoices (clinic_id, patsient, status) values ($1, 'x', 'saadetud') returning number`, [A.clinicId]))
      .resolves.toMatchObject({ rows: [{ number: `${year}-0004` }] })
    await expect(db.query(`insert into public.invoices (clinic_id, patsient, status, number) values ($1, 'x', 'mustand', 'draft:x')`, [A.clinicId])).resolves.toBeTruthy()
    // An issued invoice never keeps a placeholder: it is given the next number instead.
    await db.query(`update public.invoices set number = 'draft:y' where number = $1`, [`${year}-0004`])
    expect((await db.query(`select 1 from public.invoices where number like 'draft:%' and status <> 'mustand'`)).rows).toHaveLength(0)
  })
})

describe('deleting', () => {
  it('a draft: yes, recorded; an issued one: no, even by a plain DELETE from an older build', async () => {
    const d = await draft()
    await rowsAs(db, { id: A.ownerId }, `select public.delete_invoice($1)`, [d])
    expect((await db.query(`select 1 from public.invoices where id = $1`, [d])).rows).toHaveLength(0)
    expect((await db.query<{ action: string }>(`select action from public.audit_log where object = $1`, [`invoice:${d}`])).rows.map(r => r.action)).toEqual(['delete'])
    const sent = await draft()
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'saadetud' where id = $1`, [sent])
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_invoice($1)`, [sent])).toMatch(/Only a draft/)
    expect(await errorAs(db, { id: A.ownerId }, `delete from public.invoices where id = $1`, [sent])).toMatch(/Only a draft/)
  })

  it('not a draft with money on it (its payments used to go with it)', async () => {
    const d = await draft()
    await db.query(`insert into public.payments (clinic_id, invoice_id, amount, method, paid_at) values ($1, $2, 50, 'ulekanne', current_date)`, [A.clinicId, d])
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_invoice($1)`, [d])).toMatch(/has payments/)
  })

  it('only with Edit payments, only the own clinic’s', async () => {
    const d = await draft()
    expect(await errorAs(db, { id: A.workerId }, `select public.delete_invoice($1)`, [d])).toMatch(/Edit payments/)
    await grant(db, A, A.workerId, ['payments.write'])
    expect(await errorAs(db, { id: B.ownerId }, `select public.delete_invoice($1)`, [d])).toMatch(/Edit payments|not found/)
    expect(await errorAs(db, 'anon', `select public.delete_invoice($1)`, [d])).toMatch(/permission denied/)
  })
})

describe('cancelling and crediting an issued invoice', () => {
  it('cancel: a reason is required; the number stays; it stays cancelled; recorded', async () => {
    const d = await draft()
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'saadetud' where id = $1`, [d])
    const number = (await inv(d)).number
    expect(await errorAs(db, { id: A.ownerId }, `select public.cancel_invoice($1, '  ')`, [d])).toMatch(/reason is needed/)
    // The old way (the status buttons) without a reason: refused too.
    expect(await errorAs(db, { id: A.ownerId }, `update public.invoices set status = 'tuhistatud' where id = $1`, [d])).toMatch(/reason is needed/)
    await rowsAs(db, { id: A.ownerId }, `select public.cancel_invoice($1, 'Wrong client')`, [d])
    expect(await inv(d)).toMatchObject({ number, status: 'tuhistatud', cancel_reason: 'Wrong client' })
    expect(await errorAs(db, { id: A.ownerId }, `update public.invoices set status = 'saadetud' where id = $1`, [d])).toMatch(/stays cancelled/)
    expect((await db.query<{ action: string }>(`select action from public.audit_log where object = $1`, [`invoice:${d}`])).rows.map(r => r.action)).toContain('cancel')
  })

  it('a draft is deleted, not cancelled', async () => {
    const d = await draft()
    expect(await errorAs(db, { id: A.ownerId }, `update public.invoices set status = 'tuhistatud', cancel_reason = 'x' where id = $1`, [d])).toMatch(/draft is deleted/)
  })

  it('credit note: its own number, the lines with the opposite sign, pointing at the original; once', async () => {
    const d = await draft()
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'makstud' where id = $1`, [d])
    const [{ c }] = await rowsAs<{ c: string }>(db, { id: A.ownerId }, `select public.create_credit_note($1, 'Returned') as c`, [d])
    const credit = (await db.query<{ number: string; status: string; credit_of: string; gross_total: string; note: string }>(
      `select number, status, credit_of, gross_total, note from public.invoices where id = $1`, [c])).rows[0]
    expect(credit.number).toMatch(new RegExp(`^${year}-\\d{4}$`))
    expect(credit.number).not.toBe((await inv(d)).number)
    expect(credit).toMatchObject({ status: 'saadetud', credit_of: d, note: 'Returned' })
    expect(Number(credit.gross_total)).toBe(-Number((await inv(d)).gross_total))
    expect(await errorAs(db, { id: A.ownerId }, `select public.create_credit_note($1, 'Again')`, [d])).toMatch(/already has a credit note/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.create_credit_note($1, 'x')`, [await draft()])).toMatch(/Only an issued invoice/)
  })

  it('a payment plan’s instalments are cancelled with the plan as before, the reason filled in', async () => {
    const { rows: [plan] } = await db.query<{ id: string }>(
      `insert into public.payment_plans (clinic_id, patsient, kogusumma, osamakseid, esimene_arve, arve_paev, maksetahtaeg_paevi, staatus)
       values ($1, 'X', 200, 2, current_date, 2, 14, 'aktiivne') returning id`, [A.clinicId])
    const d = await draft({ payment_plan_id: plan.id, number: 'PLAN-1' })
    await rowsAs(db, { id: A.ownerId }, `update public.invoices set status = 'tuhistatud' where id = $1`, [d])
    expect(await inv(d)).toMatchObject({ status: 'tuhistatud', cancel_reason: 'Payment plan cancelled' })
  })
})

describe('a client’s invoice language and country', () => {
  it('a Network client confirmed gets its country on its record', async () => {
    const NET = 'aaaaaaaa-0000-4000-8000-000000000055'
    await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
    await db.exec('set role service_role')
    try {
      await db.query(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb)`,
        [NET, 'cccccccc-0000-4000-8000-000000000055', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV' })])
    } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claims', '', false)`) }
    const [{ id }] = (await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])).rows
    await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])
    const { rows: [k] } = await db.query<{ country: string }>(`select k.country from public.customers k join public.network_client c on c.customer_id = k.id where c.id = $1`, [id])
    expect(k.country).toBe('LV')
  })

  it('one of et, lv, en, or none; a two-letter country', async () => {
    const ok = await db.query(`insert into public.customers (clinic_id, name, invoice_language, country) values ($1, 'SIA Zobi', 'lv', 'LV') returning id`, [A.clinicId])
    expect(ok.rows).toHaveLength(1)
    await expect(db.query(`insert into public.customers (clinic_id, name, invoice_language) values ($1, 'X', 'fi')`, [A.clinicId])).rejects.toThrow(/customers_invoice_language_valid/)
    await expect(db.query(`insert into public.customers (clinic_id, name, country) values ($1, 'X', 'Latvia')`, [A.clinicId])).rejects.toThrow(/customers_country_valid/)
  })
})
