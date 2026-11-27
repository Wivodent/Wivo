/**
 * sql/141: implants in an order from outside (Wivo order v2). The client marks
 * where the implants are and what sits on them; accepting the order makes a
 * job whose work item carries exactly these, as the new-job form writes them.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let session: string
const NET = 'aaaaaaaa-0000-4000-8000-000000000021'
let refs = 0

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
async function serviceError(sql: string, params: unknown[] = []): Promise<string | null> {
  try { await service(sql, params); return null } catch (e) { return (e as Error).message }
}
const v2 = (over: Record<string, unknown>) => JSON.stringify({
  format: 'wivo-order', version: 2, work_type: 'Implant crown', teeth: '', options: {}, shade: null, due: null,
  patient_ref: `CASE-${++refs}`, notes: null, implants: '', abutment: null, ...over,
})
const send = (payload: string) => service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, payload])
async function acceptAndItem(orderId: string): Promise<Record<string, unknown>> {
  const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [orderId])
  const { rows } = await db.query<{ item: Record<string, unknown> }>(`select work_items->0 as item from public.jobs where id = $1`, [job])
  return rows[0].item
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([
    { nimi: 'Implant crown', hex: '#000', hind: 300, katalog: 'crown-implant' },
    { nimi: 'Implant bridge', hex: '#000', hind: 900, liik: 'bridge', match: ['implantaadisild'] },
    { nimi: 'All-on-4', hex: '#000', hind: 2400, liik: 'arch' },
    { nimi: 'Zirconia crown', hex: '#000', hind: 120 },
  ])])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
  const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
    [NET, 'cccccccc-0000-4000-8000-000000000021', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV' })])
  await connect()
  const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])
  session = (await connect()).session!
}, 120_000)

describe('the catalogue tells the phone what the new-job form knows (sql/141)', () => {
  it('each type\'s own words, and that the clinic takes order version 2', async () => {
    const cat = await service<Record<string, unknown>[]>(`select public.client_catalog($1) as r`, [session])
    const byName = new Map(cat.map(c => [c.name as string, c]))
    expect(byName.get('Implant crown')).toMatchObject({ katalog: 'crown-implant', order_version: 2, teeth: 'tooth' })
    expect(byName.get('Implant bridge')).toMatchObject({ liik: 'bridge', match: ['implantaadisild'] })
    expect(byName.get('All-on-4')).toMatchObject({ liik: 'arch', teeth: 'arch' })
    expect(byName.get('Zirconia crown')).not.toHaveProperty('liik')
  })
})

describe('an order with implants becomes a job with implants', () => {
  it('All-on-4 with four implants: accepted, the job\'s work item has the four', async () => {
    const upper = '18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28'
    const id = await send(v2({ work_type: 'All-on-4', teeth: upper, implants: '15,12,22,25' }))
    const item = await acceptAndItem(id)
    expect(item).toMatchObject({ too: 'All-on-4', hambad: upper, implantaadid: '15,12,22,25' })
    expect(item).not.toHaveProperty('kruvi')
  })

  it('an implant crown, its tooth an implant, with a screw / abutment', async () => {
    const id = await send(v2({ teeth: '36', implants: '36', abutment: { all: 'MIS C1', teeth: {} } }))
    expect(await acceptAndItem(id)).toMatchObject({ too: 'Implant crown', hambad: '36', implantaadid: '36', kruvi: 'MIS C1' })
  })

  it('an implant bridge: implants on its ends, pontics between, one implant on another system', async () => {
    const id = await send(v2({ work_type: 'Implant bridge', teeth: '14,13,12', implants: '14,12', abutment: { all: 'MIS C1', teeth: { 12: 'Straumann BL' } } }))
    const item = await acceptAndItem(id)
    expect(item).toMatchObject({ hambad: '14,13,12', implantaadid: '14,12', kruvi: 'MIS C1', kruvid: { 12: 'Straumann BL' } })
  })

  it('a version 1 order works as before: no implants on the job', async () => {
    const id = await send(JSON.stringify({ format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {},
      shade: 'A2', due: null, patient_ref: `CASE-${++refs}`, notes: null }))
    const item = await acceptAndItem(id)
    expect(item).toMatchObject({ too: 'Zirconia crown', hambad: '11' })
    expect(item).not.toHaveProperty('implantaadid')
  })
})

describe('what is refused', () => {
  it('an implant that is not one of the teeth, a bad number, an abutment with no implant, v1 with v2 fields, an unknown version', async () => {
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v2({ teeth: '36', implants: '37' })])).toMatch(/not one of the teeth/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v2({ teeth: '36', implants: '36, 37' })])).toMatch(/FDI/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v2({ teeth: '36', abutment: { all: 'MIS', teeth: {} } })])).toMatch(/needs an implant/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v2({ teeth: '36', implants: '36', abutment: { all: 'MIS', teeth: { 35: 'X' } } })])).toMatch(/not right/)
    const v1WithImplants = JSON.stringify({ format: 'wivo-order', version: 1, work_type: 'Implant crown', teeth: '36', options: {}, shade: null,
      due: null, patient_ref: `CASE-${++refs}`, notes: null, implants: '36' })
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v1WithImplants])).toMatch(/Unknown field/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, v2({ version: 3, teeth: '36', implants: '36' })])).toMatch(/v1 or v2/)
  })
})
