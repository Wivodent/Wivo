/**
 * The issuing tool and the app must agree byte for byte.
 *
 * scripts/make-license.mjs runs in plain Node, so it cannot import
 * shared/license/token.ts and keeps a small copy of the format: base64url, the
 * module list, the signing domain. A copy drifts. This test closes the loop
 * the only way that cannot lie — it SIGNS with the script and VERIFIES with
 * the module the app uses, so a change to either side that the other does not
 * follow fails here.
 *
 * It also checks what the tool refuses. A licence that promises a page which
 * cannot work, or that names no address, is worse than a missing module: the
 * first is found by a clinic, the second by nobody until a key is copied to
 * the wrong server.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto'
import {
  GRACE_DAYS, MODULE_KEYS, b64urlDecode, licenceAllowsApi, licenceApiOrigins, licenceModules, licenceStatus,
  parseToken, signingInput,
} from '../shared/license/token'
import { judgePublishedLicence, licenceFileText } from '../shared/license/published'
import { spawnSync } from 'node:child_process'

const SCRIPT = 'scripts/make-license.mjs'
const ORG = '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d'
const API = 'https://abc.supabase.co'

const dir = mkdtempSync(join(tmpdir(), 'wivo-licence-'))
const KEY = join(dir, 'key.pem')
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

/** Run the tool. Returns stdout; throws with the message on a refusal. */
function run(...args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8' })
}

/** Run it expecting a refusal, and hand back what it said. */
function refusal(...args: string[]): string {
  try {
    run(...args)
  } catch (e) {
    const err = e as { stderr?: Buffer | string; stdout?: Buffer | string; status?: number }
    expect(err.status, 'the tool exited 0 — it did not refuse').not.toBe(0)
    return String(err.stderr ?? '') + String(err.stdout ?? '')
  }
  throw new Error('the tool did not refuse')
}

/** The public key the tool printed, as the app stores it: 32 bytes of hex. */
const PUBLIC_HEX = (() => {
  const out = run('keygen', '--out', KEY)
  const m = /'([0-9a-f]{64})'/.exec(out)
  if (!m) throw new Error(`keygen printed no public key:\n${out}`)
  return m[1]
})()

/** Verify a token exactly as src/main/license.ts does. */
function verifies(token: string, version: number): boolean {
  const parsed = parseToken(token)
  if (!parsed) return false
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(PUBLIC_HEX, 'hex'),
  ])
  return nodeVerify(
    null,
    Buffer.from(signingInput(parsed.payloadB64, version)),
    createPublicKey({ key: der, format: 'der', type: 'spki' }),
    Buffer.from(parsed.signature),
  )
}

const sign = (...extra: string[]): string =>
  run('sign', '--org', ORG, '--name', 'Riia kliinik', '--api', API,
      '--key', KEY, '--quiet', ...extra).trim()

describe('keygen', () => {
  it('writes a private key and prints the public one', () => {
    expect(readFileSync(KEY, 'utf8')).toContain('BEGIN PRIVATE KEY')
    expect(PUBLIC_HEX).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to overwrite a key — a second keypair invalidates every licence', () => {
    expect(refusal('keygen', '--out', KEY)).toMatch(/REFUSING/)
  })
})

describe('a token the tool issues is one the app accepts', () => {
  const token = sign('--modules', 'jobs,payroll,stock')

  it('parses, with the version, organisation and address it was given', () => {
    const payload = parseToken(token)?.payload
    expect(payload?.v).toBe(2)
    expect(payload?.org).toBe(ORG)
    expect(payload?.name).toBe('Riia kliinik')
    expect(licenceApiOrigins(payload!)).toEqual([API])
  })

  it('carries exactly the modules asked for', () => {
    expect([...licenceModules(parseToken(token)!.payload)].sort())
      .toEqual(['jobs', 'payroll', 'stock'])
  })

  it('VERIFIES — the script and shared/license/token.ts sign the same bytes', () => {
    expect(verifies(token, 2)).toBe(true)
  })

  it('does not verify as a v1 token: the domain prefix is really there', () => {
    expect(verifies(token, 1)).toBe(false)
  })

  it('allows the address it names and no other', () => {
    const payload = parseToken(token)!.payload
    expect(licenceAllowsApi(payload, 'https://abc.supabase.co/rest/v1/jobs')).toBe(true)
    expect(licenceAllowsApi(payload, 'https://other.supabase.co')).toBe(false)
  })

  it('a changed payload stops verifying, which is the whole point of signing', () => {
    const [, b64, sig] = token.split('.')
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(b64)))
    const widened = Buffer.from(JSON.stringify({ ...payload, modules: [...MODULE_KEYS] }), 'utf8')
      .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(verifies(`WIVO1.${widened}.${sig}`, 2)).toBe(false)
  })

  it('its own verify command agrees, and says no to a tampered one', () => {
    expect(run('verify', token, '--public', PUBLIC_HEX)).toMatch(/^OK · v2/)
    const [, b64, sig] = token.split('.')
    const other = sign('--modules', 'jobs').split('.')[2]
    expect(sig).not.toBe(other)
    expect(refusal('verify', `WIVO1.${b64}.${other}`, '--public', PUBLIC_HEX)).toMatch(/NOT VALID/)
  })

  it('--modules all is every module this build knows', () => {
    expect([...licenceModules(parseToken(sign('--modules', 'all'))!.payload)].sort())
      .toEqual([...MODULE_KEYS].sort())
  })
})

