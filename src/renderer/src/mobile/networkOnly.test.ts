/**
 * app.wivodent.com's build (VITE_NETWORK_ONLY=true, vite.mobile.config.ts):
 * built here for real, then read. It holds no clinic Supabase address and no
 * key, not even when one is set, and none of the clinic client's code; it
 * needs neither variable; it is "Wivo Network"; "/" goes to /network.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { networkOnlyPath } from './route'

const ROOT = resolve(__dirname, '../../../..')
const CLINIC_URL = 'https://clinicmarkerqqqqqqqqq.supabase.co'
const CLINIC_KEY = 'clinic-anon-key-marker-0123456789'
let out: string
let files: { name: string; text: string }[] = []

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

/** The clinic URL in the developer's own .env, if any: that one must not leak either. */
function localClinicUrl(): string | null {
  const env = join(ROOT, '.env')
  if (!existsSync(env)) return null
  const m = /^VITE_SUPABASE_URL\s*=\s*"?([^"\s]+)/m.exec(readFileSync(env, 'utf8'))
  return m ? m[1] : null
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'wivo-network-only-'))
  const saved = { ...process.env }
  Object.assign(process.env, { VITE_NETWORK_ONLY: 'true', VITE_SUPABASE_URL: CLINIC_URL, VITE_SUPABASE_ANON_KEY: CLINIC_KEY })
  try {
    await build({
      configFile: join(ROOT, 'vite.mobile.config.ts'),
      mode: 'production',
      logLevel: 'silent',
      build: { outDir: out, emptyOutDir: true, reportCompressedSize: false },
    })
  } finally {
    for (const k of ['VITE_NETWORK_ONLY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
  files = walk(out)
    .filter(p => /\.(js|html|css|json|webmanifest|txt)$|_headers$|_redirects$/.test(p))
    .map(p => ({ name: p.slice(out.length + 1).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') }))
}, 240_000)

afterAll(() => { if (out) rmSync(out, { recursive: true, force: true }) })

describe('app.wivodent.com: the Wivo Network only', () => {
  it('holds no clinic Supabase address or key, even when they are set', () => {
    const local = localClinicUrl()
    for (const f of files) {
      expect(f.text, f.name).not.toContain(CLINIC_URL)
      expect(f.text, f.name).not.toContain('clinicmarkerqqqqqqqqq')
      expect(f.text, f.name).not.toContain(CLINIC_KEY)
      if (local) expect(f.text.includes(local), `${f.name} holds the .env clinic address`).toBe(false)
    }
  })

  it('carries none of the clinic client\'s code (lib/supabase), so it needs no clinic variables', () => {
    const js = files.filter(f => f.name.endsWith('.js'))
    expect(js.length).toBeGreaterThan(0)
    for (const f of js) expect(f.text, f.name).not.toContain('Missing Supabase env vars')
  })

  it('is called Wivo Network, opens at /network, and sends "/" there', () => {
    const page = files.find(f => f.name === 'index.html')!
    expect(page.text).toContain('<title>Wivo Network</title>')
    expect(page.text).not.toContain('mobile/main')
    const manifest = JSON.parse(files.find(f => f.name === 'manifest.webmanifest')!.text)
    expect(manifest).toMatchObject({ name: 'Wivo Network', short_name: 'Wivo Network', start_url: '/network' })
    expect(files.find(f => f.name === '_redirects')!.text.split('\n')[0]).toMatch(/^\/\s+\/network\s+302$/)
    expect(files.some(f => f.name === 'sw.js')).toBe(false)
  })

  it('its CSP names no clinic of its own: the Network and any clinic a client connects to', () => {
    const headers = files.find(f => f.name === '_headers')!.text
    expect(headers).toContain('https://*.supabase.co')
    expect(headers).not.toContain('clinicmarker')
  })
})

describe('networkOnlyPath', () => {
  it('keeps /network and below; sends everything else to /network', () => {
    expect(networkOnlyPath('/network')).toBe('/network')
    expect(networkOnlyPath('/network/join/abcdef123456')).toBe('/network/join/abcdef123456')
    expect(networkOnlyPath('/')).toBe('/network')
    expect(networkOnlyPath('/job/123')).toBe('/network')
    expect(networkOnlyPath('/settings')).toBe('/network')
    expect(networkOnlyPath('/networkx')).toBe('/network')
  })
})
