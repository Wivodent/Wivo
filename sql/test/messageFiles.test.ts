/**
 * sql/143: files in an order's messages, both ways, and "Needs your review".
 * A client's file reaches the clinic; the clinic's file reaches the client;
 * a client never reaches another order's files; Approve and Request changes
 * reach the clinic (its bell, once), as a message of their own.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
const NET = 'aaaaaaaa-0000-4000-8000-000000000041'
const acct = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
const SHA = 'a'.repeat(64)
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
async function client(n: number, name: string): Promise<string> {
  const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
    [NET, acct(n), JSON.stringify({ name, kind: 'person', role: 'technician', company: null, country: 'LV' })])
  await connect()
  const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1 and account_id = $2`, [A.clinicId, acct(n)])
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])
  return (await connect()).session!
}
const newOrder = (session: string) => service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
  format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: `CASE-${++refs}`, notes: null })])
/** What Storage does on upload, as the uploader (the service role signs the client's link). */
const storeAsService = (path: string) => db.query(`insert into storage.objects (bucket_id, name) values ('job-files', $1)`, [path])

let tess: string
let other: string
let order: string

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
  await db.query(`insert into storage.buckets (id, name, file_size_limit) values ('job-files', 'job-files', 1000000) on conflict (id) do update set file_size_limit = 1000000`)
  tess = await client(1, 'Tess Fake')
  other = await client(2, 'Other Client')
  order = await newOrder(tess)
}, 120_000)

describe('a file from the client to the clinic (sql/143)', () => {
  it('with its message: the clinic sees it on that message and may download it', async () => {
    const msg = await service<string>(`select public.client_post_message($1, $2, 'Photo of the margin') as r`, [tess, order])
    const slot = await service<{ file_id: string; path: string }>(`select public.client_message_file_slot($1, $2, 'margin.jpg', 2000, $3, 'image/jpeg') as r`, [tess, msg, SHA])
    await storeAsService(slot.path)
    await service(`select public.client_file_done($1, $2)`, [tess, slot.file_id])
    const seen = await rowsAs<{ message_id: string; from_client: boolean }>(db, { id: A.ownerId },
      `select message_id, from_client from public.client_order_file where id = $1 and completed_at is not null`, [slot.file_id])
    expect(seen).toEqual([{ message_id: msg, from_client: true }])
    const [{ path }] = await rowsAs<{ path: string }>(db, { id: A.ownerId }, `select public.request_order_file_download($1) as path`, [slot.file_id])
    expect(path).toBe(slot.path)
  })

  it('larger than the clinic takes, or on a message that is not its own: refused', async () => {
    const msg = await service<string>(`select public.client_post_message($1, $2, 'Big one') as r`, [tess, order])
    expect(await serviceError(`select public.client_message_file_slot($1, $2, 'big.stl', 2000000, $3, null)`, [tess, msg, SHA])).toMatch(/larger than this clinic takes/)
    const [{ m }] = await rowsAs<{ m: string }>(db, { id: A.ownerId }, `select public.post_order_message_v2($1, 'Ours', false) as m`, [order])
    expect(await serviceError(`select public.client_message_file_slot($1, $2, 'x.jpg', 10, $3, null)`, [tess, m, SHA])).toMatch(/Message not found/)
    expect(await serviceError(`select public.client_message_file_slot($1, $2, 'x.jpg', 10, $3, null)`, [other, msg, SHA])).toMatch(/Message not found/)
  })
})

