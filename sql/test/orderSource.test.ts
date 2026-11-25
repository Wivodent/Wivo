/**
 * sql/128: who ordered a job. The source is one of three answers or not
 * said; the ordering doctor is a member of the job's own clinic; a customer is
 * a clinic or a person; old jobs and customers read exactly as before.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const insertJob = (t: Tenant, extra: string, values: string) =>
  rowsAs<{ id: string; order_source: string | null; order_doctor: string | null }>(db, { id: t.ownerId },
    `insert into public.jobs (clinic_id, patsient, kuupaev${extra}) values ($1, 'X', current_date${values})
     returning id, order_source, order_doctor::text`, [t.clinicId])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
}, 120_000)

describe('jobs.order_source', () => {
  it('a job that does not say keeps it empty, as every old job does', async () => {
    const [job] = await insertJob(A, '', '')
    expect(job.order_source).toBeNull()
    expect(job.order_doctor).toBeNull()
  })

  it('takes own, clinic or person; nothing else', async () => {
    for (const source of ['own', 'clinic', 'person']) {
      const [job] = await insertJob(A, ', order_source', `, '${source}'`)
      expect(job.order_source).toBe(source)
    }
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, kuupaev, order_source) values ($1, 'X', current_date, 'partner')`,
      [A.clinicId])).toMatch(/jobs_order_source_valid/)
  })
})

describe('jobs.order_doctor', () => {
  it('our own doctor: yes', async () => {
    const [job] = await insertJob(A, ', order_source, order_doctor', `, 'own', '${A.ownerId}'`)
    expect(job.order_doctor).toBe(A.ownerId)
  })

  it("another clinic's person: refused, on insert and on update", async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.jobs (clinic_id, patsient, kuupaev, order_doctor) values ($1, 'X', current_date, $2)`,
      [A.clinicId, B.ownerId])).toMatch(/member of this clinic/)
    const [job] = await insertJob(A, '', '')
    expect(await errorAs(db, { id: A.ownerId },
      `update public.jobs set order_doctor = $2 where id = $1`, [job.id, B.ownerId])).toMatch(/member of this clinic/)
  })

  it('every job edit records it, by name (audit rule: member)', async () => {
    const rules = (await db.query<{ col: string; rule: string }>(
      `select col, rule from public.audit_field_rules() where tbl = 'jobs' and col in ('order_source', 'order_doctor') order by col`)).rows
    expect(rules).toEqual([{ col: 'order_doctor', rule: 'member' }, { col: 'order_source', rule: 'value' }])
  })
})

describe('customers.kind', () => {
  it('a customer is a clinic unless it says it is a person', async () => {
    const [clinic] = await rowsAs<{ kind: string }>(db, { id: A.ownerId },
      `insert into public.customers (clinic_id, name) values ($1, 'Dentiks partner') returning kind`, [A.clinicId])
    expect(clinic.kind).toBe('clinic')
    const [person] = await rowsAs<{ kind: string }>(db, { id: A.ownerId },
      `insert into public.customers (clinic_id, name, kind) values ($1, 'Dr Bērziņš', 'person') returning kind`, [A.clinicId])
    expect(person.kind).toBe('person')
  })

  it('nothing else', async () => {
    expect(await errorAs(db, { id: A.ownerId },
      `insert into public.customers (clinic_id, name, kind) values ($1, 'X', 'lab')`, [A.clinicId])).toMatch(/customers_kind_valid/)
  })
})
