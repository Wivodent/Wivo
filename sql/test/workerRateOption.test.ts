/**
 * sql/129: a pay rule may name one work type option. Old rules keep none and
 * pay as before; the key is an option id (kebab-case), nothing else; the
 * clinic's rules stay its own.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'

let db: PGlite
let A: Tenant
let B: Tenant

const insertRate = (t: Tenant, optionKey: string | null) =>
  rowsAs<{ id: string; option_key: string | null }>(db, { id: t.ownerId },
    `insert into public.worker_rates (clinic_id, profile_id, kind, amount, option_key)
     values ($1, $2, 'too', 50, $3) returning id, option_key`, [t.clinicId, t.ownerId, optionKey])

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Riga')
  B = await createTenant(db, 'Tallinn')
}, 120_000)

describe('worker_rates.option_key', () => {
  it('a rule that names no option keeps it empty, as every old rule does', async () => {
    const [rate] = await rowsAs<{ option_key: string | null }>(db, { id: A.ownerId },
      `insert into public.worker_rates (clinic_id, profile_id, kind, amount) values ($1, $2, 'hammas', 15)
       returning option_key`, [A.clinicId, A.ownerId])
    expect(rate.option_key).toBeNull()
  })

  it('takes an option id', async () => {
    const [rate] = await insertRate(A, 'metal-bar')
    expect(rate.option_key).toBe('metal-bar')
    expect((await insertRate(A, 'option-1'))[0].option_key).toBe('option-1')
  })

  it('refuses a name or anything that is not an id', async () => {
    for (const bad of ['Metal bar', 'metal_bar', '-bar', 'Металл', 'x'.repeat(81)]) {
      expect(await errorAs(db, { id: A.ownerId },
        `insert into public.worker_rates (clinic_id, profile_id, kind, amount, option_key) values ($1, $2, 'too', 50, $3)`,
        [A.clinicId, A.ownerId, bad]), bad).toMatch(/worker_rates_option_key_format/)
    }
  })

  it('another clinic sees none of these rules', async () => {
    await insertRate(A, 'titanium-mesh')
    expect(await rowsAs(db, { id: B.ownerId },
      `select 1 from public.worker_rates where option_key is not null`)).toEqual([])
  })
})
