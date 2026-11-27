/**
 * scripts/network-connect.mjs against a fake Management API: it does each
 * step once, a second run changes nothing, orders are never turned on, the
 * private key goes only into the clinic's secrets (never into a log line or
 * the Network), and a dry run sends nothing.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  connectClinic, parseNetworkConfig, withRedirect, lit, clinicProblem, dryRunPlan, deployWithCli, makeClinicKeys,
  FUNCTIONS, SECRET_KEY, SECRET_URL,
} from './network-connect.mjs'
import { parseClinic } from './clinic-config.mjs'

const ROOT = join(__dirname, '..')
const NETWORK = { ref: 'nnnnnnnnnnnnnnnnnnnn', publicKey: 'A'.repeat(43), url: 'https://nnnnnnnnnnnnnnnnnnnn.supabase.co' }
const CLINIC = {
  id: 'dentiks', name: "Dentiks O'Hara", phoneUrl: 'https://wivo.dentiks.lv', supabaseRef: 'cccccccccccccccccccc',
  supabaseUrl: 'https://cccccccccccccccccccc.supabase.co', orgId: '0641ae3d-5bdb-4e67-b147-6cc45ba59bb4', city: 'Rīga', country: 'LV',
}

/** The two projects, as the Management API would show them. */
function fakeWorld(over: { has138?: boolean; enabled?: boolean } = {}) {
  const w = {
    network: { rows: [] as Record<string, unknown>[], redirects: 'https://app.wivodent.com/network' },
    clinic: {
      secrets: new Map<string, string>(), functions: new Map<string, boolean>(),
      settings: null as null | { enabled: boolean; network_public_key: string | null; network_clinic_id: string | null },
    },
    writes: [] as string[],
    logs: [] as string[],
  }
  if (over.enabled !== undefined) w.clinic.settings = { enabled: over.enabled, network_public_key: null, network_clinic_id: null }
  const val = (q: string, re: RegExp) => { const m = re.exec(q); if (!m) throw new Error(`fake: cannot read ${q}`); return m[1].replace(/''/g, "'") }

  const deps = {
    query: async (ref: string, q: string) => {
      if (ref === NETWORK.ref) {
        if (q.includes("to_regclass('public.clinic')")) return [{ has_clinic: true, has_key_column: true }]
        if (q.startsWith('select id, invite_code')) return w.network.rows.filter(r => r.api_url === val(q, /api_url = '((?:[^']|'')*)'/))
        if (q.startsWith('insert into public.clinic')) {
          w.writes.push('network insert')
          const values = /values \('((?:[^']|'')*)', '([A-Z]{2})', '((?:[^']|'')*)', '([^']*)', false\)/.exec(q)!
          const row = { id: '11111111-0000-4000-8000-000000000001', invite_code: 'abcdef123456789012', name: values[1].replace(/''/g, "'"),
            country: values[2], city: values[3].replace(/''/g, "'"), api_url: values[4], clinic_public_key: null }
          w.network.rows.push(row)
          return [row]
        }
        if (q.startsWith('update public.clinic set clinic_public_key')) {
          w.writes.push('network key')
          w.network.rows[0].clinic_public_key = val(q, /clinic_public_key = '([^']*)'/)
          return []
        }
        if (q.startsWith('update public.clinic set name')) { w.writes.push('network place'); return [] }
      }
      if (ref === CLINIC.supabaseRef) {
        if (q.includes("to_regclass('public.network_settings')")) return [{ has_settings: over.has138 ?? true, has_org: true }]
        if (q.startsWith('select enabled')) return w.clinic.settings ? [{ ...w.clinic.settings }] : []
        if (q.startsWith('insert into public.network_settings')) {
          w.writes.push('clinic settings')
          expect(q).toContain('values (\'0641ae3d-5bdb-4e67-b147-6cc45ba59bb4\', false,')
          expect(q).not.toMatch(/set[^;]*enabled\s*=/)
          const key = val(q, /false, '([^']*)'/)
          const id = val(q, /false, '[^']*', '([^']*)'/)
          w.clinic.settings = { enabled: w.clinic.settings?.enabled ?? false, network_public_key: key, network_clinic_id: id }
          return []
        }
      }
      throw new Error(`fake: unexpected query on ${ref}: ${q}`)
    },
    secretNames: async () => [...w.clinic.secrets.keys()],
    setSecrets: async (_ref: string, list: { name: string; value: string }[]) => { w.writes.push(`secrets ${list.map(s => s.name).join(',')}`); for (const s of list) w.clinic.secrets.set(s.name, s.value) },
    functions: async () => [...w.clinic.functions].map(([slug, verify_jwt]) => ({ slug, verify_jwt })),
    deploy: async (_ref: string, slug: string, verifyJwt: boolean) => { w.clinic.functions.set(slug, verifyJwt) },
    authConfig: async () => ({ uri_allow_list: w.network.redirects }),
    patchAuthConfig: async (_ref: string, patch: { uri_allow_list: string }) => { w.writes.push('redirect'); w.network.redirects = patch.uri_allow_list },
    makeKeys: makeClinicKeys,
    log: (line: string) => { w.logs.push(line) },
  }
  return { w, deps }
}

