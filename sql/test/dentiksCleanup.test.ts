/**
 * sql/cleanup/dentiks-test-data.sql, run against a database built from every
 * migration: part 1 only counts, part 2 removes the test data of ONE
 * organisation and keeps what the script promises to keep. Another
 * organisation is never touched, and part 2 refuses an org that is not Dentiks.
 *
 * The script names Dentiks's real org_id; the test puts its own tenant's id in
 * its place, nothing else in the script changes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, makeRow, type Tenant } from './harness'

const DENTIKS = '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4'
const script = readFileSync(resolve(__dirname, '../cleanup/dentiks-test-data.sql'), 'utf8')
const at = script.indexOf('-- ── PART 2')
const part1 = script.slice(0, at)
const part2 = script.slice(at)

let db: PGlite
let D: Tenant
let B: Tenant
/** B's rows before part 2: the other organisation must end exactly as it began. */
let bBefore: Record<string, number>

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${sql}`, params)).rows[0].n)

async function seed(t: Tenant) {
  const job = await makeRow(db, 'jobs', t)
  const patient = await makeRow(db, 'patients', t)
  await db.query(`update public.jobs set patient_id = $1 where id = $2`, [patient.id, job.id])
  await makeRow(db, 'customers', t)
  await makeRow(db, 'visits', t)
  const stage = await makeRow(db, 'job_stage', t)
  await db.query(`update public.job_stage set job_id = $1 where id = $2`, [job.id, stage.id])
  const file = await makeRow(db, 'job_file', t)
  await db.query(`update public.job_file set job_id = $1 where id = $2`, [job.id, file.id])
  const note = await makeRow(db, 'notification', t)
  await db.query(`update public.notification set job_id = $1 where id = $2`, [job.id, note.id])
  await db.query(`insert into public.audit_log (org_id, action, object) values ($1, 'view', $2), ($1, 'export', 'csv:jobs')`,
    [t.clinicId, `job:${job.id}`])
  const line = await makeRow(db, 'worker_payout_lines', t)
  await db.query(`update public.worker_payout_lines set job_id = $1 where id = $2`, [job.id, line.id])
  await makeRow(db, 'worker_rates', t)
  const move = await makeRow(db, 'stock_movement', t)
  // A movement is append-only: the one for the job is written with it.
  await db.query(`insert into public.stock_movement (org_id, item_id, kind, delta, job_id)
                  select org_id, item_id, 'use', -1, $1 from public.stock_movement where id = $2`, [job.id, move.id])
  return { job, patient }
}

beforeAll(async () => {
  db = await freshDb()
  D = await createTenant(db, 'Dentiks SIA')
  B = await createTenant(db, 'Another clinic')
  await seed(D)
  await seed(B)
  bBefore = await bCounts()
}, 180_000)

async function bCounts(): Promise<Record<string, number>> {
  const B_ = [B.clinicId]
  return {
    jobs: await count('public.jobs where clinic_id = $1', B_),
    patients: await count('public.patients where clinic_id = $1', B_),
    stages: await count('public.job_stage s join public.jobs j on j.id = s.job_id where j.clinic_id = $1', B_),
    audit: await count('public.audit_log where org_id = $1', B_),
    lines: await count('public.worker_payout_lines where job_id in (select id from public.jobs where clinic_id = $1)', B_),
    stockWithJob: await count('public.stock_movement where org_id = $1 and job_id is not null', B_),
  }
}

const run = (sql: string) => db.exec(sql.split(DENTIKS).join(D.clinicId))

describe('the Dentiks cleanup script', () => {
  it('part 1 only counts: nothing changes', async () => {
    const before = await count('public.jobs')
    const res = await db.query<{ what: string; rows: string }>(part1.split(DENTIKS).join(D.clinicId))
    expect(res.rows.find(r => r.what === 'jobs')?.rows).toBe(String(await count('public.jobs where clinic_id = $1', [D.clinicId])))
    expect(res.rows.find(r => r.what.startsWith('clinic'))?.rows).toBe('Dentiks SIA')
    expect(await count('public.jobs')).toBe(before)
  })

  it('part 2 refuses an organisation that is not Dentiks, changing nothing', async () => {
    const before = await count('public.jobs')
    await expect(db.exec(part2.split(DENTIKS).join(B.clinicId))).rejects.toThrow(/not the Dentiks organisation/)
    await db.exec('rollback').catch(() => undefined)
    expect(await count('public.jobs')).toBe(before)
  })

  it('part 2 removes the test data of Dentiks and keeps what it promises', async () => {
    await run(part2)
    const D_ = [D.clinicId]
    expect(await count('public.jobs where clinic_id = $1', D_)).toBe(0)
    expect(await count('public.patients where clinic_id = $1', D_)).toBe(0)
    expect(await count('public.job_file where org_id = $1', D_)).toBe(0)
    expect(await count('public.customers where clinic_id = $1', D_)).toBe(0)
    expect(await count('public.visits where clinic_id = $1', D_)).toBe(0)
    expect(await count('public.notification where org_id = $1 and job_id is not null', D_)).toBe(0)
    expect(await count('public.worker_payout_lines l join public.worker_payouts p on p.id = l.payout_id where p.profile_id in (select id from public.profiles where clinic_id = $1)', D_)).toBe(0)
    // Kept: the whole audit log (append-only even from the SQL Editor), pay
    // rules, stock movements (job cleared), the org and its people.
    expect(await count(`public.audit_log where org_id = $1 and object like 'job:%'`, D_)).toBeGreaterThan(0)
    expect(await count(`public.audit_log where org_id = $1 and object = 'csv:jobs'`, D_)).toBe(1)
    expect(await count('public.worker_rates where clinic_id = $1', D_)).toBeGreaterThan(0)
    expect(await count('public.stock_movement where org_id = $1 and job_id is null', D_)).toBe(2)
    expect(await count('public.clinics where id = $1', D_)).toBe(1)
    expect(await count('public.profiles where clinic_id = $1', D_)).toBe(2)
  })

  it('another organisation is untouched', async () => {
    expect(bBefore.jobs).toBeGreaterThan(0)
    expect(await bCounts()).toEqual(bBefore)
  })
})
