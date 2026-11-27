/**
 * sql/131 and 132: every table the app listens to is in the realtime publication.
 *
 * A table missing from `supabase_realtime` is silent: the subscription is
 * made, nothing ever arrives, and another computer's change shows only after
 * a reload (the test copy had no table there at all).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { freshDb } from './harness'

const MIGRATIONS = ['131_realtime_publication.sql', '132_realtime_files_stage_people.sql']
  .map(f => readFileSync(join(__dirname, '..', f), 'utf8'))
const runBoth = async (db: { exec: (sql: string) => Promise<unknown> }) => { for (const m of MIGRATIONS) await db.exec(m) }
const RENDERER = join(__dirname, '..', '..', 'src', 'renderer', 'src')

/** Every table a postgres_changes subscription in the app names (desktop and phone share src/renderer). */
function subscribedTables(dir = RENDERER): Set<string> {
  const out = new Set<string>()
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { subscribedTables(path).forEach(t => out.add(t)); continue }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) continue
    const text = readFileSync(path, 'utf8')
    for (const m of text.matchAll(/postgres_changes['"]\s*,[\s\S]{0,200}?table:\s*['"]([a-z_]+)['"]/g)) out.add(m[1])
    for (const m of text.matchAll(/useRealtimeInvalidate\(\s*['"]([a-z_]+)['"]/g)) out.add(m[1])
  }
  return out
}

const published = async (db: Awaited<ReturnType<typeof freshDb>>): Promise<string[]> =>
  (await db.query<{ t: string }>(
    `select tablename as t from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`,
  )).rows.map(r => r.t)

describe('the realtime publication (sql/131, 132)', () => {
  it('has every table the app subscribes to', async () => {
    const tables = subscribedTables()
    // The search found the subscriptions (a broken pattern would pass with none).
    expect(tables.size).toBeGreaterThanOrEqual(17)
    expect([...tables]).toEqual(expect.arrayContaining(['job_file', 'job_stage_person']))
    const db = await freshDb()
    const have = new Set(await published(db))
    expect([...tables].filter(t => !have.has(t))).toEqual([])
  })

  it('fills a copy that came without them, and a second run changes nothing', async () => {
    const db = await freshDb()
    // job_seen comes with sql/136, which publishes it itself (its own test, jobSeen).
    const all = await published(db)
    expect(all).toContain('job_seen')
    const expected = all.filter(t => t !== 'job_seen')
    // A project copied without its publication's tables, as the test copy was.
    for (const t of all) await db.exec(`alter publication supabase_realtime drop table public.${t}`)
    expect(await published(db)).toEqual([])
    await runBoth(db)
    expect(await published(db)).toEqual(expected)
    await runBoth(db)
    expect(await published(db)).toEqual(expected)
    expect(expected).toEqual([
      'clinic_settings', 'customers', 'invoice_lines', 'invoices', 'job_file', 'job_stage_person', 'jobs', 'messages',
      'notification', 'patient_teeth', 'patients', 'payment_plans', 'payments',
      'visit_requests', 'visits', 'work_hours', 'worker_payouts', 'worker_rates',
    ])
  }, 120_000)

  it('makes the publication itself when a database has none', async () => {
    const db = await freshDb()
    await db.exec(`drop publication supabase_realtime`)
    await runBoth(db)
    expect((await published(db)).length).toBe(18)
  }, 120_000)

  it('132 alone, on a database that has 131: adds only the two', async () => {
    const db = await freshDb()
    await db.exec(`alter publication supabase_realtime drop table public.job_file, public.job_stage_person`)
    await db.exec(MIGRATIONS[1])
    expect(await published(db)).toEqual(expect.arrayContaining(['job_file', 'job_stage_person']))
    expect((await published(db)).length).toBe(19)
  }, 120_000)

  it('leaves replica identity as it is (the primary key): nothing needs the whole old row', async () => {
    const db = await freshDb()
    const { rows } = await db.query<{ t: string; r: string }>(`
      select c.relname as t, c.relreplident as r from pg_class c
        join pg_publication_tables pt on pt.tablename = c.relname and pt.schemaname = 'public'
       where pt.pubname = 'supabase_realtime' and c.relnamespace = 'public'::regnamespace`)
    expect(rows.filter(x => x.r !== 'd')).toEqual([])
  })
})
