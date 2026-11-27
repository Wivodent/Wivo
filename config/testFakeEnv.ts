/**
 * `npm run dev:fake`: test mode against a project of FAKE data
 * (docs/TEST-PROJECT.md), from config/test-fake.env.
 *
 * The same rules as config/test-copy.env (testCopyEnv.ts: the URL and the
 * public anon key, nothing else, never a secret), and on top of them the
 * project must be one that may hold fake data: never production, never the
 * test copy (real data), never a clinic's own project (clinics/*.json). The
 * file is NOT tracked: each person's fake project is their own.
 *
 * In the app (lib/testCopy) the project's id becomes the one address test
 * mode lets through; production and the test copy stay refused by their ids.
 */
import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { jwtPayload, parseTestCopyEnv } from './testCopyEnv'

export const TEST_FAKE_ENV = 'config/test-fake.env'

/** Kept in step with src/renderer/src/lib/testCopy.ts and scripts/fake-project.mjs (tests check both). */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'
export const TEST_COPY_REF = 'jhqyvancrzykxhzwnost'

/** Every clinic's own project id, from clinics/*.json. */
export function clinicRefs(root = process.cwd()): string[] {
  const dir = join(root, 'clinics')
  const out: string[] = []
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const ref = (JSON.parse(readFileSync(join(dir, name), 'utf8')) as { supabaseRef?: unknown }).supabaseRef
      if (typeof ref === 'string' && ref) out.push(ref)
    } catch { /* not a clinic file */ }
  }
  return out
}

/** The ref of https://<ref>.supabase.co, or null. */
export function refOfProjectUrl(u: string): string | null {
  try {
    const url = new URL(u)
    if (url.protocol !== 'https:' || url.pathname.replace(/\/$/, '') !== '' || url.search || url.hash) return null
    return /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname)?.[1] ?? null
  } catch { return null }
}

export interface TestFakeEnv {
  url: string
  key: string
  ref: string
  problems: string[]
}

export function parseTestFakeEnv(text: string, root = process.cwd()): TestFakeEnv {
  const env = parseTestCopyEnv(text)
  const problems = [...env.problems]
  const ref = refOfProjectUrl(env.url.trim())
  if (!env.url.trim() || !env.key.trim()) problems.push('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are both needed')
  else if (!ref) problems.push('VITE_SUPABASE_URL is not a Supabase project address (https://<id>.supabase.co)')
  else if (ref === PRODUCTION_REF) problems.push('it points at PRODUCTION')
  else if (ref === TEST_COPY_REF) problems.push('it points at the TEST COPY, which holds real data (use npm run dev:test for it)')
  else if (clinicRefs(root).includes(ref)) problems.push("it points at a clinic's own project")
  const keyRef = jwtPayload(env.key)?.ref
  if (ref && typeof keyRef === 'string' && keyRef !== ref) problems.push('the anon key is for another project than the URL')
  return { url: env.url.trim(), key: env.key, ref: ref ?? '', problems }
}

export function readTestFakeEnv(root = process.cwd()): TestFakeEnv {
  let text = ''
  try { text = readFileSync(resolve(root, TEST_FAKE_ENV), 'utf8') } catch {
    return { url: '', key: '', ref: '', problems: [`${TEST_FAKE_ENV} is missing: copy config/test-fake.env.example and fill in your fake project`] }
  }
  return parseTestFakeEnv(text, root)
}

/** Vite `define` for test mode against the fake project. Throws: the app does not start half-configured. */
export function testFakeDefine(root?: string): Record<string, string> {
  const env = readTestFakeEnv(root)
  if (env.problems.length) throw new Error(`${TEST_FAKE_ENV}: ${env.problems.join('; ')}. Fake mode not started.`)
  return {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.url),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.key),
    __WIVO_FAKE_REF__: JSON.stringify(env.ref),
  }
}
