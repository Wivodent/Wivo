/**
 * sql/142: notices for the Network client, from the clinic's own database,
 * and the clinic's bell for a client's message. What makes one, that a client
 * sees only its own, reading them, the e-mail list (address and choice from
 * the token; no message text), and who may run what.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
const NET = 'aaaaaaaa-0000-4000-8000-000000000031'
const acct = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
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
const connect = (n: number, name: string) => service<{ state: string; session?: string }>(
  `select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
  [NET, acct(n), JSON.stringify({ name, kind: 'person', role: 'technician', company: null, country: 'LV' })])
async function clientRow(n: number): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1 and account_id = $2`, [A.clinicId, acct(n)])
  return rows[0].id
}
async function confirmed(n: number, name: string): Promise<{ session: string; id: string }> {
  await connect(n, name)
  const id = await clientRow(n)
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])
  return { session: (await connect(n, name)).session!, id }
}
const order = () => JSON.stringify({ format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {},
  shade: null, due: null, patient_ref: `CASE-${++refs}`, notes: null })
type Notice = { id: string; kind: string; order_id: string | null; ref: string | null; reason: string | null; read_at: string | null }
const notices = (session: string) => service<Notice[]>(`select public.client_notifications($1) as r`, [session])

let tess: { session: string; id: string }

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
  tess = await confirmed(1, 'Tess Fake')
}, 120_000)

describe('what tells the client (sql/142)', () => {
  it('the request confirmed', async () => {
    expect((await notices(tess.session)).map(n => n.kind)).toEqual(['connected'])
  })

  it('the clinic writes; the order is accepted; the job is ready, then sent: one notice each, with the reference', async () => {
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [tess.session, order()])
    await rowsAs(db, { id: A.ownerId }, `select public.post_order_message($1, 'Bar position confirmed')`, [id])
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    const { rows: [{ last }] } = await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])
    await db.query(`update public.jobs set status = $2 where id = $1`, [job, last])
    await db.query(`update public.jobs set status = $2 where id = $1`, [job, last])  // again: not told twice
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [job])
    const list = (await notices(tess.session)).filter(n => n.order_id === id)
    expect(list.map(n => n.kind)).toEqual(['sent', 'ready', 'accepted', 'message'])
    expect(new Set(list.map(n => n.ref))).toEqual(new Set([`CASE-${refs}`]))
    // The message itself is not in the notice.
    expect(JSON.stringify(list)).not.toContain('Bar position')
  })

  it('a refused order says why', async () => {
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [tess.session, order()])
    await rowsAs(db, { id: A.ownerId }, `select public.reject_client_order($1, 'We do not make these')`, [id])
    const n = (await notices(tess.session)).find(x => x.order_id === id)!
    expect(n).toMatchObject({ kind: 'rejected', reason: 'We do not make these' })
  })

  it('progress is not told to a client who may not see it', async () => {
    const hidden = await confirmed(2, 'Hidden Progress')
    await rowsAs(db, { id: A.ownerId }, `select public.network_set_client_visibility($1, '{"status": false, "messages": true, "files": true, "prices": false}'::jsonb)`, [hidden.id])
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [hidden.session, order()])
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [job])
    expect((await notices(hidden.session)).filter(n => n.order_id === id).map(n => n.kind)).toEqual(['accepted'])
  })

  it('a declined request is told (the e-mail carries it: there is no session to read it with)', async () => {
    await connect(3, 'Declined Person')
    const id = await clientRow(3)
    await rowsAs(db, { id: A.ownerId }, `select public.network_end_client($1)`, [id])
    const { rows } = await db.query<{ kind: string }>(`select kind from public.client_notification where client_id = $1`, [id])
    expect(rows.map(r => r.kind)).toEqual(['declined'])
  })
})

describe('the client reads its own, and only its own', () => {
  it('another client sees none of Tess\'s; reading marks them', async () => {
    const other = await confirmed(4, 'Other Client')
    const theirs = await notices(other.session)
    const mine = await notices(tess.session)
    expect(theirs.some(n => mine.some(m => m.id === n.id))).toBe(false)
    const first = mine[0]
    expect(await service<number>(`select public.client_notifications_read($1, $2::uuid[]) as r`, [other.session, [first.id]])).toBe(0)
    expect(await service<number>(`select public.client_notifications_read($1, $2::uuid[]) as r`, [tess.session, [first.id]])).toBe(1)
    expect((await notices(tess.session)).find(n => n.id === first.id)!.read_at).not.toBeNull()
    await service(`select public.client_notifications_read($1, null) as r`, [tess.session])
    expect((await notices(tess.session)).every(n => n.read_at)).toBe(true)
  })
})

describe('e-mail to the client', () => {
  it('only with an address and e-mails on; the subject\'s parts only, never the message', async () => {
    const mail = await confirmed(5, 'Mail Person')
    await service(`select public.client_set_contact($1, $2, 'mail@fake.test', true)`, [NET, acct(5)])
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [mail.session, order()])
    await rowsAs(db, { id: A.ownerId }, `select public.post_order_message($1, 'Secret clinical detail')`, [id])
    type Row = { id: string; email: string; kind: string; ref: string; clinic: string }
    const { rows } = await db.query<Row>(`select * from public.pending_client_emails(200) where email = 'mail@fake.test'`)
    expect(rows.map(r => r.kind).sort()).toEqual(['connected', 'message'])
    expect(rows.find(r => r.kind === 'message')).toMatchObject({ ref: `CASE-${refs}`, clinic: 'Dentiks' })
    expect(JSON.stringify(rows)).not.toContain('Secret')
    await service(`select public.client_set_contact($1, $2, 'mail@fake.test', false)`, [NET, acct(5)])
    expect((await db.query(`select 1 from public.pending_client_emails(200) where email = 'mail@fake.test'`)).rows).toEqual([])
    // Tess gave no address: nothing for her.
    expect((await db.query(`select 1 from public.pending_client_emails(200) p join public.client_notification n on n.id = p.id where n.client_id = $1`, [tess.id])).rows).toEqual([])
  })
})

describe('the clinic hears a client\'s message', () => {
  it('in the owner\'s bell; once accepted, on the job', async () => {
    const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [tess.session, order()])
    await service(`select public.client_post_message($1, $2, 'Shade A2 please') as r`, [tess.session, id])
    const before = await rowsAs<{ kind: string; job_id: string | null; detail: { order: string; ref: string } }>(db, { id: A.ownerId },
      `select kind, job_id, detail from public.notification where kind = 'client_message' and detail->>'order' = $1`, [id])
    expect(before).toHaveLength(1)
    expect(before[0]).toMatchObject({ job_id: null, detail: { order: id, ref: `CASE-${refs}` } })
    const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
    await service(`select public.client_post_message($1, $2, 'And a second thing') as r`, [tess.session, id])
    const after = await rowsAs<{ job_id: string | null }>(db, { id: A.ownerId },
      `select job_id from public.notification where kind = 'client_message' and detail->>'order' = $1 order by created_at desc limit 1`, [id])
    expect(after[0].job_id).toBe(job)
  })
})

describe('who may run what', () => {
  it('the client functions and the e-mail list: the service role only; the table: the clinic reads, nobody writes', async () => {
    for (const call of [`select public.client_notifications('x')`, `select public.pending_client_emails(1)`,
      `select public.client_set_contact(gen_random_uuid(), gen_random_uuid(), 'a@b.c', true)`]) {
      expect(await errorAs(db, { id: A.ownerId }, call)).toMatch(/permission denied/)
      expect(await errorAs(db, 'anon', call)).toMatch(/permission denied/)
    }
    expect((await rowsAs(db, { id: A.ownerId }, `select 1 from public.client_notification`)).length).toBeGreaterThan(0)
    expect(await errorAs(db, { id: A.ownerId }, `update public.client_notification set read_at = now()`)).toMatch(/permission denied/)
  })
})
