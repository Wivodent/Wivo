/**
 * Every Edge Function the app calls lets the version headers through (else
 * the browser refuses the call) and passes the caller's version on.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { join } from 'node:path'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from './appVersion'

const ROOT = execSync('git rev-parse --show-toplevel').toString().trim()

/** The functions the app calls with supabase.functions.invoke(). */
function invokedByTheApp(): string[] {
  // execFileSync, no shell: cmd.exe on Windows keeps single quotes in a pathspec and matches nothing.
  const out = execFileSync('git', ['grep', '-h', '-o', "functions.invoke('[a-z-]*'", '--', 'src/renderer/src'], { cwd: ROOT }).toString()
  return [...new Set(out.trim().split('\n').map(l => /'([a-z-]+)'/.exec(l)![1]))]
    // The Wivo Network's own function (network/functions, its own project), called by
    // the phone app's Network mode through the Network's client (lib/network): below.
    .filter(name => !NETWORK_FUNCTIONS.includes(name)).sort()
}

const NETWORK_FUNCTIONS = ['network-token']

describe('the version headers and the Edge Functions', () => {
  it('allows both headers', () => {
    expect(APP_ALLOWED_HEADERS).toMatch(/x-wivo-version/)
    expect(APP_ALLOWED_HEADERS).toMatch(/x-wivo-client/)
  })

  it('passes on the caller\'s version, and nothing odd', () => {
    const req = (v: string | null) => ({ headers: { get: (n: string) => (n === 'x-wivo-version' ? v : null) } })
    expect(callerVersionHeaders(req(' 2.1.0 '))).toEqual({ 'x-wivo-version': '2.1.0' })
    expect(callerVersionHeaders(req(null))).toEqual({})
    expect(callerVersionHeaders(req(''))).toEqual({})
    expect(callerVersionHeaders(req('x'.repeat(41)))).toEqual({})
  })

  it.each(invokedByTheApp())('%s (called by the app) allows the headers and passes the version on', name => {
    const src = readFileSync(join(ROOT, 'supabase/functions', name, 'index.ts'), 'utf8')
    expect(src).toContain("'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS")
    expect(src).toContain('callerVersionHeaders(req)')
  })

  it.each(NETWORK_FUNCTIONS)('%s (the Network project) lets the version header through', name => {
    const src = readFileSync(join(ROOT, 'network/functions', name, 'index.ts'), 'utf8')
    expect(src).toMatch(/'Access-Control-Allow-Headers': '[^']*x-wivo-version/)
  })

  it('the app calls exactly these functions today', () => {
    expect(invokedByTheApp()).toEqual(['account-security', 'file-link', 'network-directory', 'send-invoice', 'team-account', 'wivo-update'])
  })
})
