/**
 * sql/maintenance/schedule-send-invoices.sql, run against the harness's
 * Supabase shim (cron.job, the Vault, net), part by part from the file's own
 * text: the job calls the Vault's address + /send-invoices with the Vault's
 * key, every 15 minutes; running it again changes nothing; it refuses
 * production, a Vault without its address or key, and production's address.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb } from './harness'

const FILE = readFileSync(join(__dirname, '..', 'maintenance', 'schedule-send-invoices.sql'), 'utf8')
const part = (n: 1 | 2): string => n === 1
  ? FILE.slice(FILE.indexOf('-- PART 1 —'), FILE.indexOf('-- PART 2 —'))
  : FILE.slice(FILE.indexOf('-- PART 2 —'))
const TEST = 'jhqyvancrzykxhzwnost'
const PROD = 'wrtucsfmpbwekugzzzxw'

let db: PGlite
const jobs = async () => (await db.query<{ schedule: string; command: string }>(`select schedule, command from cron.job where jobname = 'wivo-send-invoices'`)).rows
const vault = (name: string, value: string | null) => value === null
  ? db.query(`delete from vault.secrets where name = $1`, [name])
  : db.query(`insert into vault.secrets (name, secret) values ($1, $2) on conflict (name) do update set secret = excluded.secret`, [name, value])
const check = async () => Object.fromEntries((await db.query<{ what: string; finding: string }>(part(2))).rows.map(r => [r.what, r.finding]))

beforeAll(async () => {
  db = await freshDb()
  // As the test copy is (and a clinic set up with docs/CLINIC-SETUP.md): sql/052's job gone.
  await db.query(`delete from cron.job where jobname = 'wivo-send-invoices'`)
}, 120_000)

describe('scheduling the invoice sender', () => {
  it('refuses without the Vault’s address, with production’s address, or without the key', async () => {
    await vault('wivo_functions_url', null)
    await expect(db.exec(part(1))).rejects.toThrow(/no wivo_functions_url/)
    await vault('wivo_functions_url', `https://${PROD}.functions.supabase.co`)
    await expect(db.exec(part(1))).rejects.toThrow(/PRODUCTION/)
    await vault('wivo_functions_url', `https://${TEST}.supabase.co/functions/v1`)
    await vault('wivo_service_role_key', null)
    await expect(db.exec(part(1))).rejects.toThrow(/no wivo_service_role_key/)
    expect(await jobs()).toEqual([])
  })

  it('every 15 minutes, to the Vault’s address + /send-invoices with the Vault’s key; again: still one job', async () => {
    await vault('wivo_service_role_key', 'sb_secret_stand_in')
    await db.exec(part(1))
    await db.exec(part(1))
    const rows = await jobs()
    expect(rows).toHaveLength(1)
    expect(rows[0].schedule).toBe('9,24,39,54 * * * *')
    expect(rows[0].command).toContain("where name = 'wivo_functions_url') || '/send-invoices'")
    expect(rows[0].command).toContain("where name = 'wivo_service_role_key'")
    expect(rows[0].command).not.toMatch(/https:\/\//)
  })

  it('the check: all ok once scheduled; a legacy key or production’s address is named', async () => {
    let c = await check()
    expect(c['job wivo-send-invoices']).toBe('ok: 9,24,39,54 * * * *')
    expect(c['its address']).toBe("ok: the Vault's address + /send-invoices")
    expect(c['Vault wivo_functions_url']).toBe(`ok: https://${TEST}.supabase.co/functions/v1`)
    expect(c['Vault wivo_service_role_key']).toBe('ok: an sb_secret key')
    await vault('wivo_service_role_key', 'eyJhbGciOiJIUzI1NiJ9.e30.sig')
    await vault('wivo_functions_url', `https://${PROD}.functions.supabase.co`)
    c = await check()
    expect(c['Vault wivo_service_role_key']).toMatch(/^WRONG: a legacy JWT/)
    expect(c['Vault wivo_functions_url']).toMatch(/^WRONG: PRODUCTION's/)
  })

  it('refuses production (no sql/101)', async () => {
    const d = await freshDb()
    await d.exec('drop function public.lock_anon_functions()')
    await expect(d.exec(part(1))).rejects.toThrow(/production/)
  }, 120_000)
})
