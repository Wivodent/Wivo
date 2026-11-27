/**
 * sql/147: a Network order's job carries its client's record in Clients, so
 * "Bill to: Client" finds it under Unbilled work; a broken link is repaired,
 * and a client confirmed again with a new record takes its jobs along.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let session: string
let clientId: string
const NET = 'aaaaaaaa-0000-4000-8000-000000000054'

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
const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
  [NET, 'cccccccc-0000-4000-8000-000000000054', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: 'Fake Lab', country: 'LV' })])
async function orderJob(ref: string): Promise<string> {
  const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
    format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: ref, notes: null })])
  const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
  return job
}
const customerOf = async (job: string) => (await db.query<{ customer_id: string | null; customer_ref: string | null }>(
  `select customer_id, customer_ref from public.jobs where id = $1`, [job])).rows[0]
const clientRecord = async () => (await db.query<{ customer_id: string }>(`select customer_id from public.network_client where id = $1`, [clientId])).rows[0].customer_id

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
  await connect()
  ;[{ id: clientId }] = (await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])).rows
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [clientId])
  session = (await connect()).session!
}, 120_000)

describe('a Network order’s job and its client’s record', () => {
  it('accepted: the job carries the client’s record and the order’s reference', async () => {
    const job = await orderJob('TF-FO-261127-001')
    const rec = await clientRecord()
    expect(await customerOf(job)).toEqual({ customer_id: rec, customer_ref: 'TF-FO-261127-001' })
    const { rows: [k] } = await db.query<{ name: string }>(`select name from public.customers where id = $1`, [rec])
    expect(k.name).toBe('Fake Lab')
  })

  it('a job that lost its record gets it back; one moved to another live client is left alone', async () => {
    const lost = await orderJob('TF-FO-261127-002')
    const moved = await orderJob('TF-FO-261127-003')
    const { rows: [other] } = await db.query<{ id: string }>(`insert into public.customers (clinic_id, name) values ($1, 'Someone else') returning id`, [A.clinicId])
    await db.query(`update public.jobs set customer_id = null where id = $1`, [lost])
    await db.query(`update public.jobs set customer_id = $2 where id = $1`, [moved, other.id])
    await db.query(`select public.relink_order_jobs()`)
    expect((await customerOf(lost)).customer_id).toBe(await clientRecord())
    expect((await customerOf(moved)).customer_id).toBe(other.id)
  })

  it('the record archived and the client confirmed again: a new record, and its jobs follow', async () => {
    const job = await orderJob('TF-FO-261127-004')
    const old = await clientRecord()
    await db.query(`update public.customers set archived_at = now() where id = $1`, [old])
    await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [clientId])
    const now = await clientRecord()
    expect(now).not.toBe(old)
    expect((await customerOf(job)).customer_id).toBe(now)
  })

  it('nobody signed in runs the repair', async () => {
    await db.exec(`set role authenticated`)
    try {
      await expect(db.query(`select public.relink_order_jobs()`)).rejects.toThrow(/permission denied/)
    } finally { await db.exec('reset role') }
  })
})
