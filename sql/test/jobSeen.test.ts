/**
 * sql/136: "new activity" on a job card, per person.
 *
 * A adds a file → B sees the mark, A does not. B opens the job → the mark is
 * gone for B on every device (another session reads the same row, and the
 * row reaches only B through realtime, because only B may read it). Old jobs
 * start as seen. Nobody learns what they could not open.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let T: Tenant
let other: Tenant

type Activity = { job_id: string; files: number; notes: number; messages: number; stages: number; people: string[] }
const activity = (id: string, session?: string) =>
  rowsAs<Activity>(db, { id, ...(session ? { claims: { session_id: session } } : {}) }, `select * from public.job_activity()`)

async function newJob(clinic: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.jobs (clinic_id, patsient, status, assigned_to)
     values ($1, 'Fake Patient', 'disain', (select id from public.profiles where clinic_id = $1 and role = 'worker' limit 1))
     returning id`, [clinic])
  return rows[0].id
}
let fileSeq = 0
async function addFile(job: string, org: string, by: string): Promise<void> {
  const n = ++fileSeq
  await db.query(
    `insert into public.job_file (job_id, org_id, type, sha256, size, file_name, storage_path, uploaded_by, completed_at)
     values ($1, $2, 'scan', repeat('a', 64), 10, 'scan.stl', 'p/' || $3, $4, now())`, [job, org, `${job}/${n}`, by])
}
/** Moves the clock: activity_seen_from is "now" at migration time, so the test starts it in the past. */
async function startFeatureBefore(clinic: string): Promise<void> {
  await db.query(`update public.clinics set activity_seen_from = now() - interval '1 hour' where id = $1`, [clinic])
  await db.query(`update public.profiles set created_at = now() - interval '2 hours' where clinic_id = $1`, [clinic])
}
async function session(user: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.sessions (user_id, aal) values ($1, 'aal2') returning id`, [user])
  return rows[0].id
}

beforeAll(async () => {
  db = await freshDb()
  T = await createTenant(db, 'Fakeville')
  other = await createTenant(db, 'Elsewhere')
  await startFeatureBefore(T.clinicId)
  await startFeatureBefore(other.clinicId)
  // The worker's own jobs (assigned_to, above), with Edit jobs for the note.
  await db.query(`insert into public.worker_permissions (profile_id, clinic_id, permission, granted) values ($1, $2, 'jobs.write', true)`, [T.workerId, T.clinicId])
}, 120_000)

describe('job_activity and mark_job_seen (sql/136)', () => {
  it('A adds a file: B sees the mark, A does not; B opens it: gone on both of B\'s devices', async () => {
    const job = await newJob(T.clinicId)
    const A = T.ownerId
    const B = T.workerId
    await addFile(job, T.clinicId, A)

    const forB = await activity(B)
    expect(forB.find(r => r.job_id === job)).toMatchObject({ files: 1, notes: 0, messages: 0 })
    expect(forB.find(r => r.job_id === job)!.people).toEqual(['Fakeville owner'])
    expect((await activity(A)).find(r => r.job_id === job)).toBeUndefined()

    // B has two devices: two sessions.
    const laptop = await session(B)
    const phone = await session(B)
    expect((await activity(B, laptop)).some(r => r.job_id === job)).toBe(true)
    await rowsAs(db, { id: B, claims: { session_id: laptop } }, `select public.mark_job_seen($1)`, [job])
    expect((await activity(B, laptop)).some(r => r.job_id === job)).toBe(false)
    expect((await activity(B, phone)).some(r => r.job_id === job)).toBe(false)

    // The row realtime sends: B reads it, A does not, another clinic does not.
    expect(await rowsAs(db, { id: B }, `select 1 from public.job_seen where job_id = $1`, [job])).toHaveLength(1)
    expect(await rowsAs(db, { id: A }, `select 1 from public.job_seen where job_id = $1`, [job])).toHaveLength(0)
    expect(await rowsAs(db, { id: other.ownerId }, `select 1 from public.job_seen where job_id = $1`, [job])).toHaveLength(0)

    // Something new after that: the mark comes back.
    await new Promise(r => setTimeout(r, 5))
    await addFile(job, T.clinicId, A)
    expect((await activity(B)).find(r => r.job_id === job)).toMatchObject({ files: 1 })
  })

  it('a note says who wrote it: not new to its author, new to the others', async () => {
    const job = await newJob(T.clinicId)
    await rowsAs(db, { id: T.workerId }, `select public.add_job_note($1, 'Margin looks short', 'Worker')`, [job])
    expect((await activity(T.workerId)).find(r => r.job_id === job)).toBeUndefined()
    expect((await activity(T.ownerId)).find(r => r.job_id === job)).toMatchObject({ notes: 1 })
    const { rows: [{ by }] } = await db.query<{ by: string }>(`select markused->0->>'by' as by from public.jobs where id = $1`, [job])
    expect(by).toBe(T.workerId)
  })

  it('a stage moved by someone else is new; by me it is not', async () => {
    const job = await newJob(T.clinicId)
    await rowsAs(db, { id: T.ownerId }, `update public.jobs set status = 'valmis' where id = $1`, [job])
    const forWorker = (await activity(T.workerId)).find(r => r.job_id === job)
    expect(forWorker?.stages).toBeGreaterThanOrEqual(1)
    expect((await activity(T.ownerId)).find(r => r.job_id === job)).toBeUndefined()
  })

  it('old activity, from before the feature, is seen', async () => {
    const job = await newJob(T.clinicId)
    await addFile(job, T.clinicId, T.ownerId)
    await db.query(`update public.job_file set completed_at = now() - interval '3 hours' where job_id = $1`, [job])
    expect((await activity(T.workerId)).find(r => r.job_id === job)).toBeUndefined()
  })

  it('tells another clinic nothing, and nobody can write job_seen by hand', async () => {
    const job = await newJob(T.clinicId)
    await addFile(job, T.clinicId, T.ownerId)
    expect((await activity(other.ownerId)).find(r => r.job_id === job)).toBeUndefined()
    // Marking another clinic's job does nothing.
    await rowsAs(db, { id: other.ownerId }, `select public.mark_job_seen($1)`, [job])
    const { rows } = await db.query(`select 1 from public.job_seen where job_id = $1 and user_id = $2`, [job, other.ownerId])
    expect(rows).toHaveLength(0)
    expect(await errorAs(db, { id: T.workerId },
      `insert into public.job_seen (user_id, job_id, org_id, seen_at) values ($1, $2, $3, now() + interval '1 year')`,
      [T.workerId, job, T.clinicId])).not.toBeNull()
    expect(await errorAs(db, 'anon', `select public.mark_job_seen($1)`, [job])).not.toBeNull()
  })

  it('a password-only session gets nothing (sql/098)', async () => {
    const job = await newJob(T.clinicId)
    await addFile(job, T.clinicId, T.ownerId)
    const rows = await rowsAs<Activity>(db, { id: T.workerId, mfa: false }, `select * from public.job_activity()`).catch(() => [])
    expect(rows).toEqual([])
  })

  it('a user outside any clinic gets nothing', async () => {
    const lone = await createUser(db, 'Nobody')
    expect(await activity(lone)).toEqual([])
  })
})
