/**
 * The Wivo Network project (network/sql), on an empty Supabase-shaped
 * database (the same shim the clinic tests use), and its network-token
 * function's logic.
 *
 * An account sees only itself and its own connections; the directory shows
 * only listed clinics (an unlisted one only by its invite code); nothing at
 * all without the second factor; an ended connection gets no token.
 */
import { describe, expect, it, beforeAll, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { emptyDb, rowsAs, errorAs } from '../../sql/test/harness'
import { handleNetworkToken } from '../functions/_shared/networkToken'
import { handleNetworkClinic, type EntryRow } from '../functions/_shared/networkClinic'
import { importPublicKey, importSigningKey, makeNetworkKeyPair, verifyNetworkToken } from '../../shared/network/token'
import { CLINIC_REQUEST_AUDIENCE, clinicNonce, importClinicSigningKey, makeClinicKeyPair, signClinicRequest } from '../../shared/network/clinicRequest'

const SQL = join(__dirname, '..', 'sql')
let db: PGlite
let alice: string
let bob: string
let listed: string
let unlisted: string

async function user(email: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email])
  return rows[0].id
}
const profile = (id: string, name: string) => rowsAs(db, { id },
  `insert into public.account (id, kind, role, display_name, country) values ($1, 'person', 'technician', $2, 'LV') returning id`, [id, name])

beforeAll(async () => {
  db = await emptyDb()
  for (const f of readdirSync(SQL).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort()) await db.exec(readFileSync(join(SQL, f), 'utf8'))
  alice = await user('alice@fake.test')
  bob = await user('bob@fake.test')
  const { rows } = await db.query<{ id: string; listed: boolean }>(
    `insert into public.clinic (name, country, api_url, listed) values
       ('Fakeville Lab', 'LV', 'https://abcdefghijklmnopqrst.supabase.co', true),
       ('Hidden Lab', 'EE', 'https://bcdefghijklmnopqrstu.supabase.co', false)
     returning id, listed`)
  listed = rows.find(r => r.listed)!.id
  unlisted = rows.find(r => !r.listed)!.id
  await profile(alice, 'Alice Fake')
  await profile(bob, 'Bob Mock')
}, 120_000)