describe('what the tool refuses', () => {
  it('ratings without jobs — a rating is given on a job', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'ratings,payroll'))
      .toMatch(/ratings needs jobs/)
  })

  it('a module name that does not exist, so a typo is not a quiet downgrade', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'jobs,payrol'))
      .toMatch(/unknown module: payrol/)
  })

  it('no organisation: a key with only a name would work in any clinic', () => {
    expect(refusal('sign', '--name', 'X', '--api', API, '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--org/)
  })

  it('an organisation that is not a UUID', () => {
    expect(refusal('sign', '--org', 'riia', '--name', 'X', '--api', API, '--key', KEY,
                   '--modules', 'jobs'))
      .toMatch(/must be a UUID/)
  })

  it('no address: the app checks where it may connect before it connects', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--api/)
  })

  it('an address that is not one', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', 'abc.supabase.co',
                   '--key', KEY, '--modules', 'jobs'))
      .toMatch(/not an address/)
  })

  it('a name it cannot put on the key', () => {
    expect(refusal('sign', '--org', ORG, '--api', API, '--key', KEY, '--modules', 'jobs'))
      .toMatch(/--name/)
  })
})

describe('renew keeps what renewing must not quietly change', () => {
  const first = sign('--modules', 'jobs,stock', '--months', '1')
  const renewed = run('renew', first, '--key', KEY, '--months', '24', '--quiet').trim()

  it('carries the organisation, the address and the modules over', () => {
    const before = parseToken(first)!.payload
    const after = parseToken(renewed)!.payload
    expect(after.org).toBe(before.org)
    expect(licenceApiOrigins(after)).toEqual(licenceApiOrigins(before))
    expect([...licenceModules(after)].sort()).toEqual([...licenceModules(before)].sort())
  })

  it('moves only the expiry, and the new token verifies too', () => {
    const before = parseToken(first)!.payload
    const after = parseToken(renewed)!.payload
    expect(after.exp > before.exp).toBe(true)
    expect(verifies(renewed, 2)).toBe(true)
  })

  it('a v1 key renewed stays v1 — renewing cannot invent an organisation', () => {
    // There is no way to issue v1 any more, so build one the way the script
    // reads it: the payload alone decides the version.
    const v1 = 'WIVO1.' + Buffer.from(JSON.stringify({
      v: 1, name: 'Vana labor', plan: 'labor', seats: 5, iat: '2026-01-01', exp: '2026-12-31',
    }), 'utf8').toString('base64url') + '.AAAA'
    const out = run('renew', v1, '--key', KEY, '--months', '12', '--quiet').trim()
    const after = parseToken(out)!.payload
    expect(after.v).toBe(1)
    expect(after.org).toBeUndefined()
    // And it still means everything, as it always did.
    expect([...licenceModules(after)].sort()).toEqual([...MODULE_KEYS].sort())
    expect(verifies(out, 1)).toBe(true)
  })
})

/** YYYY-MM-DD, `days` from today (UTC), as the tool counts. */
const fromToday = (days: number): string => {
  const t = new Date()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + days)).toISOString().slice(0, 10)
}
const payloadOf = (token: string) => parseToken(token)!.payload

