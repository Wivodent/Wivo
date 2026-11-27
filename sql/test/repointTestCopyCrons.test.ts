/**
 * sql/maintenance/repoint-test-copy-crons.sql, run against a stand-in of the
 * test copy: pg_cron's job table and Vault replaced by small stand-ins with the
 * same names, holding what the copy from production holds (production's
 * address in wivo-send-invoices, production's address and key in the Vault, a
 * secret that cannot be decrypted here). The script's own text is run, part by
 * part, as Kevin will run it.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant } from './harness'

const FILE = readFileSync(join(__dirname, '..', 'maintenance', 'repoint-test-copy-crons.sql'), 'utf8')
const part = (n: number): string => {
  const start = FILE.indexOf(`-- PART ${n} —`)
  const end = n < 4 ? FILE.indexOf(`-- PART ${n + 1} —`) : FILE.length
  return FILE.slice(start, end)
}
const TEST = 'jhqyvancrzykxhzwnost'
const PROD = 'wrtucsfmpbwekugzzzxw'
/** A key-shaped string whose payload names a project; made here, never a real key. */
const fakeJwt = (ref: string) => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ ref, role: 'service_role' })).toString('base64url'), 'sig'].join('.')

let db: PGlite

/**
 * The harness's Supabase shim (supabaseShim.sql) has cron.job, the Vault and
 * net already, filled by the migrations (sql/052 writes production's address).
 * Added here: cron.alter_job, and a secret that cannot be decrypted (what a
 * Vault copied from another project gives).
 */
const STANDINS = `
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null,
                               username text default null, active boolean default null) returns void language sql as $f$
  update cron.job j set command = coalesce(alter_job.command, j.command), schedule = coalesce(alter_job.schedule, j.schedule) where j.jobid = job_id
$f$;
alter table vault.secrets add column foreign_key boolean not null default false;
create function vault.decrypt(s vault.secrets) returns text language plpgsql as $f$
begin if s.foreign_key then raise exception 'pgsodium: decryption failed'; end if; return s.secret; end $f$;
create or replace view vault.decrypted_secrets as select s.id, s.name, s.description, s.secret, vault.decrypt(s) as decrypted_secret from vault.secrets s;
`

