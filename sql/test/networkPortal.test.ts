/**
 * sql/138: orders from outside through the Wivo Network (docs/PLAN-NETWORK-1.md).
 *
 * The client's boundary: a session belongs to one client of one clinic; it
 * sees only that client's orders, files and messages; it dies when the
 * connection ends, when the portal is turned off and when it expires (and
 * until then it works with no Network at all). The client_* functions run
 * for the service role only; the clinic's people see orders by their rights.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
const NET_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const NET_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const KEY = 'A'.repeat(43)
const acct = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
const profile = (name: string, role = 'technician', kind = 'person') => JSON.stringify({ name, kind, role, company: kind === 'company' ? `${name} Ltd` : null, country: 'LV' })

/** As the network-client Edge Function: the service role. */
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
const connect = (net: string, account: string, p = profile('Tess Fake')) =>
  service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`, [net, account, p])
const order = (over: Record<string, unknown> = {}) => JSON.stringify({
  format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11,21', options: {},
  shade: 'A2', due: null, patient_ref: 'REF-1', notes: 'Please check the margin', ...over,
})

async function clientId(org: string, account: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1 and account_id = $2`, [org, account])
  return rows[0].id
}
async function confirmedSession(account: string, name: string, canSee = '{}'): Promise<string> {
  await connect(NET_A, account, profile(name))
  const id = await clientId(A.clinicId, account)
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', $2::jsonb)`, [id, canSee])
  const again = await connect(NET_A, account, profile(name))
  expect(again.state).toBe('confirmed')
  return again.session!
}

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Fakeville Lab')
  B = await createTenant(db, 'Other Lab')
  for (const [t, net] of [[A, NET_A], [B, NET_B]] as const) {
    await db.query(`insert into public.clinic_settings (clinic_id, work_types, pricing) values ($1, $2::jsonb, $3::jsonb)
                    on conflict (clinic_id) do update set work_types = excluded.work_types, pricing = excluded.pricing`, [
      t.clinicId,
      JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120, hinnaTyyp: 'hammas' },
                      { nimi: 'All-on-4', hex: '#000', hind: 2400, liik: 'arch',
                        valikuGrupid: [{ key: 'framework', nimi: 'Framework', mitu: false, valikud: ['metal-bar'] }] }]),
      JSON.stringify({ tooValikud: [{ id: 'metal-bar', nimi: 'Metal bar' }] }),
    ])
    await rowsAs(db, { id: t.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, [KEY, net])
  }
}, 120_000)

