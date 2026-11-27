/**
 * sql/144: Fitted / Needs adjustment and ratings, behind the `ratings` module.
 * Our own jobs (the doctor; a revision and the makers told), ratings both
 * ways with who sees what, and the Network client's side.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let doctor: string
let designer: string
let last: string
let first: string
const NET = 'aaaaaaaa-0000-4000-8000-000000000051'

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
async function job(status = last): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status, order_doctor, assigned_to, designed_by) values ($1, 'X', $2, $3, $4, $5) returning id`,
    [A.clinicId, status, doctor, A.workerId, designer])
  return rows[0].id
}
const ratingsOn = (on: boolean) => db.query(`insert into public.clinic_settings (clinic_id, features) values ($1, $2::jsonb)
  on conflict (clinic_id) do update set features = coalesce(public.clinic_settings.features, '{}'::jsonb) || excluded.features`, [A.clinicId, JSON.stringify({ ratings: on })])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  doctor = await createUser(db, 'Dr Doctor')
  designer = await createUser(db, 'Dee Designer')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'doctor' where id = $2`, [A.clinicId, doctor])
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'technician' where id = $2`, [A.clinicId, designer])
  const { rows: [s] } = await db.query<{ first: string; last: string }>(
    `select (public.stage_order($1))[1] as first, (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])
  ;({ first, last } = s)
  await db.query(`insert into public.clinic_settings (clinic_id, work_types) values ($1, $2::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types`, [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
}, 120_000)

describe('the ratings module (sql/144)', () => {
  it('off: nothing works', async () => {
    await ratingsOn(false)
    const j = await job()
    expect(await errorAs(db, { id: doctor }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])).toMatch(/not on/)
    expect(await errorAs(db, { id: doctor }, `select public.rate_job($1, 'work', 5, null)`, [j])).toMatch(/not on/)
    await ratingsOn(true)
  })
})

describe('Fitted / Needs adjustment on our own job', () => {
  it('fitted: the tick, and a record', async () => {
    const j = await job()
    await rowsAs(db, { id: doctor }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])
    const { rows } = await db.query<{ fitted_at: string | null }>(`select fitted_at from public.jobs where id = $1`, [j])
    expect(rows[0].fitted_at).not.toBeNull()
    expect((await db.query(`select 1 from public.job_fit where job_id = $1 and decision = 'fitted' and by_profile = $2`, [j, doctor])).rows).toHaveLength(1)
  })

  it('needs adjustment: reason and text required; a revision at the first stage; the technician and designer told; the tick gone', async () => {
    const j = await job()
    await db.query(`update public.jobs set fitted_at = now() where id = $1`, [j])
    expect(await errorAs(db, { id: doctor }, `select public.job_fit_decide($1, 'adjust', 'Halb passivus', '  ')`, [j])).toMatch(/reason and what to change/)
    const [{ rev }] = await rowsAs<{ rev: string }>(db, { id: doctor }, `select public.job_fit_decide($1, 'adjust', 'Halb passivus', 'Too tight on 21') as rev`, [j])
    const { rows: [jj] } = await db.query<{ revisions: { id: string; reasons: string[]; note: string; status: string }[]; fitted_at: string | null }>(
      `select revisions, fitted_at from public.jobs where id = $1`, [j])
    expect(jj.fitted_at).toBeNull()
    expect(jj.revisions.at(-1)).toMatchObject({ id: rev, reasons: ['Halb passivus'], note: 'Too tight on 21', status: first })
    const { rows: told } = await db.query<{ user_id: string }>(`select user_id from public.notification where kind = 'job_adjust' and job_id = $1`, [j])
    expect(told.map(r => r.user_id).sort()).toEqual([A.workerId, designer].sort())
  })

  it('only the doctor (or a clinic doctor, or the owner), and only when the work is done', async () => {
    const j = await job()
    expect(await errorAs(db, { id: A.workerId }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])).toMatch(/Only the doctor/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.job_fit_decide($1, 'fitted', null, null)`, [j])).toBeNull()
    const early = await job(first)
    expect(await errorAs(db, { id: doctor }, `select public.job_fit_decide($1, 'fitted', null, null)`, [early])).toMatch(/not done/)
  })
})

describe('ratings on our own jobs', () => {
  it('the doctor rates the work: one row for the technician and one for the designer; they rate the input', async () => {
    const j = await job()
    const [{ n }] = await rowsAs<{ n: number }>(db, { id: doctor }, `select public.rate_job($1, 'work', 4, 'Nice margins') as n`, [j])
    expect(n).toBe(2)
    await rowsAs(db, { id: A.workerId }, `select public.rate_job($1, 'input', 3, 'Scan was blurry')`, [j])
    expect(await errorAs(db, { id: A.workerId }, `select public.rate_job($1, 'work', 5, null)`, [j])).toMatch(/Only the doctor/)
    expect(await errorAs(db, { id: doctor }, `select public.rate_job($1, 'input', 5, null)`, [j])).toMatch(/Only the technician/)
    // Again: changed, not doubled.
    await rowsAs(db, { id: doctor }, `select public.rate_job($1, 'work', 5, 'Even better')`, [j])
    expect((await db.query(`select 1 from public.job_rating where job_id = $1 and direction = 'work'`, [j])).rows).toHaveLength(2)
  })

  it('a person sees their own average and comments, not who or which job; not each other’s; the owner sees all', async () => {
    const [{ s }] = await rowsAs<{ s: { count: number; average: number; comments: Record<string, unknown>[] } }>(db, { id: A.workerId }, `select public.my_rating_summary() as s`)
    expect(s.count).toBe(1)
    expect(Number(s.average)).toBe(5)
    expect(Object.keys(s.comments[0]).sort()).toEqual(['comment', 'month', 'score'])
    // The technician reads only the rating it gave; the designer none of the technician's.
    const techRows = await rowsAs<{ rater_profile: string }>(db, { id: A.workerId }, `select rater_profile from public.job_rating`)
    expect(techRows.every(r => r.rater_profile === A.workerId)).toBe(true)
    expect(await rowsAs(db, { id: designer }, `select 1 from public.job_rating`)).toEqual([])
    expect((await rowsAs(db, { id: A.ownerId }, `select 1 from public.job_rating`)).length).toBeGreaterThanOrEqual(3)
  })
})

describe('the Network client’s side', () => {
  let session: string
  let order: string
  let jobId: string
  beforeAll(async () => {
    await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
    const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
      [NET, 'cccccccc-0000-4000-8000-000000000051', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV' })])
    await connect()
    const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])
    await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [id])
    session = (await connect()).session!
    order = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
      format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: 'CASE-FIT', notes: null })])
    ;[{ job: jobId }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [order])
  })

  it('not before the work is sent; then Needs adjustment makes a revision, a message in the conversation, one bell', async () => {
    expect(await serviceError(`select public.client_fit($1, $2, 'fitted', null, null)`, [session, order])).toMatch(/not sent/)
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [jobId])
    const msg = await service<string>(`select public.client_fit($1, $2, 'adjust', 'Halb passivus', 'Rocks on 11') as r`, [session, order])
    const { rows: [m] } = await db.query<{ fit_state: string; body: string; from_client: boolean }>(`select fit_state, body, from_client from public.client_order_message where id = $1`, [msg])
    expect(m).toEqual({ fit_state: 'adjust', body: 'Halb passivus: Rocks on 11', from_client: true })
    const { rows: [jj] } = await db.query<{ n: number }>(`select jsonb_array_length(revisions) as n from public.jobs where id = $1`, [jobId])
    expect(jj.n).toBe(1)
    const bell = await rowsAs<{ kind: string }>(db, { id: A.ownerId }, `select kind from public.notification where detail->>'order' = $1 and kind in ('client_fit', 'client_message')`, [order])
    expect(bell.map(b => b.kind)).toEqual(['client_fit'])
    // Its photos go with the message (sql/143), as any client message's.
    const slot = await service<{ file_id: string }>(`select public.client_message_file_slot($1, $2, 'photo.jpg', 10, $3, 'image/jpeg') as r`, [session, msg, 'a'.repeat(64)])
    expect(slot.file_id).toBeTruthy()
  })

  it('the client rates the clinic; the clinic rates the client; what the client said comes back to it', async () => {
    await service(`select public.client_rate_clinic($1, $2, 5, 'Fast and friendly')`, [session, order])
    await rowsAs(db, { id: A.ownerId }, `select public.rate_client($1, 3, 'Scan was partial')`, [order])
    const fb = await service<{ enabled: boolean; fit: { decision: string }; rating: { score: number } }>(`select public.client_feedback($1, $2) as r`, [session, order])
    expect(fb).toMatchObject({ enabled: true, fit: { decision: 'adjust' }, rating: { score: 5 } })
  })

  it('the owner sees each client’s average and adjustments; nobody else', async () => {
    const owner = await rowsAs<{ average: string; ratings: number; adjustments: number }>(db, { id: A.ownerId }, `select * from public.client_feedback_summary()`)
    expect(owner).toHaveLength(1)
    expect(owner[0]).toMatchObject({ ratings: 1, adjustments: 1 })
    expect(Number(owner[0].average)).toBe(3)
    expect(await rowsAs(db, { id: A.workerId }, `select * from public.client_feedback_summary()`)).toEqual([])
  })
})

describe('who may run what', () => {
  it('the client functions: the service role only', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_fit('x', gen_random_uuid(), 'fitted', null, null)`)).toMatch(/permission denied/)
    expect(await errorAs(db, 'anon', `select public.rate_job(gen_random_uuid(), 'work', 5, null)`)).toMatch(/permission denied/)
  })
})
