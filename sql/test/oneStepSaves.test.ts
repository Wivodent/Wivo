/**
 * sql/134: a note added or removed in one UPDATE, a stage's default people in
 * one call, and a job that keeps its template (J5).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, grant, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const notesOf = async (job: string) => (await db.query<{ m: { id: string; tekst: string; autor: string; ts: string }[] }>(
  `select coalesce(markused, '[]'::jsonb) as m from public.jobs where id = $1`, [job])).rows[0].m
const newJob = async (t: Tenant) => (await db.query<{ id: string }>(
  `insert into public.jobs (clinic_id, patsient, status) values ($1, 'Test Patient', 'disain') returning id`, [t.clinicId])).rows[0].id
const add = (actor: { id: string } | 'anon', job: string, text: string, author = 'Anna') =>
  rowsAs<{ n: { id: string; tekst: string; autor: string; ts: string } }>(db, actor, `select public.add_job_note($1, $2, $3) as n`, [job, text, author])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Lab A')
  B = await createTenant(db, 'Lab B')
}, 120_000)

describe('a job\'s notes, one at a time', () => {
  it('two people add a note on the same copy of the job: both stay, each with its own id and time', async () => {
    const job = await newJob(A)
    await grant(db, A, A.workerId, ['jobs.write', 'jobs.read'])
    // Both read the job with no notes; neither sends the list back.
    const [a] = await add({ id: A.ownerId }, job, 'from Anna', 'Anna')
    const [b] = await add({ id: A.workerId }, job, 'from Bert', 'Bert')
    const notes = await notesOf(job)
    expect(notes.map(n => n.tekst)).toEqual(['from Anna', 'from Bert'])
    expect(a.n.id).not.toBe(b.n.id)
    expect(a.n.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
    expect(notes[1].autor).toBe('Bert')
  })

  it('removing one leaves the others in their order; a note already gone is no error', async () => {
    const job = await newJob(A)
    const owner = { id: A.ownerId }
    const [one] = await add(owner, job, 'one')
    await add(owner, job, 'two')
    await add(owner, job, 'three')
    await rowsAs(db, owner, `select public.remove_job_note($1, $2)`, [job, one.n.id])
    expect((await notesOf(job)).map(n => n.tekst)).toEqual(['two', 'three'])
    await rowsAs(db, owner, `select public.remove_job_note($1, $2)`, [job, one.n.id])
    expect((await notesOf(job)).map(n => n.tekst)).toEqual(['two', 'three'])
  })

  it('empty text, someone without Edit jobs, another clinic, a deleted job, or signed out: refused, nothing written', async () => {
    const job = await newJob(A)
    const owner = { id: A.ownerId }
    expect(await errorAs(db, owner, `select public.add_job_note($1, '   ', 'x')`, [job])).toMatch(/needs text/)
    const fresh = await createTenant(db, 'Lab C')
    expect(await errorAs(db, { id: fresh.workerId }, `select public.add_job_note($1, 'x', 'x')`, [job])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId }, `select public.add_job_note($1, 'x', 'x')`, [job])).not.toBeNull()
    expect(await errorAs(db, { id: B.ownerId }, `select public.remove_job_note($1, 'x')`, [job])).not.toBeNull()
    expect(await errorAs(db, 'anon', `select public.add_job_note($1, 'x', 'x')`, [job])).not.toBeNull()
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [job])
    expect(await errorAs(db, owner, `select public.add_job_note($1, 'x', 'x')`, [job])).not.toBeNull()
    expect(await notesOf(job)).toEqual([])
  })
})

describe('a stage\'s default people, in one call', () => {
  const people = async (t: Tenant, key: string) => (await db.query<{ p: string }>(
    `select profile_id::text as p from public.clinic_stage_default where org_id = $1 and stage_key = $2 order by 1`, [t.clinicId, key])).rows.map(r => r.p)

  it('replaced as a whole; none clears them', async () => {
    const owner = { id: A.ownerId }
    await rowsAs(db, owner, `select public.save_stage_default('disain', $1::uuid[])`, [[A.workerId, A.ownerId]])
    expect(await people(A, 'disain')).toEqual([A.workerId, A.ownerId].sort())
    await rowsAs(db, owner, `select public.save_stage_default('disain', $1::uuid[])`, [[A.workerId]])
    expect(await people(A, 'disain')).toEqual([A.workerId])
    await rowsAs(db, owner, `select public.save_stage_default('disain', '{}'::uuid[])`)
    expect(await people(A, 'disain')).toEqual([])
  })

  it('a person of another clinic: refused, and the old people stay (never emptied part way)', async () => {
    const owner = { id: A.ownerId }
    await rowsAs(db, owner, `select public.save_stage_default('print', $1::uuid[])`, [[A.workerId]])
    expect(await errorAs(db, owner, `select public.save_stage_default('print', $1::uuid[])`, [[A.ownerId, B.workerId]])).not.toBeNull()
    expect(await people(A, 'print')).toEqual([A.workerId])
  })

  it('without "Manage stages": refused', async () => {
    const fresh = await createTenant(db, 'Lab D')
    expect(await errorAs(db, { id: fresh.workerId }, `select public.save_stage_default('print', '{}'::uuid[])`)).not.toBeNull()
  })
})

describe('a job keeps its template (J5)', () => {
  it('changed after creation by someone signed in: refused; set at creation and left alone: fine', async () => {
    const [tpl] = (await db.query<{ id: string }>(
      `insert into public.workflow_template (org_id, name) values ($1, 'Other') returning id`, [A.clinicId])).rows
    const job = await newJob(A)
    const owner = { id: A.ownerId }
    expect(await errorAs(db, owner, `update public.jobs set template_id = $2 where id = $1`, [job, tpl.id]))
      .toMatch(/template cannot be changed/)
    // Saving the job with the same template, or anything else, is not refused.
    expect(await errorAs(db, owner, `update public.jobs set template_id = template_id, hind = 10 where id = $1`, [job])).toBeNull()
    // The SQL editor (no signed-in user) is left alone.
    await db.query(`update public.jobs set template_id = $2 where id = $1`, [job, tpl.id])
    expect((await db.query<{ t: string }>(`select template_id::text as t from public.jobs where id = $1`, [job])).rows[0].t).toBe(tpl.id)
  })
})
