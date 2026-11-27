/**
 * Fake mode (`npm run dev:fake`) and the seed script take only a project of
 * their own: never production, the test copy or a clinic's project.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseTestFakeEnv, PRODUCTION_REF, TEST_COPY_REF, clinicRefs } from './testFakeEnv'
import * as script from '../scripts/fake-project.mjs'

const FAKE = 'abcdefghijklmnopqrst'
const anon = (ref: string, role = 'anon') =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ iss: 'supabase', ref, role })).toString('base64url')}.sig`
const file = (ref: string, key = anon(ref)) => `VITE_SUPABASE_URL=https://${ref}.supabase.co\nVITE_SUPABASE_ANON_KEY=${key}\n`

describe('config/test-fake.env', () => {
  it('takes a project of its own', () => {
    const env = parseTestFakeEnv(file(FAKE))
    expect(env.problems).toEqual([])
    expect(env.ref).toBe(FAKE)
  })

  it('refuses production, the test copy and every clinic\'s project', () => {
    expect(parseTestFakeEnv(file(PRODUCTION_REF)).problems.join()).toMatch(/PRODUCTION/)
    expect(parseTestFakeEnv(file(TEST_COPY_REF)).problems.join()).toMatch(/TEST COPY/)
    const refs = clinicRefs()
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(parseTestFakeEnv(file(ref)).problems.join()).toMatch(/clinic's own project/)
  })

  it('refuses a secret key, a key for another project and an address that is not a project', () => {
    expect(parseTestFakeEnv(file(FAKE, anon(FAKE, 'service_role'))).problems.join()).toMatch(/not the anon key/)
    expect(parseTestFakeEnv(file(FAKE, anon('zzzzzzzzzzzzzzzzzzzz'))).problems.join()).toMatch(/another project/)
    expect(parseTestFakeEnv(`VITE_SUPABASE_URL=https://example.com\nVITE_SUPABASE_ANON_KEY=${anon(FAKE)}`).problems.join()).toMatch(/not a Supabase project/)
    expect(parseTestFakeEnv('').problems.length).toBeGreaterThan(0)
  })

  it('the example file is tracked and holds no key; the real one is ignored', () => {
    const values = readFileSync('config/test-fake.env.example', 'utf8').split(String.fromCharCode(10)).map(l => l.trim()).filter(l => l.trim() && !l.startsWith('#'))
    expect(values).toHaveLength(2)
    for (const line of values) expect(line).not.toMatch(/eyJ|sb_secret_|sb_publishable_[A-Za-z0-9]/)
    expect(readFileSync('.gitignore', 'utf8')).toMatch(/^config\/test-fake\.env$/m)
  })

  it('the three lists of refused ids agree (config, the seed script, the app)', () => {
    const app = readFileSync('src/renderer/src/lib/testCopy.ts', 'utf8')
    expect(app).toContain(`PRODUCTION_REF = '${PRODUCTION_REF}'`)
    expect(app).toContain(`TEST_REF = '${TEST_COPY_REF}'`)
    expect(script.PRODUCTION_REF).toBe(PRODUCTION_REF)
    expect(script.TEST_COPY_REF).toBe(TEST_COPY_REF)
    expect(script.clinicRefs()).toEqual(clinicRefs())
  })
})

describe('scripts/fake-project.mjs (the seed script\'s checks)', () => {
  it('reads the project from a pooler or a direct connection string', () => {
    expect(script.refOfConnection(`postgresql://postgres.${FAKE}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`)).toBe(FAKE)
    expect(script.refOfConnection(`postgresql://postgres:pw@db.${FAKE}.supabase.co:5432/postgres`)).toBe(FAKE)
    expect(script.refOfConnection('postgresql://postgres@localhost:5432/postgres')).toBeNull()
    expect(script.refOfConnection(`postgresql://postgres.${FAKE}@db.zzzzzzzzzzzzzzzzzzzz.supabase.co/postgres`)).toBeNull()
    expect(script.refOfConnection('https://example.com')).toBeNull()
  })

  it('refuses production, the test copy and the clinics', () => {
    expect(script.refusedRef(FAKE)).toBeNull()
    expect(script.refusedRef(PRODUCTION_REF)).toMatch(/PRODUCTION/)
    expect(script.refusedRef(TEST_COPY_REF)).toMatch(/TEST COPY/)
    for (const ref of clinicRefs()) expect(script.refusedRef(ref)).toMatch(/clinic/)
    expect(script.refusedRef('short')).toMatch(/not a Supabase project id/)
  })

  it('moves the password out of the connection into PGPASSWORD', () => {
    const env = script.psqlEnv(`postgresql://postgres.${FAKE}:s3cret@pooler.example:6543/postgres`, '')
    expect(env).toMatchObject({ PGHOST: 'pooler.example', PGPORT: '6543', PGUSER: `postgres.${FAKE}`, PGPASSWORD: 's3cret', PGSSLMODE: 'require' })
    expect(script.psqlEnv(`postgresql://postgres.${FAKE}@pooler.example/postgres`, 'typed').PGPASSWORD).toBe('typed')
  })

  it('the seed script asks for everything hidden and takes nothing from argv or the environment', () => {
    const text = readFileSync('scripts/seed-fake-clinic.mjs', 'utf8')
    expect(text).not.toMatch(/process\.argv/)
    expect(text).not.toMatch(/process\.env\.(?!PSQL_PATH)[A-Z_]+/)
    expect(text).toMatch(/--single-transaction/)
    expect(text).toMatch(/ON_ERROR_STOP=1/)
  })
})
