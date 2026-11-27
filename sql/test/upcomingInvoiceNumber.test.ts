/**
 * sql/150: the number a draft will get, read without taking it, so the
 * "Send by e-mail" letter can say it. It is the number issuing gives, and
 * reading it leaves no gap.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
const year = new Date().getFullYear()

async function draft(): Promise<string> {
  const [{ id }] = await rowsAs<{ id: string }>(db, { id: A.ownerId },
    `insert into public.invoices (clinic_id, patsient, vat_rate, status) values ($1, 'SIA Zobi', 21, 'mustand') returning id`, [A.clinicId])
  return id
}
const upcoming = async (): Promise<string> =>
  (await rowsAs<{ n: string }>(db, { id: A.ownerId }, `select public.upcoming_invoice_number($1) as n`, [A.clinicId]))[0].n

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  B = await createTenant(db, 'Elsewhere')
}, 120_000)

describe('the number a draft will get', () => {
  it('is the number issuing then gives, and reading it takes nothing', async () => {
    const first = await upcoming()
    expect(first).toBe(`${year}-0001`)
    expect(await upcoming()).toBe(first)
    const id = await draft()
    await rowsAs(db, { id: A.ownerId }, `select public.invoice_issue($1)`, [id])
    const [{ number }] = (await db.query<{ number: string }>(`select number from public.invoices where id = $1`, [id])).rows
    expect(number).toBe(first)
    expect(await upcoming()).toBe(`${year}-0002`)
  })

  it('only for someone who may write invoices, in their own clinic', async () => {
    expect(await errorAs(db, { id: A.workerId }, `select public.upcoming_invoice_number($1)`, [A.clinicId])).toMatch(/not allowed/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.upcoming_invoice_number($1)`, [B.clinicId])).toMatch(/not allowed/)
  })

  it('only reads (stable), so builds below the minimum version may still call it', async () => {
    const [{ v }] = (await db.query<{ v: string }>(`select provolatile as v from pg_proc where proname = 'upcoming_invoice_number'`)).rows
    expect(v).toBe('s')
  })
})
