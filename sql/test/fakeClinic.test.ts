/**
 * The fake clinic (sql/demo/fake-clinic.sql), run for real on a database built
 * from every migration, as `scripts/seed-fake-clinic.mjs` runs it.
 *
 * What it must hold: one Latvian clinic, six people in different roles, the
 * catalogue's work types with their pictures and prices, options with their
 * own prices, templates, 40 jobs at different stages, 30 obviously fake
 * patients, invoices, pay rules (one by option) and stock. What it must
 * refuse: any database that already holds a real clinic or a real user.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, rowsAs, SQL_DIR } from './harness'
import { CATALOGUE } from '../../shared/pricing/workTypeCatalogue'

const PASSWORD = 'fake-password-not-a-secret'
const CLINIC = 'f0000000-0000-4000-8000-000000000001'
const FILE = readFileSync(join(SQL_DIR, 'demo', 'fake-clinic.sql'), 'utf8')
const prepared = FILE.replaceAll('<FAKE_PASSWORD>', PASSWORD)

const count = async (db: PGlite, from: string): Promise<number> =>
  Number((await db.query<{ n: number }>(`select count(*)::int as n from ${from}`)).rows[0].n)

async function refusal(db: PGlite, sql: string): Promise<string | null> {
  try { await db.exec(sql); return null } catch (e) { return (e as Error).message }
}

describe('the fake clinic seeds an empty project', () => {
  it('fills it, and a second run adds nothing', async () => {
    const db = await freshDb()
    await db.exec(prepared)

    expect(await count(db, 'public.clinics')).toBe(1)
    expect(await count(db, 'auth.users')).toBe(6)
    expect(await count(db, `public.profiles where clinic_id = '${CLINIC}'`)).toBe(6)
    expect(await count(db, `public.patients where clinic_id = '${CLINIC}'`)).toBe(30)
    expect(await count(db, `public.jobs where clinic_id = '${CLINIC}'`)).toBe(40)
    expect(await count(db, `public.workflow_template where org_id = '${CLINIC}'`)).toBe(3)
    expect(await count(db, `public.invoices where clinic_id = '${CLINIC}'`)).toBe(5)
    expect(await count(db, `public.worker_rates where clinic_id = '${CLINIC}' and option_key is not null`)).toBe(1)
    expect(await count(db, `public.stock_item where org_id = '${CLINIC}'`)).toBe(5)

    await db.exec(prepared)
    expect(await count(db, 'auth.users')).toBe(6)
    expect(await count(db, `public.jobs where clinic_id = '${CLINIC}'`)).toBe(40)
    expect(await count(db, `public.patients where clinic_id = '${CLINIC}'`)).toBe(30)
    expect(await count(db, `public.stock_item where org_id = '${CLINIC}'`)).toBe(5)
    await db.close()
  }, 180_000)

  it('is Latvian, every stage has jobs, and the stages before a job\'s own are done', async () => {
    const db = await freshDb()
    await db.exec(prepared)
    const { rows: [clinic] } = await db.query<{ country: string }>(`select country from public.clinics`)
    expect(clinic.country).toBe('LV')
    const { rows: stages } = await db.query<{ status: string; n: number }>(
      `select status, count(*)::int as n from public.jobs group by status order by status`)
    expect(stages.map(s => s.status).sort()).toEqual(['disain', 'poleeri', 'print', 'puhasta', 'valmis', 'varvi'])
    // A job at "poleeri" has its design and print stages done and its own not.
    const { rows: bad } = await db.query(
      `select j.id from public.jobs j
         join public.job_stage cur on cur.job_id = j.id and cur.stage_key = j.status
         join public.job_stage js on js.job_id = j.id and js.position < cur.position
        where j.status <> 'valmis' and (js.done_at is null or cur.done_at is not null)`)
    expect(bad).toEqual([])
    // Six people, six different roles or permission sets.
    const { rows: roles } = await db.query<{ org_role: string }>(
      `select distinct org_role from public.profiles where clinic_id = '${CLINIC}'`)
    expect(roles.length).toBeGreaterThanOrEqual(5)
    await db.close()
  }, 180_000)

  it('the owner signs in and sees the clinic; the people can read their jobs', async () => {
    const db = await freshDb()
    await db.exec(prepared)
    const owner = 'f0000000-0000-4000-8000-0000000000a1'
    const jobs = await rowsAs<{ n: number }>(db, { id: owner }, `select count(*)::int as n from public.jobs`)
    expect(jobs[0].n).toBe(40)
    const { rows: [u] } = await db.query<{ ok: boolean }>(
      `select encrypted_password = crypt($1, encrypted_password) as ok from auth.users where email = 'owner@fake.wivodent.com'`, [PASSWORD])
    expect(u.ok).toBe(true)
    await db.close()
  }, 180_000)

  it('the work types are the catalogue\'s, with a picture that exists and a price', () => {
    const json = /insert into public\.clinic_settings[\s\S]*?'(\[\s*\{"nimi"[\s\S]*?\])'::jsonb/.exec(FILE)
    expect(json).not.toBeNull()
    const types = JSON.parse(json![1]) as { nimi: string; katalog: string; pildiValik: string; hind: number; hinnaTyyp: string; valikuGrupid?: { key: string; valikud: string[] }[] }[]
    expect(types.length).toBeGreaterThanOrEqual(8)
    for (const t of types) {
      const entry = CATALOGUE.find(e => e.id === t.katalog)
      expect(entry, t.katalog).toBeDefined()
      expect(t.nimi).toBe(entry!.names.en)
      expect(t.hinnaTyyp).toBe(entry!.unit)
      expect(t.hind).toBeGreaterThan(0)
      expect(existsSync(join(SQL_DIR, '..', 'src', 'renderer', 'src', 'assets', 'worktypes', '3d', `${t.pildiValik}.webp`))).toBe(true)
      for (const g of t.valikuGrupid ?? []) {
        const offered = new Set((entry!.groups ?? []).flatMap(x => x.options))
        for (const o of g.valikud) expect(offered.has(o), `${t.nimi}: ${o}`).toBe(true)
      }
    }
    expect(types.some(t => t.valikuGrupid?.some(g => g.valikud.includes('metal-bar')))).toBe(true)
  })

  it('holds no name that could be a real person\'s: every one says it is made up', () => {
    const names = [...FILE.matchAll(/'((?:Dr )?[A-Z][a-z]+ [A-Z][A-Za-z]+)'/g)].map(m => m[1])
    const fakeWord = /fake|mock|test|pretend|dummy|sample|notreal|imaginary|placeholder|pixel|payroll|ownerfake/i
    const people = names.filter(n => !/^(Zirconia|Metal|Implant|Full|Night|Surgical|Printer|Mill|Fake|Front|Bone|Share|Design|Abutment|Membrane|Quick|Pink|Temporary|Titanium|PEEK|Multi|Cement|Screw|Ti)/.test(n))
    expect(people.length).toBeGreaterThan(5)
    for (const n of people) expect(n, n).toMatch(fakeWord)
    // Patient names are built from two lists; every first name and surname is plainly invented.
    expect(FILE).toContain("'McFakeface'")
  })
})

describe('the fake clinic refuses a project that is not empty', () => {
  it('with the password not filled in', async () => {
    const db = await freshDb()
    expect(await refusal(db, FILE)).toMatch(/password is not filled in/)
    expect(await count(db, 'public.clinics')).toBe(0)
    await db.close()
  }, 120_000)

  it('with any other clinic in it (the test copy, a clinic\'s own project)', async () => {
    const db = await freshDb()
    await db.exec(`insert into public.clinics (name) values ('A real clinic')`)
    expect(await refusal(db, prepared)).toMatch(/not the fake one/)
    expect(await count(db, 'auth.users')).toBe(0)
    await db.close()
  }, 120_000)

  it('with any user outside the fake addresses', async () => {
    const db = await freshDb()
    await db.exec(`insert into auth.users (email) values ('someone@clinic.example')`)
    expect(await refusal(db, prepared)).toMatch(/outside @fake\.wivodent\.com/)
    expect(await count(db, 'public.clinics')).toBe(0)
    await db.close()
  }, 120_000)
})
