/**
 * sql/130: who makes a job's chosen option. A doer is a member of the job's
 * clinic; each new doer is told once per save in the bell (never e-mail or
 * push); a job without doers is saved and read exactly as before.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let techA: string
let techB: string

async function member(t: Tenant, name: string): Promise<string> {
  const id = await createUser(db, name)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [t.clinicId, id])
  await grant(db, t, id, ['jobs.read', 'jobs.write'])
  return id
}

const items = (doers?: Record<string, string | null>) => JSON.stringify([{
  id: 'item-1', too: 'All-on-4', hambad: '13,12,11,21,22,23',
  valikud: { framework: ['metal-bar'], extras: ['pink-gingiva'] },
  ...(doers ? { valikuTegijad: doers } : {}),
}])

const insertJob = (work: string) => rowsAs<{ id: string }>(db, { id: A.ownerId },
  `insert into public.jobs (clinic_id, patsient, kuupaev, assigned_to, work_items)
   values ($1, 'X', current_date, $2, $3::jsonb) returning id`, [A.clinicId, techA, work])

const setItems = (job: string, work: string) => errorAs(db, { id: A.ownerId },
  `update public.jobs set work_items = $2::jsonb where id = $1`, [job, work])

const notes = async (user: string, job: string) => (await db.query<{ detail: Record<string, unknown> }>(
  `select detail from public.notification where user_id = $1 and job_id = $2 and kind = 'option_assigned' order by created_at, id`,
  [user, job])).rows.map(r => r.detail)

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
  techA = await member(A, 'Anna')
  techB = await member(A, 'Bruno')
  await db.query(`insert into public.clinic_settings (clinic_id, pricing) values ($1, $2)
                  on conflict (clinic_id) do update set pricing = excluded.pricing`,
    [A.clinicId, JSON.stringify({ tooValikud: [{ id: 'metal-bar', nimi: 'Metal bar' }, { id: 'pink-gingiva', nimi: 'Pink gingiva' }] })])
}, 120_000)

describe('work_items[].valikuTegijad', () => {
  it('a job without doers saves as before and tells nobody', async () => {
    const [job] = await insertJob(items())
    expect(await notes(techA, job.id)).toEqual([])
    expect(await notes(techB, job.id)).toEqual([])
  })

  it('a doer from the clinic is kept and told once, naming the option', async () => {
    const [job] = await insertJob(items({ 'metal-bar': techB }))
    const [row] = (await db.query<{ work_items: { valikuTegijad: Record<string, string> }[] }>(
      `select work_items from public.jobs where id = $1`, [job.id])).rows
    expect(row.work_items[0].valikuTegijad).toEqual({ 'metal-bar': techB })
    expect(await notes(techB, job.id)).toEqual([{ options: ['Metal bar'], new: true }])
    // Saving the same doer again tells nobody again.
    expect(await setItems(job.id, items({ 'metal-bar': techB }))).toBeNull()
    expect(await notes(techB, job.id)).toHaveLength(1)
  })

  it('made the doer of two options at once: one notification naming both', async () => {
    const [job] = await insertJob(items())
    expect(await setItems(job.id, items({ 'metal-bar': techB, 'pink-gingiva': techB }))).toBeNull()
    const [n] = await notes(techB, job.id)
    expect((n.options as string[]).sort()).toEqual(['Metal bar', 'Pink gingiva'])
    expect(n.new).toBe(false)
  })

  it('a person from another clinic, or not a person at all, is refused', async () => {
    const [job] = await insertJob(items())
    expect(await setItems(job.id, items({ 'metal-bar': B.ownerId }))).toMatch(/member of this clinic/)
    expect(await setItems(job.id, items({ 'metal-bar': 'Bruno' }))).toMatch(/member of this clinic/)
    // A JSON null is no doer: the technician.
    expect(await setItems(job.id, items({ 'metal-bar': null }))).toBeNull()
  })

  it('a doer who has left does not stop a later edit of the same job', async () => {
    const leaver = await member(A, 'Leaver')
    const [job] = await insertJob(items({ 'metal-bar': leaver }))
    await db.query(`update public.profiles set clinic_id = null where id = $1`, [leaver])
    expect(await errorAs(db, { id: A.ownerId }, `update public.jobs set patsient = 'Y' where id = $1`, [job.id])).toBeNull()
    expect(await setItems(job.id, items({ 'metal-bar': leaver, 'pink-gingiva': techA }))).toBeNull()
  })

  it('never by e-mail or push', async () => {
    const sources = (await db.query<{ src: string }>(
      `select pg_get_functiondef(p.oid) as src from pg_proc p
        where p.proname in ('pending_notification_emails', 'pending_pushes') and p.pronamespace = 'public'::regnamespace`)).rows
    expect(sources).toHaveLength(2)
    for (const s of sources) expect(s.src).toContain("'option_assigned'")
  })
})