async function setUp(): Promise<void> {
  db = await freshDb()
  await createTenant(db, 'Fullgevity Dental')
  await db.exec(STANDINS)
  // As the copy from production has them: sql/052's job (production's address) is there already;
  // the Vault holds production's address and key, and a secret this project cannot decrypt.
  await db.query(`delete from vault.secrets`)
  await db.query(`insert into vault.secrets (name, secret) values ('wivo_functions_url', $1), ('wivo_service_role_key', $2), ('old_thing', $3)`,
    [`https://${PROD}.functions.supabase.co`, fakeJwt(PROD), fakeJwt(PROD)])
  await db.query(`insert into vault.secrets (name, secret, foreign_key) values ('copied_unreadable', 'x', true)`)
  await db.query(`insert into cron.job (jobname, schedule, command) values ('someone-elses-job', '0 3 * * *', $1)`,
    [`select net.http_post(url := 'https://${PROD}.supabase.co/functions/v1/other');`])
}
const typed = (sql: string, ref: string) => sql.replace("c_typed constant text := '';", `c_typed constant text := '${ref}';`)
const job = async (name: string) => (await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = $1`, [name])).rows[0]

describe('the test copy’s scheduled jobs call the test copy', () => {
  beforeAll(setUp, 120_000)

  it('PART 1 shows every job and what it calls, production’s included', async () => {
    const [jobs, vault] = (await db.exec(part(1))).map(r => r.rows as Record<string, string>[])
    expect(jobs.find(r => r.jobname === 'wivo-send-invoices')).toMatchObject({ calls: 'PRODUCTION', target: `https://${PROD}.functions.supabase.co/send-invoices` })
    expect(jobs.find(r => r.jobname === 'wivo-send-notifications')?.calls).toBe('see 1b')
    expect(jobs.find(r => r.jobname === 'wivo-auto-invoices')?.calls).toBe('—')
    expect(vault).toEqual([{ name: 'wivo_functions_url', address: `https://${PROD}.functions.supabase.co`, calls: 'PRODUCTION' }])
  })

  it('PART 2 changes nothing unless the test copy’s ref was typed', async () => {
    await expect(db.exec(part(2))).rejects.toThrow(/Type the test copy's ref/)
    await expect(db.exec(typed(part(2), PROD))).rejects.toThrow(/Nothing was changed/)
    expect((await job('wivo-send-invoices')).command).toContain(PROD)
  })

  it('PART 2: Wivo jobs call the test copy on the same schedule; the Vault’s address is the test copy’s; production’s key is gone', async () => {
    const results = await db.exec(typed(part(2), TEST))
    const report = results[results.length - 1].rows as { part: string; what: string }[]
    const send = await job('wivo-send-invoices')
    expect(send.schedule).toBe('7 * * * *')
    expect(send.command).toContain(`https://${TEST}.supabase.co/functions/v1/send-invoices`)
    expect(send.command).not.toContain(PROD)
    // In-database jobs and other people's jobs: as they were.
    expect((await job('wivo-auto-invoices')).command).toBe('select public.auto_invoice_run();')
    expect((await job('someone-elses-job')).command).toContain(PROD)
    const vault = (await db.query<{ name: string; secret: string }>(`select name, secret from vault.secrets order by name`)).rows
    expect(vault).toEqual([{ name: 'wivo_functions_url', secret: `https://${TEST}.supabase.co/functions/v1` }])
    expect(report.map(r => r.what).join('\n')).toMatch(/wivo_service_role_key deleted/)
    expect(report.map(r => r.what).join('\n')).toMatch(/copied_unreadable: deleted, it cannot be decrypted here/)
    expect(report.map(r => r.what).join('\n')).toMatch(new RegExp(`old_thing: deleted, a key of project ${PROD}`))
    expect(report.map(r => r.what).join('\n')).not.toMatch(/eyJ/)
  })

  it('PART 4: no Wivo job calls another project; the key is “not set yet” until the Dashboard step; a foreign key is named', async () => {
    const check = async () => (await db.query<{ what: string; finding: string }>(part(4))).rows
    let rows = await check()
    expect(rows.find(r => r.what === 'job wivo-send-invoices')?.finding).toBe('ok: calls the test copy')
    expect(rows.find(r => r.what === 'job wivo-send-notifications')?.finding).toMatch(/^ok: the Vault's address/)
    expect(rows.find(r => r.what === 'Vault wivo_service_role_key')?.finding).toBe('not set yet: PART 3')
    expect(rows.find(r => r.what === 'job someone-elses-job')?.finding).toBe('WRONG: calls another project')
    // PART 3 done (the Dashboard): an sb_secret key, or a key of the test copy, reads ok; production's never.
    await db.query(`insert into vault.secrets (name, secret) values ('wivo_service_role_key', 'sb_secret_stand_in')`)
    rows = await check()
    expect(rows.find(r => r.what === 'Vault wivo_service_role_key')?.finding).toMatch(/^ok: an sb_secret key/)
    await db.query(`update vault.secrets set secret = $1 where name = 'wivo_service_role_key'`, [fakeJwt(PROD)])
    rows = await check()
    expect(rows.find(r => r.what === 'Vault wivo_service_role_key')?.finding).toBe(`WRONG: a key of project ${PROD}`)
  })
})

describe('the file itself', () => {
  it('holds no key, ships with the confirmation empty, and points only at the test copy', () => {
    expect(FILE).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/)
    expect(FILE).not.toMatch(/sb_secret_[A-Za-z0-9]/)
    expect(FILE).toContain("c_typed constant text := '';")
    expect(FILE).toContain(`c_base  constant text := 'https://${TEST}.supabase.co/functions/v1';`)
    // PART 1 and PART 4 only read.
    for (const n of [1, 4]) expect(part(n).replace(/^\s*--.*$/gm, '')).not.toMatch(/\b(insert|update|delete|alter_job|create_secret)\b/i)
  })

  it('refuses production (no sql/101) and a project holding only Dentiks', async () => {
    const d = await freshDb()
    await d.query(`insert into public.clinics (id, name) values ('0641ae3d-5bdb-4e67-b147-6cc45ba59bb4', 'Dentiks')`)
    await d.query(`delete from public.clinics where id <> '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4'`)
    await expect(d.exec(typed(part(2), TEST))).rejects.toThrow(/only Dentiks/)
    await d.exec('drop function public.lock_anon_functions()')
    await expect(d.exec(typed(part(2), TEST))).rejects.toThrow(/production/)
  }, 120_000)
})
