/**
 * Below the signed minimum version, the database client refuses saves before
 * they leave, and lets reads through (lib/releaseMinimum, docs/RELEASE.md §6a).
 * Which function calls are reads is checked against the database itself
 * (sql/checks/schema_check.sql, generated from the migrations), so a new
 * function the app calls can't be misjudged quietly.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { READ_FUNCTIONS, READ_TRACES, isSaveRequest, saveGuardFetch, setReleaseMinimum, savesBlocked } from './releaseMinimum'
import { versionWatchingFetch, isUpdateRequired } from './appVersion'

const ROOT = join(__dirname, '../../../..')
const API = 'https://abc.supabase.co'

/** Each public function's volatility in the generated schema check; a name with any volatile overload is volatile (as sql/104). */
function volatility(): Map<string, string> {
  const sql = readFileSync(join(ROOT, 'sql/checks/schema_check.sql'), 'utf8')
  const out = new Map<string, string>()
  for (const m of sql.matchAll(/\('function', 'public\.([a-z0-9_]+)\([^']*\)', '[^']*?\b(volatile|stable|immutable)\b/g)) {
    if (out.get(m[1]) !== 'volatile') out.set(m[1], m[2])
  }
  return out
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : sourceFiles(p)
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}

/** Every `.rpc('name'` the app makes. */
function calledFunctions(): Set<string> {
  const names = new Set<string>()
  for (const f of [...sourceFiles(join(ROOT, 'src/renderer/src')), ...sourceFiles(join(ROOT, 'shared'))]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\.rpc\(\s*['"]([a-z0-9_]+)['"]/g)) names.add(m[1])
  }
  return names
}

describe('which function calls are reads', () => {
  const kinds = volatility()

  it('the schema check lists the functions (the parser reads it)', () => {
    expect(kinds.size).toBeGreaterThan(100)
    expect(kinds.get('job_files')).toBe('stable')
    expect(kinds.get('create_job')).toBe('volatile')
  })

  it('every function listed as a read is declared stable or immutable in the database', () => {
    for (const name of READ_FUNCTIONS) expect(kinds.get(name), name).toMatch(/^(stable|immutable)$/)
  })

  it('every read the app calls is listed, so reading keeps working below the minimum', () => {
    const missing = [...calledFunctions()].filter(n => kinds.get(n) !== 'volatile' && kinds.has(n) && !READ_FUNCTIONS.has(n))
    expect(missing).toEqual([])
  })

  it('the traces of reading are named one by one, each a function the app calls', () => {
    const called = calledFunctions()
    for (const name of Object.keys(READ_TRACES)) {
      expect(called.has(name), name).toBe(true)
      expect(kinds.has(name), name).toBe(true)
    }
    // Saves stay saves.
    for (const save of ['create_job', 'move_job_stage', 'post_job_comment', 'register_job_file', 'next_invoice_number', 'create_payout']) {
      expect(save in READ_TRACES || READ_FUNCTIONS.has(save), save).toBe(false)
    }
  })
})

describe('what a save is', () => {
  const save = (path: string, method = 'POST') => isSaveRequest(`${API}${path}`, method)

  it('writing a table or a view is a save; reading it is not', () => {
    expect(save('/rest/v1/jobs', 'GET')).toBe(false)
    expect(save('/rest/v1/jobs', 'HEAD')).toBe(false)
    expect(save('/rest/v1/jobs')).toBe(true)
    expect(save('/rest/v1/jobs?id=eq.1', 'PATCH')).toBe(true)
    expect(save('/rest/v1/jobs?id=eq.1', 'DELETE')).toBe(true)
    expect(save('/rest/v1/jobs', 'PUT')).toBe(true)
  })

  it('a function call: reads and the traces of reading go, anything else is a save', () => {
    expect(save('/rest/v1/rpc/job_files')).toBe(false)
    expect(save('/rest/v1/rpc/log_job_view')).toBe(false)
    expect(save('/rest/v1/rpc/audit_export')).toBe(false)
    expect(save('/rest/v1/rpc/create_job')).toBe(true)
    expect(save('/rest/v1/rpc/move_job_stage')).toBe(true)
    expect(save('/rest/v1/rpc/a_function_nobody_listed')).toBe(true)
  })

  it('files: downloads, signed links and listings go; uploads, moves and deletes do not', () => {
    expect(save('/storage/v1/object/job-files/a/b.stl', 'GET')).toBe(false)
    expect(save('/storage/v1/object/sign/job-files/a/b.stl')).toBe(false)
    expect(save('/storage/v1/object/list/job-files')).toBe(false)
    expect(save('/storage/v1/object/job-files/a/b.stl')).toBe(true)
    expect(save('/storage/v1/object/job-files/a/b.stl', 'PUT')).toBe(true)
    expect(save('/storage/v1/object/job-files', 'DELETE')).toBe(true)
    expect(save('/storage/v1/object/move')).toBe(true)
    expect(save('/storage/v1/upload/resumable')).toBe(true)
  })

  it('Edge Functions: a file\'s link goes, the others change things', () => {
    expect(save('/functions/v1/file-link')).toBe(false)
    expect(save('/functions/v1/team-account')).toBe(true)
    expect(save('/functions/v1/account-security')).toBe(true)
    expect(save('/functions/v1/wivo-update')).toBe(true)
  })

  it('signing in, out and the second factor go; changing the account does not', () => {
    expect(save('/auth/v1/token?grant_type=password')).toBe(false)
    expect(save('/auth/v1/token?grant_type=refresh_token')).toBe(false)
    expect(save('/auth/v1/logout')).toBe(false)
    expect(save('/auth/v1/factors/abc/verify')).toBe(false)
    expect(save('/auth/v1/user', 'PUT')).toBe(true)
    expect(save('/auth/v1/user', 'GET')).toBe(false)
  })
})

describe('the guard in the database client', () => {
  it('below the minimum: a save is refused here, never sent, with the database\'s own "update required"', async () => {
    const inner = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }))
    setReleaseMinimum({ minimum: '2.2.1', running: '2.2.0', below: true })
    expect(savesBlocked()).toBe(true)
    const reported = vi.fn()
    const { onUpdateRequired } = await import('./appVersion')
    const off = onUpdateRequired(reported)
    const client = createClient(API, 'anon', {
      global: { fetch: versionWatchingFetch(saveGuardFetch(inner as unknown as typeof fetch)) },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const write = await client.from('jobs').insert({ id: 1 })
    expect(write.status).toBe(426)
    expect(isUpdateRequired(write.error)).toBe(true)
    const rpc = await client.rpc('create_job', {})
    expect(isUpdateRequired(rpc.error)).toBe(true)
    expect(inner).not.toHaveBeenCalled()
    expect(reported).toHaveBeenCalled()

    const read = await client.from('jobs').select('*')
    expect(read.error).toBeNull()
    await client.rpc('job_files', {})
    expect(inner).toHaveBeenCalledTimes(2)
    off()
  })

  it('at or above the minimum, or with none: everything is sent', async () => {
    const inner = vi.fn(async () => new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } }))
    const guarded = saveGuardFetch(inner as unknown as typeof fetch)
    setReleaseMinimum({ minimum: '2.2.1', running: '2.2.1', below: false })
    await guarded(`${API}/rest/v1/jobs`, { method: 'POST' })
    setReleaseMinimum(null)
    await guarded(`${API}/rest/v1/jobs`, { method: 'POST' })
    expect(inner).toHaveBeenCalledTimes(2)
  })
})
