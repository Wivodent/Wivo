/**
 * sql/152: where a client's invoice goes. Its billing e-mail, else its invoice
 * e-mail, else the confirmed Network account's address; confirming a Network
 * client fills an empty invoice e-mail; the client's own billing e-mail
 * (Network 004, in its token) reaches its record without overwriting one the
 * clinic typed; the automatic invoice (sql/151) counts all three.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
const NET_CLINIC = 'aaaaaaaa-0000-4000-8000-000000000152'
let n = 0

async function service<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try { return (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

/** A Network client that asked to connect, with the address its token carried. */
async function networkClient(email: string | null): Promise<{ id: string; account: string }> {
  n++
  const account = `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`
  const { rows } = await db.query<{ id: string }>(
    `insert into public.network_client (org_id, account_id, kind, role, display_name, company_name, email)
     values ($1, $2, 'company', 'clinic', 'Anna Zariņa', $3, $4) returning id`, [A.clinicId, account, `SIA Zobi ${n}`, email])
  return { id: rows[0].id, account }
}
const confirm = async (id: string) => (await rowsAs<{ c: string }>(db, { id: A.ownerId },
  `select public.network_confirm_client($1, 'clinics', '{}'::jsonb) as c`, [id]))[0].c
const customer = async (id: string) => (await db.query<{ email: string | null; billing_email: string | null }>(
  `select email, billing_email from public.customers where id = $1`, [id])).rows[0]
const recipient = async (id: string, actor = A.ownerId) =>
  (await rowsAs<{ r: string | null }>(db, { id: actor }, `select public.invoice_recipient_email($1) as r`, [id]))[0].r
const setBilling = (account: string, billing: string | null) =>
  service(`select public.client_set_billing($1, $2, $3)`, [NET_CLINIC, account, billing])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
  await db.query(`insert into public.network_settings (org_id, network_clinic_id) values ($1, $2)`, [A.clinicId, NET_CLINIC])
}, 120_000)

describe('confirming a Network client', () => {
  it('its record’s invoice e-mail is the Network account’s address, when the record has none', async () => {
    const c = await networkClient('anna@zobi.lv')
    const cust = await confirm(c.id)
    expect(await customer(cust)).toEqual({ email: 'anna@zobi.lv', billing_email: null })
  })

  it('an invoice e-mail the clinic typed stays; the address arriving later fills only an empty one', async () => {
    const c = await networkClient(null)
    const cust = await confirm(c.id)
    expect((await customer(cust)).email).toBeNull()
    await service(`select public.client_set_contact($1, $2, 'late@zobi.lv', true)`, [NET_CLINIC, c.account])
    expect((await customer(cust)).email).toBe('late@zobi.lv')
    await rowsAs(db, { id: A.ownerId }, `update public.customers set email = 'office@zobi.lv' where id = $1`, [cust])
    await service(`select public.client_set_contact($1, $2, 'other@zobi.lv', true)`, [NET_CLINIC, c.account])
    expect((await customer(cust)).email).toBe('office@zobi.lv')
  })
})