describe('network-connect', () => {
  it('connects a clinic in one run: row, key, functions, settings (orders off), redirect, and says so', async () => {
    const { w, deps } = fakeWorld()
    const r = await connectClinic(CLINIC, NETWORK, deps)
    expect(r.problems).toEqual([])
    expect(r.ordersOn).toBe(false)
    expect(r.inviteLink).toBe('https://wivo.dentiks.lv/network/join/abcdef123456789012')
    expect(w.network.rows[0]).toMatchObject({ name: "Dentiks O'Hara", city: 'Rīga', country: 'LV', api_url: CLINIC.supabaseUrl })
    expect(w.network.rows[0].clinic_public_key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(w.clinic.secrets.get(SECRET_URL)).toBe(NETWORK.url)
    expect([...w.clinic.functions]).toEqual(FUNCTIONS.map(f => [f.slug, f.verifyJwt]))
    expect(w.clinic.settings).toEqual({ enabled: false, network_public_key: NETWORK.publicKey, network_clinic_id: r.networkClinicId })
    expect(w.network.redirects).toBe('https://app.wivodent.com/network,https://wivo.dentiks.lv/network')
  })

  it('the private key goes only into the clinic\'s secrets: not into the Network, not into any line on screen', async () => {
    const { w, deps } = fakeWorld()
    await connectClinic(CLINIC, NETWORK, deps)
    const priv = w.clinic.secrets.get(SECRET_KEY)!
    expect(priv.length).toBeGreaterThan(43)
    expect(w.logs.join('\n')).not.toContain(priv)
    expect(JSON.stringify(w.network)).not.toContain(priv)
    // The two halves belong together: the public key in the Network is the private key's.
    const { webcrypto } = await import('node:crypto')
    const key = await webcrypto.subtle.importKey('pkcs8', Buffer.from(priv, 'base64url'), { name: 'Ed25519' }, true, ['sign'])
    const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, key, Buffer.from('x'))
    const pub = await webcrypto.subtle.importKey('raw', Buffer.from(String(w.network.rows[0].clinic_public_key), 'base64url'), { name: 'Ed25519' }, false, ['verify'])
    expect(await webcrypto.subtle.verify({ name: 'Ed25519' }, pub, sig, Buffer.from('x'))).toBe(true)
  })

  it('a second run changes nothing (functions are deployed again, the same code)', async () => {
    const { w, deps } = fakeWorld()
    await connectClinic(CLINIC, NETWORK, deps)
    const key = w.clinic.secrets.get(SECRET_KEY)
    w.writes.length = 0
    const again = await connectClinic(CLINIC, NETWORK, deps)
    expect(w.writes).toEqual([])
    expect(again.did).toEqual(['functions deployed'])
    expect(w.clinic.secrets.get(SECRET_KEY)).toBe(key)
    expect(w.network.rows).toHaveLength(1)
    expect((await connectClinic(CLINIC, NETWORK, deps, { skipDeploy: true })).did).toEqual([])
  })

  it('never turns orders on; leaves them on when the owner had them on', async () => {
    const { w, deps } = fakeWorld({ enabled: true })
    const r = await connectClinic(CLINIC, NETWORK, deps)
    expect(w.clinic.settings?.enabled).toBe(true)
    expect(r.ordersOn).toBe(true)
  })

  it('a key half missing on either side: a new pair for both; --rotate-key: a new pair anyway', async () => {
    const { w, deps } = fakeWorld()
    await connectClinic(CLINIC, NETWORK, deps)
    const first = w.clinic.secrets.get(SECRET_KEY)
    w.clinic.secrets.delete(SECRET_KEY)
    await connectClinic(CLINIC, NETWORK, deps, { skipDeploy: true })
    const second = w.clinic.secrets.get(SECRET_KEY)
    expect(second).not.toBe(first)
    await connectClinic(CLINIC, NETWORK, deps, { skipDeploy: true, rotateKey: true })
    expect(w.clinic.secrets.get(SECRET_KEY)).not.toBe(second)
  })

  it('stops before writing anything when the clinic lacks sql/138', async () => {
    const { w, deps } = fakeWorld({ has138: false })
    await expect(connectClinic(CLINIC, NETWORK, deps)).rejects.toThrow(/sql\/138/)
    expect(w.writes).toEqual([])
  })

  it('says what is still wrong at the end', async () => {
    const { deps } = fakeWorld()
    const wrongJwt = { ...deps, deploy: async () => {}, functions: async () => [{ slug: 'network-client', verify_jwt: true }] }
    const r = await connectClinic(CLINIC, NETWORK, wrongJwt)
    expect(r.problems).toContain('network-client: JWT check is on, should be off')
    expect(r.problems).toContain('the function network-directory is not on the clinic\'s project')
  })
})

