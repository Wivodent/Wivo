/**
 * sql/126: one "you were put on job X's stages A, B, C" per person, not one
 * notification per stage, both for a new job and when the stages' people are
 * set one stage at a time (as the app does).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant
let doctor: string
let tech1: string
let tech2: string
let template: string

const STAGES = ['skaneering', 'disain', 'freesimine', 'viimistlus', 'valmis']

async function member(name: string, perms: string[]): Promise<string> {
  const id = await createUser(db, name)
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, id])
  await grant(db, A, id, perms)
  return id
}

async function createJob(actor: Actor): Promise<string> {
  return (await rowsAs<{ id: string }>(db, actor,
    `select * from public.create_job($1::jsonb, '{}'::jsonb)`, [JSON.stringify({ patsient: 'P', template_id: template })]))[0].id
}

const notes = async (user: string, job: string) => (await db.query<{ detail: Record<string, unknown> }>(
  `select detail from public.notification where user_id = $1 and job_id = $2 and kind = 'stage_assigned' order by created_at, id`,
  [user, job])).rows.map(r => r.detail)

const setPeople = (job: string, stage: string, people: string[]) =>
  errorAs(db, { id: doctor }, `select public.set_job_stage_people($1, $2, $3)`, [job, stage, people])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Clinic')
  doctor = await member('Dr Ozola', ['jobs.read', 'jobs.write'])
  tech1 = await member('Janis', ['jobs.write'])
  tech2 = await member('Liga', ['jobs.write'])
  await db.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                  on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
    [A.clinicId, JSON.stringify(STAGES.map(key => ({ key })))])
  template = (await db.query<{ id: string }>(
    `insert into public.workflow_template (org_id, name) values ($1, 'Crown') returning id`, [A.clinicId])).rows[0].id
  for (const [i, key] of STAGES.entries()) {
    const id = (await db.query<{ id: string }>(
      `insert into public.workflow_template_stage (org_id, template_id, stage_key, position) values ($1, $2, $3, $4) returning id`,
      [A.clinicId, template, key, i])).rows[0].id
    // Janis is on design, milling and finishing; Liga on nothing.
    if (key === 'disain' || key === 'freesimine' || key === 'viimistlus') {
      await db.query(`insert into public.workflow_template_stage_person (template_stage_id, profile_id, org_id) values ($1, $2, $3)`,
        [id, tech1, A.clinicId])
    }
  }
}, 120_000)

beforeEach(async () => { await db.query(`delete from public.notification`) })

describe('one notification for several stages', () => {
  it('a new job: one notification naming every stage the person is on, in the job\'s order', async () => {
    const j = await createJob({ id: doctor })
    expect(await notes(tech1, j)).toEqual([{ stage: 'disain', new: true, stages: ['disain', 'freesimine', 'viimistlus'] }])
  })

  it('put on three stages one call at a time: one notification with all three, in the job\'s order', async () => {
    const j = await createJob({ id: doctor })
    expect(await setPeople(j, 'viimistlus', [tech1, tech2])).toBeNull()
    expect(await setPeople(j, 'disain', [tech1, tech2])).toBeNull()
    expect(await setPeople(j, 'freesimine', [tech1, tech2])).toBeNull()
    expect(await notes(tech2, j)).toEqual([{ stage: 'disain', new: false, stages: ['disain', 'freesimine', 'viimistlus'] }])
    // Janis was already on them: told once, by the new job, and nothing more.
    expect(await notes(tech1, j)).toHaveLength(1)
  })

  it('one stage only: the notification looks as before (stage and new, no list)', async () => {
    const j = await createJob({ id: doctor })
    expect(await setPeople(j, 'disain', [tech1, tech2])).toBeNull()
    expect(await notes(tech2, j)).toEqual([{ stage: 'disain', new: false }])
  })

  it('a notification already read, or older than two minutes, is left alone: a new one is made', async () => {
    const j = await createJob({ id: doctor })
    expect(await setPeople(j, 'disain', [tech1, tech2])).toBeNull()
    await db.query(`update public.notification set read_at = now() where user_id = $1`, [tech2])
    expect(await setPeople(j, 'freesimine', [tech1, tech2])).toBeNull()
    // Older than two minutes; the first older still, so the order stays known.
    await db.query(`update public.notification set created_at = now() - interval '5 minutes'
                     - case when detail ->> 'stage' = 'disain' then interval '5 minutes' else interval '0' end
                    where user_id = $1`, [tech2])
    expect(await setPeople(j, 'viimistlus', [tech1, tech2])).toBeNull()
    expect(await notes(tech2, j)).toEqual([
      { stage: 'disain', new: false }, { stage: 'freesimine', new: false }, { stage: 'viimistlus', new: false },
    ])
  })

  it('another job is another notification', async () => {
    const j1 = await createJob({ id: doctor })
    const j2 = await createJob({ id: doctor })
    expect(await setPeople(j1, 'disain', [tech1, tech2])).toBeNull()
    expect(await setPeople(j2, 'disain', [tech1, tech2])).toBeNull()
    expect(await notes(tech2, j1)).toEqual([{ stage: 'disain', new: false }])
    expect(await notes(tech2, j2)).toEqual([{ stage: 'disain', new: false }])
  })

  it('nobody is told what they did themselves, and it stays out of e-mail and push', async () => {
    const j = await createJob({ id: doctor })
    expect(await setPeople(j, 'disain', [doctor, tech1])).toBeNull()
    expect(await notes(doctor, j)).toEqual([])
    expect((await db.query(`select * from public.pending_pushes() where kind = 'stage_assigned'`)).rows).toEqual([])
    expect((await db.query(`select * from public.pending_notification_emails() where kind = 'stage_assigned'`)).rows).toEqual([])
  })

  it('nobody can call it from the app', async () => {
    expect(await errorAs(db, { id: doctor }, `select public.notify_stage_assigned($1, $2, $3, 'disain', false)`,
      [A.clinicId, '00000000-0000-0000-0000-000000000000', tech2])).toMatch(/permission denied/)
  })
})