describe('the client’s own billing e-mail, from its Network profile', () => {
  it('reaches its record; a change follows; one the clinic typed is never overwritten', async () => {
    const c = await networkClient('anna@zobi.lv')
    const cust = await confirm(c.id)
    await setBilling(c.account, 'invoices@zobi.lv')
    expect((await customer(cust)).billing_email).toBe('invoices@zobi.lv')
    await setBilling(c.account, 'buh@zobi.lv')
    expect((await customer(cust)).billing_email).toBe('buh@zobi.lv')
    // The client removes it: gone from the record too (it was theirs).
    await setBilling(c.account, null)
    expect((await customer(cust)).billing_email).toBeNull()
    // The clinic types its own; the client's next one does not replace it.
    await rowsAs(db, { id: A.ownerId }, `update public.customers set billing_email = 'clinic-typed@zobi.lv' where id = $1`, [cust])
    await setBilling(c.account, 'mine@zobi.lv')
    expect((await customer(cust)).billing_email).toBe('clinic-typed@zobi.lv')
  })

  it('given before the clinic confirmed: on the record from the confirmation', async () => {
    const c = await networkClient('anna@zobi.lv')
    await setBilling(c.account, 'early@zobi.lv')
    const cust = await confirm(c.id)
    expect((await customer(cust)).billing_email).toBe('early@zobi.lv')
  })

  it('not an address: stored as none; only the service role (network-client) may set it', async () => {
    const c = await networkClient('anna@zobi.lv')
    await setBilling(c.account, 'not an address')
    expect((await db.query<{ b: string | null }>(`select billing_email as b from public.network_client where id = $1`, [c.id])).rows[0].b).toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_set_billing($1, $2, 'x@y.lv')`, [NET_CLINIC, c.account])).toMatch(/permission denied/)
  })
})

describe('where an invoice goes', () => {
  it('the billing e-mail, else the invoice e-mail, else the Network account’s', async () => {
    const c = await networkClient('orderer@zobi.lv')
    const cust = await confirm(c.id)
    await rowsAs(db, { id: A.ownerId }, `update public.customers set email = null, billing_email = null where id = $1`, [cust])
    expect(await recipient(cust)).toBe('orderer@zobi.lv')
    await rowsAs(db, { id: A.ownerId }, `update public.customers set email = 'office@zobi.lv' where id = $1`, [cust])
    expect(await recipient(cust)).toBe('office@zobi.lv')
    await rowsAs(db, { id: A.ownerId }, `update public.customers set billing_email = 'buh@zobi.lv' where id = $1`, [cust])
    expect(await recipient(cust)).toBe('buh@zobi.lv')
  })

  it('a client of the person’s own clinic only, for whoever may see its record', async () => {
    const c = await networkClient('orderer@zobi.lv')
    const cust = await confirm(c.id)
    expect(await errorAs(db, { id: B.ownerId }, `select public.invoice_recipient_email($1)`, [cust])).toMatch(/Not allowed/)
    expect(await errorAs(db, { id: A.workerId }, `select public.invoice_recipient_email($1)`, [cust])).toMatch(/Not allowed/)
    await grant(db, A, A.workerId, ['payments.read'])
    expect(await recipient(cust, A.workerId)).toBe('orderer@zobi.lv')
  })

  it('the automatic invoice sends to the Network account’s address when the record has no e-mail', async () => {
    await db.query(`update public.clinics set country = 'LV' where id = $1`, [A.clinicId])
    await db.query(`insert into public.clinic_settings (clinic_id, pricing, email) values ($1, $2::jsonb, $3::jsonb)
                    on conflict (clinic_id) do update set pricing = excluded.pricing, email = excluded.email`,
      [A.clinicId, JSON.stringify({ kmMaar: 21, autoArve: { on: true, trigger: 'received', mode: 'per_job', send: 'auto' } }),
       JSON.stringify({ saatmineLubatud: true, lubaArved: true, saatjaAadress: 'arved@dentiks.lv' })])
    const c = await networkClient('orderer@zobi.lv')
    const cust = await confirm(c.id)
    await rowsAs(db, { id: A.ownerId }, `update public.customers set email = null, reg_code = '40003', address = 'Rīga' where id = $1`, [cust])
    const [{ last }] = (await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])).rows
    const { rows: [{ id: job }] } = await db.query<{ id: string }>(
      `insert into public.jobs (clinic_id, patsient, status, customer_id, hind, too) values ($1, 'X', $2, $3, 100, 'Crown') returning id`, [A.clinicId, last, cust])
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [job])
    await rowsAs(db, { id: A.ownerId }, `select public.job_mark_received($1, false, null)`, [job])
    const [inv] = (await db.query<{ status: string; auto_reasons: string[] }>(
      `select i.status, i.auto_reasons from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where l.job_id = $1`, [job])).rows
    expect(inv).toEqual({ status: 'saadetud', auto_reasons: [] })
  })
})

describe('existing Network clients (the migration)', () => {
  it('an empty invoice e-mail gets the confirmed account’s address; a filled one stays', async () => {
    const sql = readFileSync(join(__dirname, '..', '152_client_invoice_email.sql'), 'utf8')
    const backfill = sql.slice(sql.indexOf('update public.customers k'), sql.indexOf(';', sql.indexOf('update public.customers k')) + 1)
    const empty = await networkClient('one@zobi.lv')
    const filled = await networkClient('two@zobi.lv')
    const a = await confirm(empty.id)
    const b = await confirm(filled.id)
    // As before 152: confirmed, the records without the address (or with the clinic's own).
    await db.query(`update public.customers set email = null where id = $1`, [a])
    await db.query(`update public.customers set email = 'clinic@zobi.lv' where id = $1`, [b])
    await db.exec(backfill)
    expect((await customer(a)).email).toBe('one@zobi.lv')
    expect((await customer(b)).email).toBe('clinic@zobi.lv')
  })
})