describe('a file from the clinic to the client', () => {
  let fileId: string
  let path: string
  it('a message needing review, with a file the clinic uploads itself; the client sees and downloads it', async () => {
    const [{ m }] = await rowsAs<{ m: string }>(db, { id: A.ownerId }, `select public.post_order_message_v2($1, 'The design, please check', true) as m`, [order])
    const [{ slot }] = await rowsAs<{ slot: { file_id: string; path: string } }>(db, { id: A.ownerId },
      `select public.order_file_slot($1, 'design.stl', 5000, $2, 'model/stl') as slot`, [m, SHA])
    ;({ file_id: fileId, path } = slot)
    // Storage, as the owner: the policy lets the slot's maker upload to it, nobody else, nowhere else.
    expect(await errorAs(db, { id: A.workerId }, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [path, A.workerId])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [path + 'x', A.ownerId])).not.toBeNull()
    expect(await errorAs(db, { id: A.ownerId }, `insert into storage.objects (bucket_id, name, owner) values ('job-files', $1, $2)`, [path, A.ownerId])).toBeNull()
    await rowsAs(db, { id: A.ownerId }, `select public.order_file_done($1)`, [fileId])
    const detail = await service<{ messages: { id: string; needs_review: boolean }[]; files: { id: string; message_id: string; from_client: boolean }[] }>(
      `select public.client_order_detail($1, $2) as r`, [tess, order])
    expect(detail.messages.find(x => x.id === m)!.needs_review).toBe(true)
    expect(detail.files.find(f => f.id === fileId)).toMatchObject({ message_id: m, from_client: false })
    expect(await service<string>(`select public.client_file_path($1, $2) as r`, [tess, fileId])).toBe(path)
  })

  it('another client never reaches it, nor the order', async () => {
    expect(await serviceError(`select public.client_file_path($1, $2)`, [other, fileId])).toMatch(/File not found/)
    expect(await serviceError(`select public.client_order_detail($1, $2)`, [other, order])).toMatch(/Order not found/)
  })
})

describe('Needs your review: Approve and Request changes reach the clinic', () => {
  it('approve: an answer message, the owner’s bell once (client_review), no client_message for it', async () => {
    const [{ m }] = await rowsAs<{ m: string }>(db, { id: A.ownerId }, `select public.post_order_message_v2($1, 'Shade check', true) as m`, [order])
    const before = await rowsAs<{ n: number }>(db, { id: A.ownerId }, `select count(*)::int as n from public.notification where kind = 'client_message'`)
    const answer = await service<string>(`select public.client_review($1, $2, 'approved', null) as r`, [tess, m])
    const [row] = await rowsAs<{ review_of: string; review_state: string; from_client: boolean }>(db, { id: A.ownerId },
      `select review_of, review_state, from_client from public.client_order_message where id = $1`, [answer])
    expect(row).toEqual({ review_of: m, review_state: 'approved', from_client: true })
    const bell = await rowsAs<{ detail: { decision: string; order: string } }>(db, { id: A.ownerId },
      `select detail from public.notification where kind = 'client_review' order by created_at desc limit 1`)
    expect(bell[0].detail).toMatchObject({ decision: 'approved', order })
    const after = await rowsAs<{ n: number }>(db, { id: A.ownerId }, `select count(*)::int as n from public.notification where kind = 'client_message'`)
    expect(after[0].n).toBe(before[0].n)
  })

  it('request changes needs a comment; only a message that asks for review can be answered', async () => {
    const [{ m }] = await rowsAs<{ m: string }>(db, { id: A.ownerId }, `select public.post_order_message_v2($1, 'Framework check', true) as m`, [order])
    expect(await serviceError(`select public.client_review($1, $2, 'changes', '  ')`, [tess, m])).toMatch(/Say what to change/)
    const answer = await service<string>(`select public.client_review($1, $2, 'changes', 'Move the bar 1 mm') as r`, [tess, m])
    const { rows } = await db.query<{ body: string; review_state: string }>(`select body, review_state from public.client_order_message where id = $1`, [answer])
    expect(rows[0]).toEqual({ body: 'Move the bar 1 mm', review_state: 'changes' })
    const [{ plain }] = await rowsAs<{ plain: string }>(db, { id: A.ownerId }, `select public.post_order_message_v2($1, 'Just a note', false) as plain`, [order])
    expect(await serviceError(`select public.client_review($1, $2, 'approved', null)`, [tess, plain])).toMatch(/Message not found/)
    expect(await serviceError(`select public.client_review($1, $2, 'approved', null)`, [other, m])).toMatch(/Message not found/)
  })
})

describe('who may run what', () => {
  it('the client functions: the service role only; the clinic functions: signed in, nobody anonymous', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_review('x', gen_random_uuid(), 'approved', null)`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select public.post_order_message_v2(gen_random_uuid(), 'x', false)`)).toMatch(/permission denied/)
    expect(await errorAs(db, { id: A.workerId }, `select public.post_order_message_v2($1, 'x', false)`, [order])).toMatch(/Not allowed/)
  })
})
