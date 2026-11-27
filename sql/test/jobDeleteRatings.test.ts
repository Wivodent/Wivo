/**
 * sql/146: one rating per rater, ratee and job (saving again changes the row,
 * the averages do not move; only someone on the work rates it, after
 * Received), and deleting a job safely (money ties refuse it; a Network
 * order's job needs its code and a reason, the order is "Cancelled by
 * clinic" and comes back on restore; the owner purges from the bin).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, makeRow, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let doctor: string
let other: string
let last: string
let session: string
let clientId: string
const NET = 'aaaaaaaa-0000-4000-8000-000000000053'

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

/** Our own job, sent and handed over (so received). */
async function ownJob(received = true): Promise<{ id: string; code: string }> {
  const { rows: [j] } = await db.query<{ id: string; job_code: string }>(
    `insert into public.jobs (clinic_id, patsient, status, order_doctor, assigned_to) values ($1, 'X', $2, $3, $4) returning id, job_code`,
    [A.clinicId, last, doctor, A.workerId])
  if (received) await db.query(`update public.jobs set delivery_status = 'yle_antud' where id = $1`, [j.id])
  return { id: j.id, code: j.job_code }
}
async function order(ref: string): Promise<{ order: string; job: string; code: string }> {
  const id = await service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
    format: 'wivo-order', version: 1, work_type: 'Zirconia crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: ref, notes: null })])
  const [{ job }] = await rowsAs<{ job: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as job`, [id])
  const { rows: [j] } = await db.query<{ job_code: string }>(`select job_code from public.jobs where id = $1`, [job])
  return { order: id, job, code: j.job_code }
}
const status = (o: string) => service<{ status: string; cancel_reason: string | null }>(`select public.client_order_detail($1, $2) as r`, [session, o])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  doctor = await createUser(db, 'Dr Doctor')
  other = await createUser(db, 'Dr Other')
  for (const p of [doctor, other]) await db.query(`update public.profiles set clinic_id = $1, role = 'worker', org_role = 'doctor' where id = $2`, [A.clinicId, p])
  await grant(db, A, A.workerId, ['jobs.read', 'jobs.write'])
  ;[{ last }] = (await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])).rows
  await db.query(`insert into public.clinic_settings (clinic_id, work_types, features) values ($1, $2::jsonb, '{"ratings": true}'::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types, features = excluded.features`,
    [A.clinicId, JSON.stringify([{ nimi: 'Zirconia crown', hex: '#000', hind: 120 }])])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, ['A'.repeat(43), NET])
  const connect = () => service<{ state: string; session?: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`,
    [NET, 'cccccccc-0000-4000-8000-000000000053', JSON.stringify({ name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV' })])
  await connect()
  ;[{ id: clientId }] = (await db.query<{ id: string }>(`select id from public.network_client where org_id = $1`, [A.clinicId])).rows
  await rowsAs(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clients', '{}'::jsonb)`, [clientId])
  session = (await connect()).session!
}, 120_000)

describe('one rating per rater, ratee and job', () => {
  it('the same person saves 10 times: one row, the average does not move by repeating', async () => {
    const j = await ownJob()
    for (let i = 0; i < 10; i++) await rowsAs(db, { id: doctor }, `select public.rate_job($1, 'work', 4, 'Good')`, [j.id])
    expect((await db.query(`select 1 from public.job_rating where job_id = $1`, [j.id])).rows).toHaveLength(1)
    // Unchanged saves change nothing, so nothing is logged either.
    expect((await db.query(`select 1 from public.job_rating_change c join public.job_rating r on r.id = c.rating_id where r.job_id = $1`, [j.id])).rows).toHaveLength(0)
    const [{ s }] = await rowsAs<{ s: { count: number; average: string } }>(db, { id: A.workerId }, `select public.my_rating_summary() as s`)
    expect(s.count).toBe(1)
    expect(Number(s.average)).toBe(4)
    // A change is the same row, logged.
    await rowsAs(db, { id: doctor }, `select public.rate_job($1, 'work', 2, 'Rocks')`, [j.id])
    expect((await db.query(`select score from public.job_rating where job_id = $1`, [j.id])).rows).toEqual([{ score: 2 }])
    expect((await db.query(`select 1 from public.job_rating_change c join public.job_rating r on r.id = c.rating_id where r.job_id = $1`, [j.id])).rows).toHaveLength(1)
  })

  it('the clinic rates the client 10 times, the client the clinic 10 times: one row each, averages unchanged', async () => {
    const { order: o, job } = await order('CASE-TEN')
    await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [job, last])
    await service(`select public.client_received($1, $2)`, [session, o])
    for (let i = 0; i < 10; i++) {
      await rowsAs(db, { id: A.ownerId }, `select public.rate_client($1, 3, null)`, [o])
      await service(`select public.client_rate_clinic($1, $2, 5, null)`, [session, o])
    }
    const rows = (await db.query<{ direction: string }>(`select direction from public.job_rating where job_id = $1 order by direction`, [job])).rows
    expect(rows.map(r => r.direction)).toEqual(['client_to_clinic', 'clinic_to_client'])
    const [sum] = await rowsAs<{ average: string; ratings: number }>(db, { id: A.ownerId }, `select * from public.client_feedback_summary()`)
    expect(sum.ratings).toBe(1)
    expect(Number(sum.average)).toBe(3)
    // What the clinic gave is what it reads back (the form after reopening).
    const back = await rowsAs<{ score: number }>(db, { id: A.ownerId },
      `select score from public.job_rating where job_id = $1 and direction = 'clinic_to_client' and rater_profile = $2`, [job, A.ownerId])
    expect(back).toEqual([{ score: 3 }])
  })

  it('only someone on the work, only after Received', async () => {
    const j = await ownJob()
    expect(await errorAs(db, { id: other }, `select public.rate_job($1, 'work', 5, null)`, [j.id])).toMatch(/Only the doctor who ordered it/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.rate_job($1, 'work', 5, null)`, [j.id])).toMatch(/Only the doctor who ordered it/)
    const notYet = await ownJob(false)
    await db.query(`update public.jobs set delivery_status = 'teel' where id = $1`, [notYet.id])
    expect(await errorAs(db, { id: doctor }, `select public.rate_job($1, 'work', 5, null)`, [notYet.id])).toMatch(/Not received/)
    const { order: o, job } = await order('CASE-WHO')
    await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [job, last])
    await service(`select public.client_received($1, $2)`, [session, o])
    await db.query(`update public.jobs set assigned_to = $2 where id = $1`, [job, A.workerId])
    expect(await errorAs(db, { id: other }, `select public.rate_client($1, 4, null)`, [o])).toMatch(/Only someone on the job/)
    expect(await errorAs(db, { id: A.workerId }, `select public.rate_client($1, 4, null)`, [o])).toBeNull()
    // Fitted on an order from outside is the client's.
    expect(await errorAs(db, { id: A.ownerId }, `select public.job_fit_decide($1, 'fitted', null, null)`, [job])).toMatch(/client says/)
  })
})

describe('deleting a job', () => {
  it('a plain job: into the bin, audited; restored; the owner purges it for good with its code', async () => {
    const j = await ownJob()
    const [{ c }] = await rowsAs<{ c: { blocked: string | null; order: unknown; files: number } }>(db, { id: A.ownerId }, `select public.job_delete_check($1) as c`, [j.id])
    expect(c).toMatchObject({ blocked: null, order: null, files: 0 })
    await rowsAs(db, { id: A.ownerId }, `select public.delete_job($1, null, null)`, [j.id])
    expect((await db.query(`select deleted_at from public.jobs where id = $1`, [j.id])).rows[0]).toMatchObject({ deleted_at: expect.anything() })
    const audit = (await db.query<{ action: string }>(`select action from public.audit_log where object = $1 order by at`, [`job:${j.id}`])).rows
    expect(audit.map(a => a.action)).toContain('delete')
    await rowsAs(db, { id: A.ownerId }, `select public.restore_job($1)`, [j.id])
    expect((await db.query(`select deleted_at from public.jobs where id = $1`, [j.id])).rows[0]).toEqual({ deleted_at: null })

    await rowsAs(db, { id: A.ownerId }, `select public.delete_job($1, null, null)`, [j.id])
    await grant(db, A, A.workerId, ['jobs.read', 'jobs.write', 'jobs.delete'])
    expect(await errorAs(db, { id: A.workerId }, `select public.purge_job($1, $2)`, [j.id, j.code])).toMatch(/Only the owner/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.purge_job($1, 'nope')`, [j.id])).toMatch(/Type the job code/)
    await rowsAs(db, { id: A.ownerId }, `select public.purge_job($1, $2)`, [j.id, j.code])
    expect((await db.query(`select 1 from public.jobs where id = $1`, [j.id])).rows).toHaveLength(0)
    expect((await db.query<{ action: string }>(`select action from public.audit_log where object = $1`, [`job:${j.id}`])).rows.map(a => a.action)).toContain('purge')
    await db.query(`update public.worker_permissions set granted = false where profile_id = $1 and permission = 'jobs.delete'`, [A.workerId])
  })

  it('money tied to it: refused, even by a plain DELETE from an older build', async () => {
    const j = await ownJob()
    const line = await makeRow(db, 'invoice_lines', A)
    await db.query(`update public.invoice_lines set job_id = $2 where id = $1`, [line.id, j.id])
    const [{ c }] = await rowsAs<{ c: { blocked: string } }>(db, { id: A.ownerId }, `select public.job_delete_check($1) as c`, [j.id])
    expect(c.blocked).toBe('money')
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_job($1, null, null)`, [j.id])).toMatch(/cannot be deleted/)
    expect(await errorAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1`, [j.id])).toMatch(/cannot be deleted/)
  })

  it('a Network order’s job: the code and a reason; the order is Cancelled by clinic and told; restore brings it back', async () => {
    const { order: o, job, code } = await order('CASE-DEL')
    await db.query(`update public.jobs set status = $2 where id = $1`, [job, last])
    expect((await status(o)).status).toBe('ready')
    const [{ c }] = await rowsAs<{ c: { order: { client: string; ref: string } } }>(db, { id: A.ownerId }, `select public.job_delete_check($1) as c`, [job])
    expect(c.order).toMatchObject({ client: 'Tess Fake', ref: 'CASE-DEL' })
    // An older build's plain DELETE, or no code: refused.
    expect(await errorAs(db, { id: A.ownerId }, `delete from public.jobs where id = $1`, [job])).toMatch(/order from outside/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_job($1, 'Duplicate', 'WRONG')`, [job])).toMatch(/Type the job code/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.delete_job($1, '  ', $2)`, [job, code])).toMatch(/reason/)
    await rowsAs(db, { id: A.ownerId }, `select public.delete_job($1, 'Made twice by mistake', $2)`, [job, ` ${code.toLowerCase()} `])
    expect(await status(o)).toMatchObject({ status: 'cancelled', cancel_reason: 'Made twice by mistake' })
    const told = (await db.query<{ kind: string; reason: string | null }>(`select kind, reason from public.client_notification where order_id = $1 order by created_at`, [o])).rows
    expect(told.at(-1)).toEqual({ kind: 'cancelled', reason: 'Made twice by mistake' })
    const [{ d }] = await rowsAs<{ d: string }>(db, { id: A.ownerId }, `select order_client as d from public.deleted_jobs() where id = $1`, [job])
    expect(d).toBe('Tess Fake')

    await rowsAs(db, { id: A.ownerId }, `select public.restore_job($1)`, [job])
    expect((await status(o)).status).toBe('ready')
    expect((await db.query<{ kind: string }>(`select kind from public.client_notification where order_id = $1 order by created_at desc limit 1`, [o])).rows[0].kind).toBe('reinstated')
  })

  it('only with Delete jobs (owner and admin by default)', async () => {
    const j = await ownJob()
    expect(await errorAs(db, { id: A.workerId }, `select public.delete_job($1, null, null)`, [j.id])).toMatch(/Job not found/)
    expect(await errorAs(db, { id: A.workerId }, `select public.job_delete_check($1)`, [j.id])).toMatch(/Job not found/)
    expect(await errorAs(db, 'anon', `select public.purge_job($1, 'x')`, [j.id])).toMatch(/permission denied/)
  })

  it('a job with files is never purged: it stays in the bin', async () => {
    const j = await ownJob()
    await db.query(`insert into public.job_file (job_id, org_id, type, version, sha256, size, mime_type, file_name, storage_path, uploaded_by)
                    values ($1, $2, 'scan', 1, $3, 10, 'model/stl', 'a.stl', $4, $5)`, [j.id, A.clinicId, 'c'.repeat(64), `${A.clinicId}/${j.id}/a.stl`, A.ownerId])
    await rowsAs(db, { id: A.ownerId }, `select public.delete_job($1, null, null)`, [j.id])
    expect(await errorAs(db, { id: A.ownerId }, `select public.purge_job($1, $2)`, [j.id, j.code])).toMatch(/has files/)
    expect((await db.query(`select 1 from public.jobs where id = $1`, [j.id])).rows).toHaveLength(1)
  })
})
