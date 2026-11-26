/**
 * sql/030, 113: the owner set a username account's password through
 * admin_set_worker_password, which wrote no audit entry and left the worker's
 * sessions open. From 2.2.5 (sql/135) it is closed to everyone signed in; the
 * password goes through the Edge Function team-account (set_password), which
 * asks authorize_password_set and complete_password_set
 * (sql/test/securityFixes.test.ts, supabase/functions/_shared/teamPassword.test.ts).
 * The 10-character minimum stays: MIN_PASSWORD (teamAccount.test.ts).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Tallinn')
}, 120_000)

describe('the old password function (sql/030) after 135', () => {
  it('is closed to the owner, a worker and anon, and the password is unchanged', async () => {
    const before = (await db.query<{ p: string | null }>(`select encrypted_password as p from auth.users where id = $1`, [A.workerId])).rows[0].p
    for (const actor of [{ id: A.ownerId }, { id: A.workerId }, 'anon' as const]) {
      expect(await errorAs(db, actor, `select public.admin_set_worker_password($1, 'pikk-parool-12')`, [A.workerId]))
        .toMatch(/permission denied/)
    }
    const after = (await db.query<{ p: string | null }>(`select encrypted_password as p from auth.users where id = $1`, [A.workerId])).rows[0].p
    expect(after).toBe(before)
  })
})