describe('connecting (sql/138)', () => {
  it('a new account is a request; the owner hears of it; nothing opens until confirmed', async () => {
    const r = await connect(NET_A, acct(1), profile('Tess Fake'))
    expect(r).toEqual({ state: 'requested' })
    const { rows } = await db.query(`select 1 from public.notification where org_id = $1 and kind = 'client_request'`, [A.clinicId])
    expect(rows.length).toBeGreaterThan(0)
    expect((await connect(NET_A, acct(1))).state).toBe('requested')
  })

  it('confirmed: a customer under Clients (person) or Clinics (clinic), and a session', async () => {
    await connect(NET_A, acct(2), profile('Clinic Mock', 'clinic', 'company'))
    const id = await clientId(A.clinicId, acct(2))
    const [{ customer }] = await rowsAs<{ customer: string }>(db, { id: A.ownerId },
      `select public.network_confirm_client($1, 'clinics', '{}'::jsonb) as customer`, [id])
    const { rows: [c] } = await db.query<{ kind: string; name: string }>(`select kind, name from public.customers where id = $1`, [customer])
    expect(c).toEqual({ kind: 'clinic', name: 'Clinic Mock Ltd' })
    const s = await connect(NET_A, acct(2), profile('Clinic Mock', 'clinic', 'company'))
    expect(s.state).toBe('confirmed')
    expect(s.session).toMatch(/^[0-9a-f]{64}$/)
    // Only its hash is kept.
    const { rows: hashes } = await db.query(`select 1 from public.network_client_session where token_hash = $1`, [s.session])
    expect(hashes).toHaveLength(0)
  })

  it('only the owner confirms; a worker cannot', async () => {
    await connect(NET_A, acct(3), profile('Worker Try'))
    const id = await clientId(A.clinicId, acct(3))
    expect(await errorAs(db, { id: A.workerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])).toMatch(/Only the owner/)
    expect(await errorAs(db, { id: B.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])).toMatch(/Only the owner|Not found/)
  })

  it('a Network id that is not this clinic\'s, or a portal turned off, opens nothing', async () => {
    expect(await serviceError(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb)`,
      ['dddddddd-0000-4000-8000-000000000009', acct(4), profile('Nobody')])).toMatch(/does not take orders/)
    // A's client is not B's: the same account asking B is a new request there, nothing of A's.
    const s = await confirmedSession(acct(5), 'Two Clinics')
    expect((await connect(NET_B, acct(5), profile('Two Clinics'))).state).toBe('requested')
    const orders = await service<unknown[]>(`select public.client_orders($1) as r`, [s])
    expect(orders).toEqual([])
  })
})

describe('the client sees only its own', () => {
  it('account A does not see account B\'s orders, files or messages', async () => {
    const sa = await confirmedSession(acct(10), 'Alice Fake')
    const sb = await confirmedSession(acct(11), 'Bob Mock')
    const orderA = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [sa, order({ patient_ref: 'A-1' })])
    await service(`select public.client_new_order($1, $2::jsonb) as r`, [sb, order({ patient_ref: 'B-1' })])
    const listA = await service<{ patient_ref: string }[]>(`select public.client_orders($1) as r`, [sa])
    const listB = await service<{ patient_ref: string }[]>(`select public.client_orders($1) as r`, [sb])
    expect(listA.map(o => o.patient_ref)).toEqual(['A-1'])
    expect(listB.map(o => o.patient_ref)).toEqual(['B-1'])
    expect(await serviceError(`select public.client_order_detail($1, $2) as r`, [sb, orderA])).toMatch(/Order not found/)
    expect(await serviceError(`select public.client_post_message($1, $2, 'hi') as r`, [sb, orderA])).toMatch(/Order not found/)
    expect(await serviceError(`select public.client_file_slot($1, $2, 'scan.stl', 10, $3, null) as r`, [sb, orderA, 'a'.repeat(64)])).toMatch(/Order not found/)
    // A new order rang the owner's bell, and says nothing about the patient.
    const { rows } = await db.query<{ detail: Record<string, unknown> }>(
      `select detail from public.notification where org_id = $1 and kind = 'client_order' order by created_at desc limit 1`, [A.clinicId])
    expect(Object.keys(rows[0].detail)).toEqual(['order'])
  })

  it('an ended connection: access goes at once', async () => {
    const s = await confirmedSession(acct(20), 'Ended Fake')
    expect(await service(`select public.client_orders($1) as r`, [s])).toEqual([])
    await rowsAs(db, { id: A.ownerId }, `select public.network_end_client($1)`, [await clientId(A.clinicId, acct(20))])
    expect(await serviceError(`select public.client_orders($1) as r`, [s])).toMatch(/Session not valid/)
    // Asking again is a new request, not a door back in.
    expect((await connect(NET_A, acct(20), profile('Ended Fake'))).state).toBe('requested')
  })

  it('the client ending it itself, and the portal turned off, end it too', async () => {
    const s1 = await confirmedSession(acct(21), 'Leaver Mock')
    await service(`select public.client_end($1) as r`, [s1])
    expect(await serviceError(`select public.client_orders($1) as r`, [s1])).toMatch(/Session not valid/)
  })

  it('the Network down: a session given keeps working until it expires, then not', async () => {
    const s = await confirmedSession(acct(30), 'Offline Fake')
    // No call to the Network is ever made by the database: the session is all it reads.
    expect(await service(`select public.client_orders($1) as r`, [s])).toEqual([])
    await db.query(`update public.network_client_session set expires_at = now() - interval '1 second'
                     where client_id = $1`, [await clientId(A.clinicId, acct(30))])
    expect(await serviceError(`select public.client_orders($1) as r`, [s])).toMatch(/Session not valid/)
  })

  it('a made-up session, or none, is refused', async () => {
    expect(await serviceError(`select public.client_orders($1) as r`, ['f'.repeat(64)])).toMatch(/Session not valid/)
    expect(await serviceError(`select public.client_orders($1) as r`, ['not-a-session'])).toMatch(/Session not valid/)
  })
})

describe('orders', () => {
  it('refuses what is not a Wivo order of this clinic\'s catalogue', async () => {
    const s = await confirmedSession(acct(40), 'Strict Fake')
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s, order({ work_type: 'Gold tooth' })])).toMatch(/not in the clinic/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s, order({ patient_ref: '' })])).toMatch(/patient reference/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s, order({ personal_code: '39001010000' })])).toMatch(/Unknown field/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s, order({ teeth: '99' })])).toMatch(/FDI/)
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [s, order({ version: 2 })])).toMatch(/Not a Wivo order/)
  })

  it('the catalogue shows prices only when the owner allows it', async () => {
    const hidden = await confirmedSession(acct(41), 'No Prices')
    const shown = await confirmedSession(acct(42), 'With Prices', '{"prices": true}')
    const a = await service<{ name: string; price?: number; groups: { options: { name: string }[] }[] }[]>(`select public.client_catalog($1) as r`, [hidden])
    const b = await service<{ name: string; price?: number }[]>(`select public.client_catalog($1) as r`, [shown])
    expect(a.map(x => x.name)).toEqual(['Zirconia crown', 'All-on-4'])
    expect(a.every(x => x.price === undefined)).toBe(true)
    expect(b.find(x => x.name === 'All-on-4')?.price).toBe(2400)
    expect(a[1].groups[0].options[0].name).toBe('Metal bar')
  })

  it('accepted with a template it is a job; the client follows it: in progress, ready, sent', async () => {
    const s = await confirmedSession(acct(50), 'Follow Fake')
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [s, order({ patient_ref: 'F-9' })])
    expect(await errorAs(db, { id: A.workerId }, `select public.accept_client_order($1, null)`, [id])).toMatch(/Edit jobs/)
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    const { rows: [j] } = await db.query<{ patsient: string; too: string; customer_id: string }>(
      `select patsient, too, customer_id from public.jobs where id = $1`, [job])
    expect(j.patsient).toBe('F-9')
    expect(j.too).toBe('Zirconia crown')
    const status = async () => (await service<{ status: string }[]>(`select public.client_orders($1) as r`, [s]))[0].status
    expect(await status()).toBe('in_progress')
    await db.query(`update public.jobs set status = (public.stage_order(clinic_id))[array_length(public.stage_order(clinic_id), 1)] where id = $1`, [job])
    expect(await status()).toBe('ready')
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [job])
    expect(await status()).toBe('sent')
    expect(await errorAs(db, { id: A.ownerId }, `select public.reject_client_order($1, 'late')`, [id])).toMatch(/already decided/)
  })

  it('rejected with a reason the client reads; messages go both ways', async () => {
    const s = await confirmedSession(acct(51), 'Reject Fake')
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [s, order()])
    await service(`select public.client_post_message($1, $2, 'Is Friday possible?') as r`, [s, id])
    await rowsAs(db, { id: A.ownerId }, `select public.post_order_message($1, 'Monday at the earliest')`, [id])
    expect(await errorAs(db, { id: A.ownerId }, `select public.reject_client_order($1, '')`, [id])).toMatch(/Say why/)
    await rowsAs(db, { id: A.ownerId }, `select public.reject_client_order($1, 'We do not do this work type now')`, [id])
    const d = await service<{ status: string; reject_reason: string; messages: { from_client: boolean }[] }>(`select public.client_order_detail($1, $2) as r`, [s, id])
    expect(d.status).toBe('rejected')
    expect(d.reject_reason).toBe('We do not do this work type now')
    expect(d.messages.map(m => m.from_client)).toEqual([true, false])
  })

  it('messages turned off for a client: none shown, none sent', async () => {
    const s = await confirmedSession(acct(52), 'Quiet Fake', '{"messages": false}')
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [s, order()])
    expect(await serviceError(`select public.client_post_message($1, $2, 'hello')`, [s, id])).toMatch(/off for you/)
    const d = await service<{ messages: unknown }>(`select public.client_order_detail($1, $2) as r`, [s, id])
    expect(d.messages).toBeNull()
  })
})

describe('who may run what', () => {
  it('the client functions: the service role only, never a signed-in person or anon', async () => {
    for (const fn of ['client_orders($1)', 'client_catalog($1)', 'client_end($1)']) {
      expect(await errorAs(db, { id: A.ownerId }, `select public.${fn}`, ['x'.repeat(64)])).toMatch(/permission denied/)
      expect(await errorAs(db, 'anon', `select public.${fn}`, ['x'.repeat(64)])).toMatch(/permission denied/)
    }
    expect(await errorAs(db, { id: A.ownerId }, `select public.network_connect($1, $2, gen_random_uuid(), '{}'::jsonb)`, [NET_A, acct(99)])).toMatch(/permission denied/)
  })

  it('the clinic\'s people see orders by their rights; another clinic sees none; nobody sees sessions', async () => {
    const owner = await rowsAs(db, { id: A.ownerId }, `select 1 from public.client_order`)
    expect(owner.length).toBeGreaterThan(0)
    expect(await rowsAs(db, { id: A.workerId }, `select 1 from public.client_order`)).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.client_order where org_id = $1`, [A.clinicId])).toEqual([])
    expect(await rowsAs(db, { id: A.ownerId }, `select 1 from public.network_client_session`).catch(() => [])).toEqual([])
    expect(await rowsAs(db, { id: B.ownerId }, `select 1 from public.network_client where org_id = $1`, [A.clinicId])).toEqual([])
  })

  it('turning the portal off ends every session', async () => {
    const s = await confirmedSession(acct(60), 'Last Fake')
    await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(false, $1, $2, 8)`, [KEY, NET_A])
    expect(await serviceError(`select public.client_orders($1) as r`, [s])).toMatch(/Session not valid/)
    await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, [KEY, NET_A])
    expect(await serviceError(`select public.client_orders($1) as r`, [s])).toMatch(/Session not valid/)
  })
})