describe('the Network project (network/sql)', () => {
  it('runs twice without complaint', async () => {
    for (const f of readdirSync(SQL).filter(n => /^\d{3}_.*\.sql$/.test(n)).sort()) await db.exec(readFileSync(join(SQL, f), 'utf8'))
  })

  it('an account sees only itself', async () => {
    const seen = await rowsAs<{ display_name: string }>(db, { id: alice }, `select display_name from public.account`)
    expect(seen.map(r => r.display_name)).toEqual(['Alice Fake'])
    expect(await rowsAs(db, { id: alice }, `update public.account set display_name = 'x' where id = $1 returning 1`, [bob])).toEqual([])
  })

  it('the directory: listed clinics; an unlisted one only by its invite code', async () => {
    const dir = await rowsAs<{ id: string }>(db, { id: alice }, `select id from public.clinic`)
    expect(dir.map(r => r.id)).toEqual([listed])
    const { rows: [{ invite_code }] } = await db.query<{ invite_code: string }>(`select invite_code from public.clinic where id = $1`, [unlisted])
    const byCode = await rowsAs<{ id: string }>(db, { id: alice }, `select id from public.clinic_by_invite($1)`, [invite_code])
    expect(byCode.map(r => r.id)).toEqual([unlisted])
    expect(await rowsAs(db, { id: alice }, `select id from public.clinic_by_invite('nope')`)).toEqual([])
    // The invite code itself is never readable.
    expect(await errorAs(db, { id: alice }, `select invite_code from public.clinic`)).toMatch(/permission denied/)
  })

  it('connections: own only, written only through the functions', async () => {
    const [c] = await rowsAs<{ id: string; state: string }>(db, { id: alice }, `select id, state from public.request_connection($1)`, [listed])
    expect(c.state).toBe('requested')
    expect(await rowsAs(db, { id: bob }, `select 1 from public.connection where id = $1`, [c.id])).toEqual([])
    expect(await errorAs(db, { id: alice }, `update public.connection set state = 'confirmed' where id = $1`, [c.id])).not.toBeNull()
    expect(await errorAs(db, { id: bob }, `select public.report_connection_state($1, 'confirmed')`, [c.id])).toMatch(/No such connection/)
    const [r] = await rowsAs<{ state: string }>(db, { id: alice }, `select state from public.report_connection_state($1, 'confirmed')`, [c.id])
    expect(r.state).toBe('confirmed')
  })

  it('a token: only for a live connection; none once ended; none without the second factor', async () => {
    const claims = (id: string, clinic: string, mfa = true) =>
      rowsAs<{ account_id: string }>(db, { id, mfa }, `select * from public.token_claims($1)`, [clinic]).catch(() => [])
    expect(await claims(alice, listed)).toHaveLength(1)
    // Network 003: the sign-in address and the e-mail choice, for the clinic's e-mails about orders.
    const [c] = await rowsAs<{ email: string; email_notifications: boolean }>(db, { id: alice }, `select email, email_notifications from public.token_contact($1)`, [listed])
    expect(c).toEqual({ email: 'alice@fake.test', email_notifications: true })
    await rowsAs(db, { id: alice }, `update public.account set email_notifications = false where id = $1`, [alice])
    expect((await rowsAs<{ email_notifications: boolean }>(db, { id: alice }, `select email_notifications from public.token_contact($1)`, [listed]))[0].email_notifications).toBe(false)
    expect(await rowsAs(db, { id: bob }, `select * from public.token_contact($1)`, [listed])).toEqual([])
    await rowsAs(db, { id: alice }, `update public.account set email_notifications = true where id = $1`, [alice])
    expect(await claims(alice, listed, false)).toEqual([])
    expect(await claims(bob, listed)).toEqual([])
    const [{ id }] = await rowsAs<{ id: string }>(db, { id: alice }, `select id from public.connection where clinic_id = $1`, [listed])
    await rowsAs(db, { id: alice }, `select public.end_connection($1)`, [id])
    expect(await claims(alice, listed)).toEqual([])
    // Asking again after it ended is a new request.
    const [again] = await rowsAs<{ state: string }>(db, { id: alice }, `select state from public.request_connection($1)`, [listed])
    expect(again.state).toBe('requested')
  })

  it('nothing without the second factor, nothing for anon', async () => {
    expect(await rowsAs(db, { id: alice, mfa: false }, `select 1 from public.account`).catch(() => [])).toEqual([])
    expect(await errorAs(db, { id: alice, mfa: false }, `select public.request_connection($1)`, [listed])).toMatch(/Second factor/)
    expect(await errorAs(db, 'anon', `select public.request_connection($1)`, [listed])).toMatch(/permission denied/)
    expect(await rowsAs(db, 'anon', `select 1 from public.clinic`).catch(() => [])).toEqual([])
  })

  it('holds no order, file, message, price or patient: three tables, connection metadata only', async () => {
    const { rows } = await db.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`)
    expect(rows.map(r => r.t)).toEqual(['account', 'clinic', 'connection'])
    const { rows: cols } = await db.query<{ c: string }>(`select column_name as c from information_schema.columns where table_schema = 'public'`)
    for (const c of cols.map(r => r.c)) expect(c).not.toMatch(/patient|order|price|file|message|note/i)
  })
})

describe('network-token (the function\'s logic)', () => {
  it('signs for the clinic the database named, for five minutes; refuses when the database says no', async () => {
    const pair = await makeNetworkKeyPair()
    const key = await importSigningKey(pair.privateKey)
    const row = { account_id: alice, connection_id: 'dddddddd-0000-4000-8000-000000000004', name: 'Alice Fake', kind: 'person' as const,
      role: 'technician' as const, company: null, country: 'LV', clinic_id: listed, api_url: 'https://abcdefghijklmnopqrst.supabase.co' }
    const ok = await handleNetworkToken({ clinicId: listed }, { key, nowSeconds: () => 1_800_000_000, claims: async () => row })
    expect(ok.status).toBe(200)
    const v = await verifyNetworkToken(ok.body.token as string, await importPublicKey(pair.publicKey), listed, 1_800_000_000)
    expect(v.ok).toBe(true)
    expect(ok.body.expiresIn).toBe(300)
    const no = await handleNetworkToken({ clinicId: listed }, { key, nowSeconds: () => 1, claims: async () => null })
    expect(no).toEqual({ status: 403, body: { error: 'not allowed' } })
    expect((await handleNetworkToken({ clinicId: 'x' }, { key, nowSeconds: () => 1, claims: async () => row })).status).toBe(400)
  })
})

/** As the Network's Edge Function: the service key. */
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try { return await fn() } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

describe('a clinic changes its own directory entry (network/sql/002)', () => {
  it('the key and the last change are never readable by an account; the functions are for the service key only', async () => {
    expect(await errorAs(db, { id: alice }, `select clinic_public_key from public.clinic`)).toMatch(/permission denied/)
    expect(await errorAs(db, { id: alice }, `select last_request_ms from public.clinic`)).toMatch(/permission denied/)
    for (const call of [`select public.clinic_request_key($1)`, `select * from public.clinic_own_entry($1)`, `select * from public.clinic_set_listed($1, true, 1)`]) {
      expect(await errorAs(db, { id: alice }, call, [listed])).toMatch(/permission denied/)
      expect(await errorAs(db, 'anon', call, [listed])).toMatch(/permission denied/)
    }
  })

  it('a change needs a later time than the last one taken: a replay does nothing', async () => {
    const set = (on: boolean, at: number) => asService(() => db.query<{ listed: boolean }>(`select * from public.clinic_set_listed($1, $2, $3)`, [unlisted, on, at]))
    expect((await set(true, 1_000)).rows[0].listed).toBe(true)
    expect((await set(false, 2_000)).rows[0].listed).toBe(false)
    await expect(set(true, 1_000)).rejects.toThrow(/older request/)
    await expect(set(true, 2_000)).rejects.toThrow(/older request/)
    const { rows } = await asService(() => db.query<{ listed: boolean; invite_code: string }>(`select * from public.clinic_own_entry($1)`, [unlisted]))
    expect(rows[0].listed).toBe(false)
    expect(rows[0].invite_code).toMatch(/^[a-z0-9]{12,40}$/)
    await expect(asService(() => db.query(`select * from public.clinic_set_listed('eeeeeeee-0000-4000-8000-000000000005', true, 9999)`))).rejects.toThrow(/No such clinic/)
  })

  it('a key that is not one is refused', async () => {
    await expect(db.query(`update public.clinic set clinic_public_key = 'short' where id = $1`, [listed])).rejects.toThrow(/clinic_public_key_valid/)
  })
})

describe('network-clinic (the function\'s logic)', () => {
  const NOW = 1_800_000_000_000
  const row: EntryRow = { listed: false, invite_code: 'abcdef123456789012', name: 'Fakeville Lab', city: null, country: 'LV' }

  async function setup() {
    const pair = await makeClinicKeyPair()
    const sign = await importClinicSigningKey(pair.privateKey)
    const setListed = vi.fn(async (_c: string, on: boolean, _at: number): Promise<EntryRow | 'older' | null> => ({ ...row, listed: on }))
    const deps = { publicKey: async (c: string) => (c === listed ? pair.publicKey : null), entry: async () => row, setListed, nowMs: () => NOW }
    const req = (over: Record<string, unknown> = {}) => signClinicRequest({
      v: 1, aud: CLINIC_REQUEST_AUDIENCE, clinic: listed, op: 'set_listed', listed: true, iat: NOW, nonce: clinicNonce(), ...over,
    } as Parameters<typeof signClinicRequest>[0], sign)
    return { deps, setListed, req }
  }

  it('a request signed by the clinic\'s own key changes its entry, with the request\'s time', async () => {
    const { deps, setListed, req } = await setup()
    expect(await handleNetworkClinic({ request: await req() }, deps)).toEqual({
      status: 200, body: { listed: true, inviteCode: row.invite_code, name: row.name, city: null, country: 'LV' } })
    expect(setListed).toHaveBeenCalledWith(listed, true, NOW)
    expect((await handleNetworkClinic({ request: await req({ op: 'get', listed: undefined }) }, deps)).body.listed).toBe(false)
  })

  it('another key, an unknown clinic, an old request: refused, and nothing changes', async () => {
    const { deps, setListed, req } = await setup()
    const other = await setup()
    expect(await handleNetworkClinic({ request: await other.req() }, deps)).toEqual({ status: 403, body: { error: 'not_allowed' } })
    expect(await handleNetworkClinic({ request: await req({ clinic: unlisted }) }, deps)).toEqual({ status: 403, body: { error: 'not_allowed' } })
    expect(await handleNetworkClinic({ request: await req({ iat: NOW - 120_000 }) }, deps)).toEqual({ status: 401, body: { error: 'clock' } })
    expect((await handleNetworkClinic({ request: 'nope' }, deps)).status).toBe(400)
    expect((await handleNetworkClinic(null, deps)).status).toBe(400)
    expect(setListed).not.toHaveBeenCalled()
  })

  it('a replay the database refused is said so', async () => {
    const { deps, req } = await setup()
    deps.setListed = vi.fn(async () => 'older' as const)
    expect(await handleNetworkClinic({ request: await req() }, deps)).toEqual({ status: 409, body: { error: 'older_request' } })
  })
})