describe('the end on a date: --until', () => {
  it('sign and renew end on the date given', () => {
    expect(payloadOf(sign('--modules', 'jobs', '--until', '2099-12-31')).exp).toBe('2099-12-31')
    const renewed = run('renew', sign('--modules', 'jobs'), '--key', KEY, '--until', '2098-06-30', '--quiet').trim()
    expect(payloadOf(renewed).exp).toBe('2098-06-30')
  })

  it('refuses --until with --months, a date that is not one, and a date in the past', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--key', KEY, '--until', '2099-12-31', '--months', '3'))
      .toMatch(/choose one end/)
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--key', KEY, '--until', '2099-02-30'))
      .toMatch(/not a calendar date/)
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--key', KEY, '--until', '31.12.2099'))
      .toMatch(/YYYY-MM-DD/)
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--key', KEY, '--until', '2020-01-01'))
      .toMatch(/in the past/)
  })
})

describe('terminate: the end of a contract', () => {
  /** A licence issued long ago, ending far ahead: what a clinic has before its contract ends. */
  const longRunning = () => {
    const b64 = Buffer.from(JSON.stringify({
      v: 2, name: 'Riia kliinik', plan: 'labor_plus', seats: 7, iat: '2026-01-01', exp: '2099-01-01', org: ORG, api: [API], modules: ['jobs', 'stock'],
    })).toString('base64url')
    const sig = nodeSign(null, Buffer.from(signingInput(b64, 2)), createPrivateKey(readFileSync(KEY)))
    return `WIVO1.${b64}.${Buffer.from(sig).toString('base64url')}`
  }
  const terminate = (old: string, ...extra: string[]) => run('terminate', old, '--key', KEY, '--quiet', ...extra).trim().split('\n').pop()!

  it('the same licence, issued today, ending in 14 days unless --until says otherwise', () => {
    const old = longRunning()
    const ended = terminate(old)
    expect(verifies(ended, 2)).toBe(true)
    const before = payloadOf(old), after = payloadOf(ended)
    expect(after).toEqual({ ...before, iat: fromToday(0), exp: fromToday(14) })
    expect(payloadOf(terminate(old, '--until', fromToday(3))).exp).toBe(fromToday(3))
  })

  it('the app takes it over the old one, though it ends sooner: it was issued later', () => {
    const old = longRunning()
    const ended = terminate(old)
    const verify = (t: string) => (verifies(t, 2) ? payloadOf(t) : null)
    const judged = judgePublishedLicence({
      file: licenceFileText('dentiks', ended), build: 'dentiks', org: ORG, api: API,
      current: { token: old, payload: payloadOf(old) }, verify,
    })
    expect(judged).toMatchObject({ ok: true, payload: { exp: fromToday(14) } })
    // Saves go on through the end and the grace; then the app only reads.
    const day = (n: number) => new Date(`${fromToday(n)}T12:00:00Z`)
    expect(licenceStatus(payloadOf(ended), day(14)).state).toBe('active')
    expect(licenceStatus(payloadOf(ended), day(14 + GRACE_DAYS)).state).toBe('grace')
    expect(licenceStatus(payloadOf(ended), day(15 + GRACE_DAYS)).state).toBe('expired')
  })

  it('says what ends when, and that there is no offline lock', () => {
    const r = spawnSync('node', [SCRIPT, 'terminate', longRunning(), '--key', KEY], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(new RegExp(`Uus litsents: +välja antud ${fromToday(0)}, kehtib kuni ${fromToday(14)}`))
    expect(r.stderr).toMatch(new RegExp(`alates ${fromToday(15 + GRACE_DAYS)} saab Wivo ainult lugeda`))
    expect(r.stderr).toMatch(/võrguühenduseta lukustust pole/)
  })

  it('refuses a later end than the licence has, --months, a change of terms, and a licence already ended', () => {
    const old = longRunning()
    expect(refusal('terminate', old, '--key', KEY, '--until', '2099-06-01')).toMatch(/that is a renewal/)
    expect(refusal('terminate', old, '--key', KEY, '--months', '1')).toMatch(/ends on a date/)
    expect(refusal('terminate', old, '--key', KEY, '--modules', 'jobs')).toMatch(/keeps the licence as it is: --modules/)
    const gone = 'WIVO1.' + Buffer.from(JSON.stringify({ v: 2, name: 'X', plan: 'labor', seats: 5, iat: '2020-01-01', exp: '2020-06-01', org: ORG, api: [API], modules: ['jobs'] })).toString('base64url') + '.AAAA'
    expect(refusal('terminate', gone, '--key', KEY)).toMatch(/already ended on 2020-06-01/)
    expect(refusal('terminate', '--key', KEY)).toMatch(/terminate needs the old token/)
  })

  it('a licence ending within 14 days anyway: by default it keeps its own end', () => {
    const b64 = Buffer.from(JSON.stringify({ v: 2, name: 'X', plan: 'labor', seats: 5, iat: '2020-01-01', exp: fromToday(5), org: ORG, api: [API], modules: ['jobs'] })).toString('base64url')
    const sig = nodeSign(null, Buffer.from(signingInput(b64, 2)), createPrivateKey(readFileSync(KEY)))
    expect(payloadOf(terminate(`WIVO1.${b64}.${Buffer.from(sig).toString('base64url')}`)).exp).toBe(fromToday(5))
  })

  it('its grace days are the app\'s', () => {
    expect(readFileSync(SCRIPT, 'utf8')).toContain(`const GRACE_DAYS = ${GRACE_DAYS}`)
  })
})

describe('the copy in the script has not drifted', () => {
  it('its module list is the app\'s module list', () => {
    // The usage text prints it, so this reads what the tool itself believes
    // rather than what the file happens to contain.
    const usage = refusal()
    const line = /modules: (.+)/.exec(usage)
    expect(line, usage).not.toBeNull()
    expect(line![1].split(',').map(s => s.trim()).sort()).toEqual([...MODULE_KEYS].sort())
  })
})

/**
 * Signing on a YubiKey. There is no key to touch in a test, so WIVO_YKMAN names
 * a stand-in for `ykman` that speaks setup-device.py's `sign` file format and
 * signs with the test key. Everything else — the statement the key is asked to
 * sign, the check against the pinned public key — is the real code.
 */
describe('signing on a YubiKey', () => {
  const FAKE = join(dir, 'fake-ykman.mjs')
  const SEEN = join(dir, 'seen.json')
  writeFileSync(FAKE, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
const [, , , , py, step, serial, inFile, outFile] = process.argv
const job = JSON.parse(readFileSync(inFile, 'utf8'))
writeFileSync(process.env.FAKE_SEEN, JSON.stringify({ py, step, serial, job }))
if (process.env.FAKE_MODE === 'refuse') { process.stderr.write('Refused (6982).\\n'); process.exit(2) }
if (process.env.FAKE_MODE === 'untouched') {
  writeFileSync(outFile, JSON.stringify({ signed: [{ id: 'licence', error: '6982' }] })); process.exit(0)
}
const key = createPrivateKey(readFileSync(process.env.FAKE_KEY))
const s = job.statements[0]
const sig = sign(null, Buffer.from(s.hex, 'hex'), key)
writeFileSync(outFile, JSON.stringify({ signed: [{ id: s.id, signature_hex: sig.toString('hex') }] }))
`)
  chmodSync(FAKE, 0o755)

  const env = (mode = 'ok', pub: string | undefined = PUBLIC_HEX) => ({
    ...process.env, WIVO_YKMAN: FAKE, FAKE_KEY: KEY, FAKE_SEEN: SEEN, FAKE_MODE: mode,
    ...(pub ? { WIVO_YUBIKEY_PUBLIC_FOR_TEST: pub } : {}),
  })
  const yk = (extra: string[], e = env()) =>
    execFileSync('node', [SCRIPT, 'sign', '--org', ORG, '--name', 'Riia kliinik', '--api', API,
      '--modules', 'jobs,stock', '--quiet', ...extra], { encoding: 'utf8', env: e }).trim()

  it('with no --key, YubiKey C signs, and the app verifies what comes back', () => {
    const token = yk([])
    expect(verifies(token, 2)).toBe(true)
    const seen = JSON.parse(readFileSync(SEEN, 'utf8'))
    expect(seen.step).toBe('sign')
    expect(seen.py).toMatch(/scripts[\\/]yubikey[\\/]setup-device\.py$/)
    expect(seen.serial).toBe('38272295')                       // C
    expect(seen.job.statements).toHaveLength(1)
    expect(seen.job.statements[0].slot).toBe('83')
  })

  it('the key is asked to sign exactly the bytes the app verifies', () => {
    const token = yk([])
    const seen = JSON.parse(readFileSync(SEEN, 'utf8'))
    const parsed = parseToken(token)!
    expect(seen.job.statements[0].hex)
      .toBe(Buffer.from(signingInput(parsed.payloadB64, 2)).toString('hex'))
  })

  it('--yubikey D asks the spare, serial 38272284', () => {
    yk(['--yubikey', 'D'])
    expect(JSON.parse(readFileSync(SEEN, 'utf8')).serial).toBe('38272284')
  })

  it('refuses another letter, and --key together with --yubikey', () => {
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs', '--yubikey', 'A'))
      .toMatch(/C or D/)
    expect(refusal('sign', '--org', ORG, '--name', 'X', '--api', API, '--modules', 'jobs',
                   '--key', KEY, '--yubikey', 'C')).toMatch(/choose one/)
  })

  it('prints no token when the signature is not by the pinned key', () => {
    // The stand-in signs with the test key, the tool expects the other key.
    const other = /'([0-9a-f]{64})'/.exec(run('keygen', '--out', join(dir, 'other.pem')))![1]
    let out = ''
    try { yk([], env('ok', other)) } catch (e) {
      const err = e as { stdout?: string; stderr?: string }
      out = String(err.stdout ?? '') + String(err.stderr ?? '')
      expect(String(err.stdout ?? '')).not.toMatch(/WIVO1\./)
    }
    expect(out).toMatch(/REFUSING: the signature does not verify/)
  })

  it('prints no token when the key refuses or is not touched', () => {
    for (const mode of ['refuse', 'untouched']) {
      try { yk([], env(mode)); throw new Error('printed a token') } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string }
        expect(err.status).toBe(1)
        expect(String(err.stdout ?? '')).not.toMatch(/WIVO1\./)
        expect(String(err.stderr ?? '')).toMatch(/No licence was made/)
      }
    }
  })

  it('--key stays a file key, and says so', () => {
    const out = execFileSync('node', [SCRIPT, 'sign', '--org', ORG, '--name', 'X', '--api', API,
      '--modules', 'jobs', '--key', KEY], { encoding: 'utf8' })
    expect(out).toMatch(/FILE key/)
  })

  it('renew signs on the key too', () => {
    const old = yk([])
    const renewed = execFileSync('node', [SCRIPT, 'renew', old, '--months', '6', '--quiet'],
      { encoding: 'utf8', env: env() }).trim()
    expect(verifies(renewed, 2)).toBe(true)
  })

  it('the serials and public keys in the tool are those pinned elsewhere', () => {
    const tool = readFileSync('scripts/make-license.mjs', 'utf8')
    const app = readFileSync('src/main/license.ts', 'utf8')
    const keys = readFileSync('scripts/yubikey/keys.mjs', 'utf8')
    for (const [letter, serial] of [['C', '38272295'], ['D', '38272284']]) {
      expect(keys).toContain(`${letter}: ${serial}`)
      expect(tool).toMatch(new RegExp(`${letter}: \\{ serial: ${serial}`))
    }
    for (const m of tool.matchAll(/pub: '([0-9a-f]{64})'/g)) expect(app).toContain(m[1])
    expect([...tool.matchAll(/pub: '([0-9a-f]{64})'/g)]).toHaveLength(2)
  })
})

/**
 * --publish --clinic <id>: the licence into the clinic's releases, where its
 * desktops take it (scripts/publish-licence.mjs, docs/RELEASE.md §7). A
 * stand-in gh (WIVO_GH) "uploads" into a folder that plays the public address
 * (WIVO_RELEASE_FEED_DIR); the clinic comes from a test clinics/ folder
 * (WIVO_CLINIC_ROOT) whose dentiks.json carries an orgId. The judging is the
 * app's own (shared/license/published).
 */
describe('publishing a licence to a clinic', () => {
  const DENTIKS_API = 'https://fwsrnsdrlrlmjfkkkhvp.supabase.co'
  const pubDir = mkdtempSync(join(tmpdir(), 'wivo-licence-publish-'))
  const FEED = join(pubDir, 'feed')
  const CLINICS = join(pubDir, 'root')
  const RELEASES = join(pubDir, 'releases')
  const GH_LOG = join(pubDir, 'gh.log')
  const FAKE_YK = join(pubDir, 'fake-ykman.mjs')
  const FAKE_GH = join(pubDir, 'fake-gh.mjs')
  const SEEN = join(pubDir, 'seen')
  afterAll(() => { rmSync(pubDir, { recursive: true, force: true }) })

  mkdirSync(FEED, { recursive: true })
  mkdirSync(join(CLINICS, 'clinics'), { recursive: true })
  const clinicFile = (extra: object) => writeFileSync(join(CLINICS, 'clinics', 'dentiks.json'), JSON.stringify({
    id: 'dentiks', name: 'Dentiks', releasesRepo: 'Wivodent/wivo-dentiks-releases', phoneUrl: 'https://wivo.dentiks.lv',
    supabaseRef: 'fwsrnsdrlrlmjfkkkhvp', cloudflareProject: 'wivo-dentiks', phoneBranch: 'riga', ...extra,
  }))
  writeFileSync(FAKE_YK, [
    "import { readFileSync, writeFileSync } from 'node:fs'",
    "import { createPrivateKey, sign } from 'node:crypto'",
    'const [, , , , , , , inFile, outFile] = process.argv',
    "const s = JSON.parse(readFileSync(inFile, 'utf8')).statements[0]",
    "writeFileSync(process.env.FAKE_SEEN, 'signed')",
    "writeFileSync(outFile, JSON.stringify({ signed: [{ id: s.id, signature_hex: sign(null, Buffer.from(s.hex, 'hex'), createPrivateKey(readFileSync(process.env.FAKE_KEY))).toString('hex') }] }))",
  ].join('\n'))
  writeFileSync(FAKE_GH, [
    "import { appendFileSync, copyFileSync } from 'node:fs'",
    "import { basename, join } from 'node:path'",
    'const a = process.argv.slice(2)',
    "appendFileSync(process.env.GH_LOG, JSON.stringify(a) + '\\n')",
    "if (a[0] === '--version') process.exit(0)",
    "if (a[0] === 'release' && a[1] === 'view') process.exit(process.env.FAKE_NO_RELEASE ? 1 : 0)",
    "if (a[0] === 'release' && a[1] === 'upload') { copyFileSync(a[3], join(process.env.WIVO_RELEASE_FEED_DIR, basename(a[3]))); process.exit(0) }",
    'process.exit(3)',
  ].join('\n'))

  const env = (extra: Record<string, string> = {}) => ({
    ...process.env, WIVO_YKMAN: FAKE_YK, FAKE_KEY: KEY, FAKE_SEEN: SEEN, WIVO_YUBIKEY_PUBLIC_FOR_TEST: PUBLIC_HEX,
    WIVO_GH: FAKE_GH, GH_LOG, WIVO_RELEASE_FEED_DIR: FEED, WIVO_CLINIC_ROOT: CLINICS, WIVO_RELEASE_ROOT: RELEASES, ...extra,
  })
  const tool = (args: string[], e = env()) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', env: e, stdio: ['ignore', 'pipe', 'pipe'] })
  const publish = (extra: string[] = [], e = env(), org = ORG) => tool(['sign', '--org', org, '--name', 'Dentiks',
    '--api', DENTIKS_API, '--modules', 'jobs,stock', '--quiet', '--publish', '--clinic', 'dentiks', ...extra], e)
  const refused = (fn: () => unknown): { said: string; stdout: string } => {
    try { fn() } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string }
      expect(err.status).not.toBe(0)
      return { said: String(err.stdout ?? '') + String(err.stderr ?? ''), stdout: String(err.stdout ?? '') }
    }
    throw new Error('it was published')
  }
  const published = () => JSON.parse(readFileSync(join(FEED, 'licence.json'), 'utf8'))
  const reset = (extra: object) => {
    for (const f of [join(FEED, 'licence.json'), SEEN, GH_LOG]) rmSync(f, { force: true })
    clinicFile(extra)
  }

  /** A token signed with the test key, as if published earlier. */
  const crafted = (p: object): string => {
    const b64 = Buffer.from(JSON.stringify(p)).toString('base64url')
    const sig = nodeSign(null, Buffer.from(signingInput(b64, 2)), createPrivateKey(readFileSync(KEY)))
    return `WIVO1.${b64}.${Buffer.from(sig).toString('base64url')}`
  }

  it('without an orgId in clinics/<id>.json: refused before the key is asked', () => {
    reset({})
    expect(refused(() => publish()).said).toMatch(/has no orgId/)
    expect(existsSync(SEEN)).toBe(false)
  })

  it('another organisation, or not this clinic\'s database: refused before the key is asked', () => {
    reset({ orgId: ORG })
    expect(refused(() => publish([], env(), '00000000-0000-4000-8000-000000000001')).said).toMatch(/is not Dentiks's organisation/)
    expect(refused(() => tool(['sign', '--org', ORG, '--name', 'D', '--api', API, '--modules', 'jobs', '--publish', '--clinic', 'dentiks'])).said)
      .toMatch(/does not name Dentiks's database/)
    expect(existsSync(SEEN)).toBe(false)
  })

  it('a file key, --publish without a clinic, --clinic without --publish: refused', () => {
    expect(refused(() => publish(['--key', KEY])).said).toMatch(/needs a YubiKey signature/)
    expect(refused(() => tool(['sign', '--org', ORG, '--name', 'D', '--api', API, '--modules', 'jobs', '--publish'])).said).toMatch(/--publish needs the clinic/)
    expect(refused(() => tool(['sign', '--org', ORG, '--name', 'D', '--api', API, '--modules', 'jobs', '--key', KEY, '--clinic', 'dentiks'])).said).toMatch(/goes with --publish/)
  })

  it('the right one: signed, judged, uploaded to the stable release, read back', () => {
    reset({ orgId: ORG })
    const token = publish().trim()
    expect(token).toMatch(/^WIVO1\.[^\s]+$/)
    expect(verifies(token, 2)).toBe(true)
    expect(published()).toEqual({ v: 1, clinic: 'dentiks', token })
    expect(readFileSync(join(RELEASES, 'licence', 'licence.json'), 'utf8')).toBe(readFileSync(join(FEED, 'licence.json'), 'utf8'))
    const gh = readFileSync(GH_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(gh.pop()).toEqual(['release', 'upload', 'stable', join(RELEASES, 'licence', 'licence.json'), '--repo', 'Wivodent/wivo-dentiks-releases', '--clobber'])
  })

  it('renew publishes too, keeping the organisation and address', () => {
    reset({ orgId: ORG })
    const old = crafted({ v: 2, name: 'Dentiks', plan: 'labor', seats: 5, iat: '2020-01-01', exp: '2021-01-01', org: ORG, api: [DENTIKS_API], modules: ['jobs'] })
    const token = tool(['renew', old, '--months', '12', '--quiet', '--publish', '--clinic', 'dentiks']).trim()
    expect(published().token).toBe(token)
  })

  it('a second one on the same day, or after a later one: refused, the published one stays', () => {
    reset({ orgId: ORG })
    publish()
    const first = published()
    // The same terms sign to the same token (Ed25519 is deterministic): already there.
    expect(publish().trim()).toBe(first.token)
    expect(refused(() => publish(['--seats', '9'])).said).toMatch(/not_newer/)
    expect(published()).toEqual(first)

    const later = crafted({ v: 2, name: 'Dentiks', plan: 'labor', seats: 5, iat: '2099-01-01', exp: '2100-01-01', org: ORG, api: [DENTIKS_API], modules: ['jobs'] })
    writeFileSync(join(FEED, 'licence.json'), JSON.stringify({ v: 1, clinic: 'dentiks', token: later }))
    expect(refused(() => publish()).said).toMatch(/issued 2099-01-01/)
  })

  it('terminate --publish: the end of the contract reaches the clinic\'s desktops', () => {
    reset({ orgId: ORG })
    const old = crafted({ v: 2, name: 'Dentiks', plan: 'labor', seats: 5, iat: '2020-01-01', exp: '2099-01-01', org: ORG, api: [DENTIKS_API], modules: ['jobs'] })
    writeFileSync(join(FEED, 'licence.json'), JSON.stringify({ v: 1, clinic: 'dentiks', token: old }))
    const said = execFileSync('node', [SCRIPT, 'terminate', old, '--publish', '--clinic', 'dentiks'], { encoding: 'utf8', env: env(), stdio: ['ignore', 'pipe', 'pipe'] })
    const token = said.trim().split('\n').filter(l => l.startsWith('WIVO1.')).pop()!
    expect(published().token).toBe(token)
    expect(payloadOf(token)).toMatchObject({ iat: fromToday(0), exp: fromToday(14), org: ORG, api: [DENTIKS_API], modules: ['jobs'] })
  })

  it('no stable release in the repository yet: not uploaded, and the token is still printed', () => {
    reset({ orgId: ORG })
    const r = refused(() => publish([], env({ FAKE_NO_RELEASE: '1' })))
    expect(r.said).toMatch(/has no release "stable" yet/)
    expect(r.stdout).toMatch(/^WIVO1\./)
    expect(existsSync(join(FEED, 'licence.json'))).toBe(false)
  })
})
