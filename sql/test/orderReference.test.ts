/**
 * sql/140: the order reference the clinic makes, e.g. TF-FL-261127-001.
 *
 * Letters (and Latin for marked and Cyrillic names), the same letters for two
 * orderers (TF, TF2, kept), the day's counter, two claims of the same number
 * (the later one gets the next), a reference typed by hand (kept, or refused
 * as already used), the same reference on a job made in Wivo, and who may
 * see or run what.
 *
 * PGlite has one connection, so two orders "at once" are two claims of the
 * same shown number one after the other: what the counter's row lock turns a
 * real race into.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let today: string
const NET_A = 'aaaaaaaa-0000-4000-8000-000000000011'
const NET_B = 'bbbbbbbb-0000-4000-8000-000000000012'
const KEY = 'A'.repeat(43)
const acct = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
const profile = (name: string) => JSON.stringify({ name, kind: 'person', role: 'technician', company: null, country: 'LV' })

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
const order = (ref: string) => JSON.stringify({
  format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: ref, notes: null,
})

/** A confirmed Network client of clinic A, its session and the customer it became. */
async function client(n: number, name: string, tenant = A, net = NET_A): Promise<{ session: string; customer: string }> {
  const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`, [net, acct(n), profile(name)])
  await connect()
  const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1 and account_id = $2`, [tenant.clinicId, acct(n)])
  const [{ customer }] = await rowsAs<{ customer: string }>(db, { id: tenant.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb) as customer`, [id])
  const s = await connect()
  return { session: s.session!, customer }
}
const preview = (session: string) => service<string>(`select public.client_reference_preview($1) as r`, [session])
async function send(session: string, ref: string): Promise<string> {
  const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, order(ref)])
  const { rows: [o] } = await db.query<{ patient_ref: string; payload_ref: string }>(
    `select patient_ref, payload->>'patient_ref' as payload_ref from public.client_order where id = $1`, [id])
  expect(o.payload_ref).toBe(o.patient_ref)
  return o.patient_ref
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Fakeville Lab')
  B = await createTenant(db, 'Dentiks')
  for (const [t, net] of [[A, NET_A], [B, NET_B]] as const) {
    await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                    on conflict (clinic_id) do update set work_types = excluded.work_types`,
      [t.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
    await rowsAs(db, { id: t.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, [KEY, net])
  }
  const { rows } = await db.query<{ d: string }>(`select to_char(public.ref_day(), 'YYMMDD') as d`)
  today = rows[0].d
}, 120_000)

describe('the letters (sql/140)', () => {
  const letters = async (name: string, clinic = false) =>
    (await db.query<{ l: string }>(`select public.ref_letters($1, $2) as l`, [name, clinic])).rows[0].l
  it('a person: first and last name; one name: its first two letters', async () => {
    expect(await letters('Tess Fake')).toBe('TF')
    expect(await letters('Mart Kask Junior')).toBe('MJ')
    expect(await letters('Cher')).toBe('CH')
    expect(await letters('  tess   fake ')).toBe('TF')
    expect(await letters('A')).toBe('AX')
    expect(await letters('')).toBe('XX')
  })
  it('a clinic: its first two words; one word: its first two letters', async () => {
    expect(await letters('Dentiks', true)).toBe('DE')
    expect(await letters('Smile Lab Tallinn', true)).toBe('SL')
    expect(await letters('Fakeville Lab', true)).toBe('FL')
  })
  it('only A–Z: marks dropped, Cyrillic written in Latin', async () => {
    expect(await letters('Šarlote Õunapuu')).toBe('SO')
    expect(await letters('Ēriks Ķēniņš')).toBe('EK')
    expect(await letters('Жанна Іванова')).toBe('ZI')
    expect(await letters('Жанна')).toBe('ZH')
    expect(await letters('Юлия Щукина')).toBe('YS')
    expect(await letters('Ølstykke Tandlæge', true)).toBe('OT')
    expect(await letters('Dr. Äädik-Öö')).toBe('DO')
  })
})

