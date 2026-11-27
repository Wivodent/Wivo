/**
 * sql/139: the board reads the stages switched off on its jobs in one call
 * (job_skipped_stages), and hears a change through realtime (job_stage in the
 * publication). Row security decides: another clinic's job, or a job one may
 * not read, gives nothing; anon runs nothing.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, createUser, rowsAs, errorAs, grant, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant
let jobA1: string
let jobA2: string
let jobB: string
let tech: string

const STAGES = ['skaneering', 'disain', 'freesimine', 'viimistlus', 'valmis']

async function setUp(t: Tenant): Promise<string> {
  await db.query(`insert into public.clinic_settings (clinic_id, pipeline_stages) values ($1, $2)
                  on conflict (clinic_id) do update set pipeline_stages = excluded.pipeline_stages`,
    [t.clinicId, JSON.stringify(STAGES.map(key => ({ key })))])
  const template = (await db.query<{ id: string }>(
    `insert into public.workflow_template (org_id, name) values ($1, 'Crown') returning id`, [t.clinicId])).rows[0].id
  for (const [i, key] of STAGES.entries()) {
    await db.query(`insert into public.workflow_template_stage (org_id, template_id, stage_key, position) values ($1, $2, $3, $4)`,
      [t.clinicId, template, key, i])
  }
  return template
}

async function createJob(actor: Actor, template: string): Promise<string> {
  return (await rowsAs<{ id: string }>(db, actor,
    `select * from public.create_job($1::jsonb, '{}'::jsonb)`, [JSON.stringify({ patsient: 'P', template_id: template })]))[0].id
}

const skip = async (actor: Actor, job: string, stage: string) =>
  expect(await errorAs(db, actor, `select public.set_job_stage_skipped($1, $2, true)`, [job, stage])).toBeNull()

const skippedAs = (actor: Actor, jobs: string[]) =>
  rowsAs<{ job_id: string; stage_key: string }>(db, actor, `select * from public.job_skipped_stages($1::uuid[])`, [jobs])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Clinic A')
  B = await createTenant(db, 'Clinic B')
  const tA = await setUp(A)
  const tB = await setUp(B)
  jobA1 = await createJob({ id: A.ownerId }, tA)
  jobA2 = await createJob({ id: A.ownerId }, tA)
  jobB = await createJob({ id: B.ownerId }, tB)
  await skip({ id: A.ownerId }, jobA1, 'freesimine')
  await skip({ id: A.ownerId }, jobA1, 'disain')
  await skip({ id: A.ownerId }, jobA2, 'viimistlus')
  await skip({ id: B.ownerId }, jobB, 'disain')
  // A technician sees only the jobs they are on (sql/123): none here.
  tech = await createUser(db, 'Janis')
  await db.query(`update public.profiles set clinic_id = $1, role = 'worker' where id = $2`, [A.clinicId, tech])
  await grant(db, A, tech, ['jobs.write'])
}, 120_000)

describe('job_skipped_stages (sql/139)', () => {
  it('the switched-off stages of the jobs asked for, in their order, in one call', async () => {
    expect(await skippedAs({ id: A.ownerId }, [jobA1, jobA2])).toEqual([
      ...[{ job_id: jobA1, stage_key: 'disain' }, { job_id: jobA1, stage_key: 'freesimine' }],
      { job_id: jobA2, stage_key: 'viimistlus' },
    ].sort((a, b) => (a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0)))
    expect(await skippedAs({ id: A.ownerId }, [jobA2])).toEqual([{ job_id: jobA2, stage_key: 'viimistlus' }])
  })

  it('a stage switched back on is no longer listed', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.set_job_stage_skipped($1, 'viimistlus', false)`, [jobA2])).toBeNull()
    expect(await skippedAs({ id: A.ownerId }, [jobA2])).toEqual([])
    await skip({ id: A.ownerId }, jobA2, 'viimistlus')
  })

  it('leak: another clinic\'s job gives nothing, asked for by id', async () => {
    expect(await skippedAs({ id: A.ownerId }, [jobB])).toEqual([])
    expect((await skippedAs({ id: B.ownerId }, [jobA1, jobA2, jobB])).map(r => r.job_id)).toEqual([jobB])
  })

  it('a job I may not read gives nothing', async () => {
    expect(await skippedAs({ id: tech }, [jobA1, jobA2])).toEqual([])
  })

  it('nothing asked, nothing given; anon may not run it', async () => {
    expect(await skippedAs({ id: A.ownerId }, [])).toEqual([])
    expect(await errorAs(db, 'anon',
      `select * from public.job_skipped_stages($1::uuid[])`, [[jobA1]])).toMatch(/permission denied|not allowed|second factor/i)
  })

  it('job_stage is in the realtime publication', async () => {
    const r = await db.query(`select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'job_stage'`)
    expect(r.rows).toHaveLength(1)
  })
})