describe('its pieces', () => {
  it('network/config.json: the Network ref and public key only; never production, the test copy or a clinic', () => {
    expect(parseNetworkConfig('{"ref":"","publicKey":""}').problem).toMatch(/no "ref" yet/)
    expect(parseNetworkConfig(JSON.stringify({ ref: NETWORK.ref, publicKey: '' })).problem).toMatch(/no "publicKey" yet/)
    expect(parseNetworkConfig(JSON.stringify({ ref: NETWORK.ref, publicKey: NETWORK.publicKey })).network).toEqual(NETWORK)
    expect(parseNetworkConfig(JSON.stringify({ ref: 'wrtucsfmpbwekugzzzxw', publicKey: NETWORK.publicKey })).problem).toMatch(/production/)
    expect(parseNetworkConfig(JSON.stringify({ ref: CLINIC.supabaseRef, publicKey: NETWORK.publicKey }), [CLINIC.supabaseRef]).problem).toMatch(/clinic/)
    expect(parseNetworkConfig(JSON.stringify({ ref: NETWORK.ref, publicKey: NETWORK.publicKey, privateKey: 'x' })).problem).toMatch(/privateKey is not a setting/)
  })

  it('the tracked network/config.json holds only public values (empty until the Network exists)', () => {
    const text = readFileSync(join(ROOT, 'network', 'config.json'), 'utf8')
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['publicKey', 'ref'])
    expect(text).not.toMatch(/sbp_|sb_secret_|PRIVATE KEY|NETWORK_SIGNING_KEY|eyJ/)
    const { problem } = parseNetworkConfig(text)
    expect(problem === null || /yet/.test(problem)).toBe(true)
  })

  it('redirects: added once, the others kept', () => {
    expect(withRedirect('a,b', 'c')).toBe('a,b,c')
    expect(withRedirect(' a , c ', 'c')).toBeNull()
    expect(withRedirect('', 'c')).toBe('c')
    expect(withRedirect(undefined, 'c')).toBe('c')
  })

  it('SQL literals are quoted', () => {
    expect(lit("O'Hara")).toBe("'O''Hara'")
    expect(lit(null)).toBe('null')
    expect(lit(false)).toBe('false')
  })

  it('a clinic needs its organisation and country', () => {
    expect(clinicProblem({ ...CLINIC, orgId: undefined })).toMatch(/orgId/)
    expect(clinicProblem({ ...CLINIC, country: undefined })).toMatch(/country/)
    expect(clinicProblem(CLINIC)).toBeNull()
  })

  it('Dentiks has what the Network needs in clinics/dentiks.json', () => {
    const { clinic, problems } = parseClinic(readFileSync(join(ROOT, 'clinics', 'dentiks.json'), 'utf8'), 'dentiks')
    expect(problems).toEqual([])
    expect(clinicProblem(clinic)).toBeNull()
    expect(clinic).toMatchObject({ city: 'Rīga', country: 'LV' })
  })

  it('a dry run names every step, keeps orders off and shows no secret', () => {
    const plan = dryRunPlan(CLINIC, NETWORK)
    expect(plan).toMatch(/Nothing is sent/)
    for (const f of FUNCTIONS) expect(plan).toContain(`deploy ${f.slug}`)
    expect(plan).toContain('--no-verify-jwt --project-ref')
    expect(plan).toContain('<private key, never shown>')
    expect(plan).toContain(`values ('${CLINIC.orgId}', false,`)
    expect(plan).toContain('https://wivo.dentiks.lv/network')
  })

  it('the deploy refuses anything it did not plan', async () => {
    await expect(deployWithCli('sbp_x')('not-a-ref', 'network-client', false)).rejects.toThrow(/did not plan/)
    await expect(deployWithCli('sbp_x')(CLINIC.supabaseRef, 'send-invoices', true)).rejects.toThrow(/did not plan/)
  })
})