describe('a Network order\'s reference', () => {
  let tess: { session: string; customer: string }

  it('is shown filled in, and given out as shown', async () => {
    tess = await client(1, 'Tess Fake')
    const shown = await preview(tess.session)
    expect(shown).toBe(`TF-FL-${today}-001`)
    expect(await send(tess.session, shown)).toBe(shown)
    expect(await preview(tess.session)).toBe(`TF-FL-${today}-002`)
  })

  it('two orders with the same shown number: the later one gets the next', async () => {
    const shown = await preview(tess.session)
    expect(await send(tess.session, shown)).toBe(`TF-FL-${today}-002`)
    expect(await send(tess.session, shown)).toBe(`TF-FL-${today}-003`)
    const { rows } = await db.query<{ n: number }>(`select n from public.reference_counter where org_id = $1 and code = 'TF'`, [A.clinicId])
    expect(rows).toEqual([{ n: 3 }])
  })

  it('another orderer with the same letters gets TF2, the next TF3, and they keep them', async () => {
    const tom = await client(2, 'Tom Fox')
    expect(await preview(tom.session)).toBe(`TF2-FL-${today}-001`)
    expect(await send(tom.session, await preview(tom.session))).toBe(`TF2-FL-${today}-001`)
    const tina = await client(3, 'Tina Ford')
    expect(await send(tina.session, await preview(tina.session))).toBe(`TF3-FL-${today}-001`)
    // Kept: Tom is still TF2, and Tess still TF.
    expect(await preview(tom.session)).toBe(`TF2-FL-${today}-002`)
    expect(await preview(tess.session)).toBe(`TF-FL-${today}-004`)
    const { rows } = await db.query<{ code: string }>(`select code from public.reference_party where org_id = $1 order by code`, [A.clinicId])
    expect(rows.map(r => r.code)).toEqual(['TF', 'TF2', 'TF3'])
  })

  it('counts per day: another day\'s count does not move today\'s', async () => {
    await db.query(`insert into public.reference_counter (org_id, code, day, n) values ($1, 'TF', public.ref_day() - 1, 40)`, [A.clinicId])
    expect(await preview(tess.session)).toBe(`TF-FL-${today}-004`)
  })

  it('a reference in the automatic form of yesterday, or someone else\'s letters, is renumbered as today\'s own', async () => {
    const stale = `TF-FL-${String(Number(today) - 1).padStart(6, '0')}-001`
    expect(await send(tess.session, stale)).toBe(`TF-FL-${today}-004`)
    expect(await send(tess.session, `TF3-FL-${today}-009`)).toBe(`TF-FL-${today}-005`)
  })

  it('a reference typed by hand is kept; the same one again is refused, said as already used', async () => {
    expect(await send(tess.session, 'CASE-118')).toBe('CASE-118')
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [tess.session, order('case-118')])).toMatch(/already used in this clinic/)
    // The clinic's other references count too: one given out automatically.
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [tess.session, order(`TF2-FL-${today}-001x`)])).toBeNull()
    // Another clinic may have the same one.
    const other = await client(4, 'Tess Fake', B, NET_B)
    expect(await send(other.session, 'CASE-118')).toBe('CASE-118')
    expect(await preview(other.session)).toBe(`TF-DE-${today}-001`)
  })

  it('the job an accepted order becomes keeps the order\'s reference', async () => {
    const ref = await send(tess.session, await preview(tess.session))
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.client_order where org_id = $1 and patient_ref = $2`, [A.clinicId, ref])
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    const { rows: [j] } = await db.query<{ customer_ref: string }>(`select customer_ref from public.jobs where id = $1`, [job])
    expect(j.customer_ref).toBe(ref)
  })
})

describe('a job made in Wivo for a client', () => {
  let customer: string

  beforeAll(async () => {
    const { rows } = await db.query<{ id: string }>(`insert into public.customers (clinic_id, name) values ($1, 'Mart Kask') returning id`, [A.clinicId])
    customer = rows[0].id
  })
  const newJob = async (ref: string | null, cust: string | null = customer) => {
    const { rows } = await db.query<{ customer_ref: string | null }>(
      `insert into public.jobs (clinic_id, patsient, customer_id, customer_ref) values ($1, 'X', $2, $3) returning customer_ref`, [A.clinicId, cust, ref])
    return rows[0].customer_ref
  }

  it('the form is given the next reference; saving gives it out; the same shown number twice is renumbered', async () => {
    const [{ r: shown }] = await rowsAs<{ r: string }>(db, { id: A.ownerId }, `select public.preview_order_reference($1) as r`, [customer])
    expect(shown).toBe(`MK-FL-${today}-001`)
    expect(await newJob(shown)).toBe(shown)
    expect(await newJob(shown)).toBe(`MK-FL-${today}-002`)
  })

  it('a reference typed by hand is left as it is, even an old duplicate', async () => {
    expect(await newJob('2024-118')).toBe('2024-118')
    expect(await newJob('2024-118')).toBe('2024-118')
    expect(await newJob(null)).toBeNull()
  })

  it('a hand reference a job already has is refused for a Network order', async () => {
    const s = await client(5, 'Liis Lepp')
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s.session, order('2024-118')])).toMatch(/already used/)
  })

  it('only someone who edits jobs in this clinic gets a preview', async () => {
    const [{ r: worker }] = await rowsAs<{ r: string | null }>(db, { id: A.workerId }, `select public.preview_order_reference($1) as r`, [customer])
    expect(worker).toBeNull()
    const [{ r: other }] = await rowsAs<{ r: string | null }>(db, { id: B.ownerId }, `select public.preview_order_reference($1) as r`, [customer])
    expect(other).toBeNull()
  })
})

describe('who may see and run what', () => {
  it('the tables: the clinic\'s own people read their own; nobody writes', async () => {
    const mine = await rowsAs(db, { id: A.ownerId }, `select 1 from public.order_reference`)
    expect(mine.length).toBeGreaterThan(0)
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.order_reference where org_id = $1`, [A.clinicId])).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.reference_party where org_id = $1`, [A.clinicId])).toEqual([])
    expect(await errorAs(db, { id: A.ownerId }, `insert into public.order_reference (org_id, ref) values ($1, 'x')`, [A.clinicId])).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.ownerId }, `update public.reference_counter set n = 0`)).toMatch(/permission denied/)
  })

  it('the helpers run for nobody; the client\'s preview for the service role only', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.ref_claim($1, 'x', 'Tess Fake', null, 'job')`, [A.clinicId])).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_reference_preview('x')`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select public.preview_order_reference(gen_random_uuid())`)).toMatch(/permission denied/)
  })
})
