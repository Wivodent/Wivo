/**
 * The desktop and phone policies (config/csp.ts, 2.2.5): scripts only from the
 * app itself, data only to the clinic's project and Sentry.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { apiOrigins, desktopCsp, mobileCsp, sentryOrigin } from './csp'

const directive = (csp: string, name: string): string[] =>
  (csp.split('; ').find(d => d.startsWith(`${name} `)) ?? '').split(' ').slice(1)

describe('the desktop window', () => {
  const csp = desktopCsp()
  it('runs only its own scripts: no inline, no eval', () => {
    expect(directive(csp, 'script-src')).toEqual(["'self'"])
    expect(csp).not.toMatch(/unsafe-eval|'unsafe-inline'[^;]*;?\s*$/)
  })
  it('reaches Supabase (https and realtime), Sentry through its IPC scheme, its own blobs', () => {
    expect(directive(csp, 'connect-src')).toEqual(expect.arrayContaining(['https://*.supabase.co', 'wss://*.supabase.co', 'sentry-ipc:', 'blob:']))
    expect(directive(csp, 'img-src')).toEqual(expect.arrayContaining(['https://*.supabase.co', 'blob:', 'data:']))
    expect(directive(csp, 'base-uri')).toEqual(["'none'"])
  })
  it('a clinic on its own server adds its address', () => {
    expect(directive(desktopCsp({ apiUrl: 'https://api.clinic.example' }), 'connect-src'))
      .toEqual(expect.arrayContaining(['https://api.clinic.example', 'wss://api.clinic.example']))
  })
})

describe('the phone app', () => {
  it('only its own project and the Sentry host', () => {
    const csp = mobileCsp({ supabaseUrl: 'https://abcdefghijklmnopqrst.supabase.co', sentryDsn: 'https://k@o1.ingest.de.sentry.io/2' })
    expect(directive(csp, 'connect-src')).toEqual(["'self'", 'https://abcdefghijklmnopqrst.supabase.co', 'wss://abcdefghijklmnopqrst.supabase.co', 'https://o1.ingest.de.sentry.io'])
    expect(directive(csp, 'script-src')).toEqual(["'self'"])
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"])
  })
  it('without a project address: any supabase.co, and the build warns', () => {
    expect(directive(mobileCsp({}), 'connect-src')).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co'])
  })
  it('the _headers template carries the Report-Only policy and HSTS', () => {
    const headers = readFileSync(join(__dirname, '..', 'src', 'renderer', 'mobile-static', '_headers'), 'utf8')
    expect(headers).toContain('Content-Security-Policy-Report-Only: %CSP_REPORT_ONLY%')
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000')
  })
})

describe('origins', () => {
  it('https only; anything else gives nothing', () => {
    expect(apiOrigins('https://x.supabase.co/rest/v1')).toEqual(['https://x.supabase.co', 'wss://x.supabase.co'])
    expect(apiOrigins('http://127.0.0.1:54321')).toEqual([])
    expect(apiOrigins(undefined)).toEqual([])
    expect(sentryOrigin('nonsense')).toEqual([])
  })
})
