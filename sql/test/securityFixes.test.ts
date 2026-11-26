/**
 * sql/135 (docs/SECURITY-REVIEW-2026-11.md D1, D2, R1, S2).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant, type Actor } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

/** A session whose token records an authenticator code `secondsAgo` seconds ago (sql/120). */
const withCode = (id: string, secondsAgo = 10): Actor =>
  ({ id, claims: { amr: [{ method: 'totp', timestamp: Math.floor(Date.now() / 1000) - secondsAgo }] } })

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Lab A')
  B = await createTenant(db, 'Lab B')
}, 120_000)

describe('the anonymous key has no table rights (R1)', () => {
  it('not one right on any table, view or sequence in public', async () => {
    const { rows } = await db.query<{ name: string }>(`
      select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
              or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete')
              or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'usage')))`)
    expect(rows.map(r => r.name)).toEqual([])
  })

  it('a table made after 135 by the owner gets none either', async () => {
    await db.exec(`create table public.later_table (id int primary key); alter table public.later_table enable row level security;`)
    const { rows } = await db.query<{ ok: boolean }>(`select has_table_privilege('anon', 'public.later_table', 'select') as ok`)
    expect(rows[0].ok).toBe(false)
    await db.exec(`drop table public.later_table`)
  })
})

describe('clean-up for every clinic is the database\'s own job (D2)', () => {
  it('a signed-in user cannot run chat_prune, purge_visit_requests or the old password function', async () => {
    for (const sql of ['select public.chat_prune()', 'select public.purge_visit_requests()',
                       `select public.admin_set_worker_password('${A.workerId}', 'abcdefghijk')`]) {
      expect(await errorAs(db, { id: A.ownerId }, sql), sql).toMatch(/permission denied/)
    }
  })
  it('the database owner (the nightly job) still can', async () => {
    await db.query('select public.chat_prune()')
    await db.query('select public.purge_visit_requests()')
  })
})

describe('a worker\'s password, set by the owner (D1)', () => {
  const authorize = (actor: Actor, target: string) =>
    rowsAs<{ r: { ok: boolean; org_id: string; actor_id: string; user_id: string } }>(db, actor, `select public.authorize_password_set($1) as r`, [target])

  it('the owner with a code from the last 5 minutes, for a worker of the clinic: allowed', async () => {
    const [row] = await authorize(withCode(A.ownerId), A.workerId)
    expect(row.r).toMatchObject({ ok: true, org_id: A.clinicId, actor_id: A.ownerId, user_id: A.workerId })
  })

  it('without a fresh code, as a worker, for another clinic\'s worker, or for another owner: refused', async () => {
    expect(await errorAs(db, { id: A.ownerId }, `select public.authorize_password_set($1)`, [A.workerId])).toMatch(/authenticator/)
    expect(await errorAs(db, withCode(A.ownerId, 600), `select public.authorize_password_set($1)`, [A.workerId])).toMatch(/authenticator/)
    expect(await errorAs(db, withCode(A.workerId), `select public.authorize_password_set($1)`, [A.workerId])).toMatch(/Only the owner/)
    expect(await errorAs(db, withCode(A.ownerId), `select public.authorize_password_set($1)`, [B.workerId])).toMatch(/Not a member/)
    const second = (await db.query<{ id: string }>(
      `insert into auth.users (email) values ('second-owner@test.invalid') returning id`)).rows[0].id
    await db.query(`update public.profiles set clinic_id = $1, role = 'owner' where id = $2`, [A.clinicId, second])
    expect(await errorAs(db, withCode(A.ownerId), `select public.authorize_password_set($1)`, [second])).toMatch(/Another owner/)
  })

  it('completing it: an audit entry without the password, and every session of the worker ended', async () => {
    await db.query(`insert into auth.sessions (user_id, aal) values ($1, 'aal2'), ($1, 'aal1')`, [A.workerId])
    // Not for a signed-in user: only the service role (the function) completes it.
    expect(await errorAs(db, withCode(A.ownerId), `select public.complete_password_set($1, $2, $3)`, [A.clinicId, A.ownerId, A.workerId]))
      .toMatch(/permission denied/)
    await db.query(`select public.complete_password_set($1, $2, $3)`, [A.clinicId, A.ownerId, A.workerId])
    const { rows: audit } = await db.query<{ action: string; object: string; detail: Record<string, unknown> }>(
      `select action, object, detail from public.audit_log where action = 'password_set' order by id desc limit 1`)
    expect(audit[0]).toMatchObject({ action: 'password_set', object: `user:${A.workerId}` })
    expect(JSON.stringify(audit[0].detail)).not.toMatch(/password"|abcdefghijk/)
    const { rows: left } = await db.query(`select 1 from auth.sessions where user_id = $1`, [A.workerId])
    expect(left).toEqual([])
  })

  it('another clinic\'s ids are refused even by the service role', async () => {
    await expect(db.query(`select public.complete_password_set($1, $2, $3)`, [A.clinicId, A.ownerId, B.workerId])).rejects.toThrow(/Not a member/)
  })
})

describe('a preview is a small image (S2)', () => {
  async function preview(mime: string, size: number): Promise<string> {
    const job = (await db.query<{ id: string }>(
      `insert into public.jobs (clinic_id, patsient, status) values ($1, 'Test Patient', 'disain') returning id`, [A.clinicId])).rows[0].id
    const path = `${A.clinicId}/${job}/f.stl`
    const file = (await db.query<{ id: string }>(
      `insert into public.job_file (job_id, org_id, type, sha256, size, file_name, storage_path, uploaded_by, preview_path, completed_at)
       values ($1, $2, 'design', repeat('a', 64), 10, 'f.stl', $3, $4, $5, now()) returning id`,
      [job, A.clinicId, path, A.ownerId, `${path}.preview.png`])).rows[0].id
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('job-files', $1, $2)`,
      [`${path}.preview.png`, JSON.stringify({ mimetype: mime, size })])
    return file
  }

  it('a PNG of a few kB is accepted', async () => {
    const f = await preview('image/png', 40_000)
    expect(await errorAs(db, { id: A.ownerId }, `select public.confirm_job_file_preview($1)`, [f])).toBeNull()
  })

  it('HTML, SVG, or an image over 5 MB is refused', async () => {
    for (const [mime, size] of [['text/html', 100], ['image/svg+xml', 100], ['image/png', 6 * 1024 * 1024]] as const) {
      const f = await preview(mime, size)
      expect(await errorAs(db, { id: A.ownerId }, `select public.confirm_job_file_preview($1)`, [f]), mime).toMatch(/PNG, WebP or JPEG/)
    }
  })
})
