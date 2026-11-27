/**
 * sql/154: a Network client's language (Network 006, in its token) reaches the
 * client here, and the e-mails to send say which language to write them in.
 * Only the service key (network-client, send-notifications) runs either.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
const NET_CLINIC = 'aaaaaaaa-0000-4000-8000-000000000154'
const ACCOUNT = 'bbbbbbbb-0000-4000-8000-000000000154'
let clientId: string

async function service<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try { return (await db.query<T>(sql, params)).rows } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
const language = async () => (await db.query<{ language: string | null }>(
  `select language from public.network_client where id = $1`, [clientId])).rows[0].language
const setLanguage = (lang: string | null, clinic = NET_CLINIC) =>
  service(`select public.client_set_language($1, $2, $3)`, [clinic, ACCOUNT, lang])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.network_settings (org_id, network_clinic_id) values ($1, $2)`, [A.clinicId, NET_CLINIC])
  const { rows } = await db.query<{ id: string }>(
    `insert into public.network_client (org_id, account_id, kind, role, display_name, email)
     values ($1, $2, 'person', 'technician', 'Anna Paraugs', 'anna@fake.test') returning id`, [A.clinicId, ACCOUNT])
  clientId = rows[0].id
}, 120_000)

describe('a Network client\'s language (sql/154)', () => {
  it('comes from the token through network-client; an unknown one counts as not known', async () => {
    expect(await language()).toBeNull()
    await setLanguage('lv')
    expect(await language()).toBe('lv')
    await setLanguage('de')
    expect(await language()).toBeNull()
    await setLanguage('ru')
    expect(await language()).toBe('ru')
    // Another clinic's Network number changes nothing here.
    await setLanguage('et', 'aaaaaaaa-0000-4000-8000-000000000999')
    expect(await language()).toBe('ru')
  })

  it('the e-mails to send carry it', async () => {
    await setLanguage('lv')
    await db.query(`insert into public.client_notification (org_id, client_id, kind, ref) values ($1, $2, 'sent', 'TF-DE-281126-001')`, [A.clinicId, clientId])
    const rows = await service<{ email: string; kind: string; ref: string; clinic: string; language: string | null }>(
      `select email, kind, ref, clinic, language from public.pending_client_emails(200) where email = 'anna@fake.test'`)
    expect(rows).toEqual([{ email: 'anna@fake.test', kind: 'sent', ref: 'TF-DE-281126-001', clinic: 'Dentiks', language: 'lv' }])
  })

  it('only the service key runs them', async () => {
    for (const call of [`select public.client_set_language('${NET_CLINIC}', '${ACCOUNT}', 'en')`, `select public.pending_client_emails(1)`]) {
      expect(await errorAs(db, { id: A.ownerId }, call), call).toMatch(/permission denied/)
      expect(await errorAs(db, 'anon', call), call).toMatch(/permission denied/)
    }
  })
})
