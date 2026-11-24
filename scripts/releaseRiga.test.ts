/**
 * Riga's release tool (scripts/release-riga.mjs, docs/RELEASE.md), end to end
 * with made-up keys: a stand-in for `ykman` (WIVO_YKMAN) signs with test keys,
 * a stand-in for `gh` (WIVO_GH) "publishes" into a folder that plays the
 * public address (WIVO_RELEASE_FEED_DIR). Everything else is the real code:
 * the statements the key is asked to sign, the check before anything is
 * written, and the app's own check of what was published
 * (src/main/releaseCheck.ts verifyDownloadedApp).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, sign as nodeSign } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  encode, listAddress, sha256Hex, signedText, statement, updateSourcesFor, type Fetcher, type RootKey,
} from '../shared/release/release'
import { ROOT_A_CERTIFICATES } from '../shared/release/certificates'
import { verifyDownloadedApp, type ReleaseCheckDeps } from '../src/main/releaseCheck'
// @ts-expect-error plain .mjs without types
import { RIGA_REPO, certificatePayload, keysFor, latestYml, listDays, migrationFiles, migrationsAfter, uploadPlan, versionProblem } from './release-riga-lib.mjs'
import { compareVersions } from '../shared/release/release'

const SCRIPT = 'scripts/release-riga.mjs'
const SOURCE = updateSourcesFor('riga')[0]
const dir = mkdtempSync(join(tmpdir(), 'wivo-release-riga-'))
const RELEASES = join(dir, 'releases')
const FEED = join(dir, 'feed')
const SEEN = join(dir, 'seen.json')
const GH_LOG = join(dir, 'gh.log')
const VERSION = '2.0.5'
const FILE = `Wivo-Riga-Setup-${VERSION}.exe`
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

function pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const der = publicKey.export({ type: 'spki', format: 'der' })
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    pub: Buffer.from(der.subarray(der.length - 32)).toString('base64url'),
    sign: async (b: Uint8Array) => new Uint8Array(nodeSign(null, Buffer.from(b), privateKey)),
  }
}
const root = pair(), update = pair(), appKey = pair(), stranger = pair()
let roots: RootKey[]

// The stand-in ykman: setup-device.py `sign`'s file format, the test key of each slot.
const FAKE_YKMAN = join(dir, 'fake-ykman.mjs')
writeFileSync(FAKE_YKMAN, `
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { createPrivateKey, sign } from 'node:crypto'
const [, , , , py, step, serial, inFile, outFile] = process.argv
const job = JSON.parse(readFileSync(inFile, 'utf8'))
appendFileSync(process.env.FAKE_SEEN, JSON.stringify({ py, step, serial, job }) + '\\n')
if (process.env.FAKE_MODE === 'refuse') { process.stderr.write('Refused (6982).\\n'); process.exit(2) }
const keyOf = slot => process.env.FAKE_MODE === 'wrongkey' ? process.env.FAKE_STRANGER : slot === '9c' ? process.env.FAKE_UPDATE : process.env.FAKE_APP
const signed = job.statements.map(s => ({ id: s.id, signature_hex: sign(null, Buffer.from(s.hex, 'hex'), createPrivateKey(keyOf(s.slot))).toString('hex') }))
writeFileSync(outFile, JSON.stringify({ signed }))
`)

// The stand-in gh: an upload lands in the folder that plays the public address.
const FAKE_GH = join(dir, 'fake-gh.mjs')
writeFileSync(FAKE_GH, `
import { appendFileSync, copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
const a = process.argv.slice(2)
appendFileSync(process.env.GH_LOG, JSON.stringify(a) + '\\n')
if (a[0] === '--version') process.exit(0)
const made = join(process.env.WIVO_RELEASE_FEED_DIR, '.release-made')
if (a[0] === 'release' && a[1] === 'view') process.exit(existsSync(made) ? 0 : 1)
if (a[0] === 'release' && a[1] === 'create') { writeFileSync(made, ''); process.exit(0) }
if (a[0] === 'release' && a[1] === 'upload') {
  for (const f of a.slice(3, a.indexOf('--repo'))) copyFileSync(f, join(process.env.WIVO_RELEASE_FEED_DIR, basename(f)))
  process.exit(0)
}
process.exit(3)
`)

const TRUST = join(dir, 'trust.json')
const env = (mode = 'ok') => ({
  ...process.env, WIVO_YKMAN: FAKE_YKMAN, WIVO_GH: FAKE_GH, WIVO_RELEASE_ROOT: RELEASES, WIVO_RELEASE_FEED_DIR: FEED,
  WIVO_RELEASE_TEST_TRUST: TRUST, FAKE_SEEN: SEEN, FAKE_MODE: mode, GH_LOG,
  FAKE_UPDATE: update.pem, FAKE_APP: appKey.pem, FAKE_STRANGER: stranger.pem,
})
function run(args: string[], mode = 'ok'): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: env(mode), stdio: ['ignore', 'pipe', 'pipe'] })
}
function refusal(args: string[], mode = 'ok'): string {
  try { run(args, mode) } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string }
    expect(err.status).not.toBe(0)
    return String(err.stdout ?? '') + String(err.stderr ?? '')
  }
  throw new Error('the tool did not refuse')
}
const seen = () => readFileSync(SEEN, 'utf8').trim().split('\n').map(l => JSON.parse(l)).pop()

const installer = () => join(RELEASES, VERSION, FILE)
function makeRelease(over: Record<string, unknown> = {}) {
  rmSync(join(RELEASES, VERSION), { recursive: true, force: true })
  mkdirSync(join(RELEASES, VERSION), { recursive: true })
  const bytes = Buffer.from('pretend this is Riga\'s installer')
  writeFileSync(installer(), bytes)
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  writeFileSync(join(RELEASES, VERSION, 'latest.yml'), latestYml({ version: VERSION, file: FILE, sha512, size: bytes.length, releaseDate: '2026-11-25T06:00:00Z' }))
  writeFileSync(join(RELEASES, VERSION, 'release.json'), JSON.stringify({
    build: 'riga', version: VERSION, file: FILE, blockmap: null, size: bytes.length, sha512,
    sha256: createHash('sha256').update(bytes).digest('hex'), commit: 'a'.repeat(40), schema: '125_mail_quota.sql',
    new_migrations: [], first: true, previous: null, built_at: '2026-11-25T06:00:00Z', ...over,
  }))
}

/** The app's own check of what is in the feed folder, as a Riga desktop on `running` would run it. */
const appCheck = (over: Partial<ReleaseCheckDeps> = {}, listFile = join(FEED, 'updates.json')) => verifyDownloadedApp(installer(), VERSION, {
  pinned: roots, sources: [SOURCE], floorPath: join(dir, 'floor.json'), now: () => new Date(), channel: 'stable', build: 'riga', running: '2.0.4',
  fetch: (async (url, max) => {
    if (url !== listAddress(SOURCE, 'stable')) return null
    const p = listFile
    return existsSync(p) && readFileSync(p).length <= max ? new Uint8Array(readFileSync(p)) : null
  }) as Fetcher,
  ...over,
})

beforeAll(async () => {
  roots = [{ id: 'root-test', publicKey: root.pub }]
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
  const cert = (id: string, k: { pub: string }, purpose: 'update' | 'app') => encode('certificate', {
    v: 1, key_id: id, public_key: k.pub, purpose, not_before: day(-1), not_after: day(365), root_id: 'root-test',
  }, root.sign)
  writeFileSync(TRUST, JSON.stringify({ roots, certificates: [await cert('update-C-test', update, 'update'), await cert('app-C-test', appKey, 'app')] }))
  mkdirSync(FEED, { recursive: true })
})

describe('signing a release (npm run release:riga:sign)', () => {
  it('refuses the first release without --first in the build, and a changed installer', () => {
    makeRelease({ first: false })
    expect(refusal(['sign', '--version', VERSION])).toMatch(/nothing is published/)
    makeRelease()
    writeFileSync(installer(), 'another file')
    expect(refusal(['sign', '--version', VERSION])).toMatch(/has changed since it was built/)
    expect(existsSync(join(RELEASES, VERSION, 'updates.json'))).toBe(false)
  })

  it('writes nothing when the key refuses, or when the signature is from another key', () => {
    makeRelease()
    expect(refusal(['sign', '--version', VERSION], 'refuse')).toMatch(/did not sign/)
    expect(refusal(['sign', '--version', VERSION], 'wrongkey')).toMatch(/does not verify against update-C-test/)
    expect(existsSync(join(RELEASES, VERSION, 'updates.json'))).toBe(false)
  })

  it('asks before signing a release that needs migrations, and refuses without a yes', () => {
    makeRelease({ new_migrations: ['126_x.sql'] })
    expect(refusal(['sign', '--version', VERSION])).toMatch(/apply them first/)
    expect(existsSync(join(RELEASES, VERSION, 'updates.json'))).toBe(false)
  })

  it('YubiKey C signs the list (slot 9c) and the statement (slot 82), and the app accepts the result', async () => {
    makeRelease({ new_migrations: ['126_x.sql'] })
    run(['sign', '--version', VERSION, '--migrations-applied'])
    const s = seen()
    expect(s.step).toBe('sign')
    expect(s.py).toMatch(/scripts[\\/]yubikey[\\/]setup-device\.py$/)
    expect(s.serial).toBe('38272295') // C
    expect(s.job.statements.map((x: { id: string; slot: string }) => [x.id, x.slot])).toEqual([['index', '9c'], ['app', '82']])
    expect(await appCheck({}, join(RELEASES, VERSION, 'updates.json'))).toEqual({ ok: true, checked: true, schema: '125_mail_quota.sql' })
  })

  it('the key signed exactly the bytes the app verifies', async () => {
    const list = JSON.parse(readFileSync(join(RELEASES, VERSION, 'updates.json'), 'utf8'))
    const asked = Object.fromEntries(seen().job.statements.map((x: { id: string; hex: string }) => [x.id, x.hex]))
    for (const [kind, token] of [['index', list.index], ['app', list.app]] as const) {
      const payloadB64 = token.split('.')[1]
      const expected = statement(kind, await sha256Hex(signedText(kind, payloadB64)))
      expect(asked[kind], kind).toBe(Buffer.from(expected).toString('hex'))
    }
    const app = JSON.parse(Buffer.from(list.app.split('.')[1], 'base64url').toString('utf8'))
    expect(app).toMatchObject({ build: 'riga', version: VERSION, file: FILE, key_id: 'app-C-test', schema: '125_mail_quota.sql' })
    const index = JSON.parse(Buffer.from(list.index.split('.')[1], 'base64url').toString('utf8'))
    expect(index).toMatchObject({ channel: 'stable', serial: 1, key_id: 'update-C-test', app: { version: VERSION, file: FILE } })
    expect(Date.parse(index.expires) - Date.parse(index.generated_at)).toBe(14 * 86_400_000)
  })
})

describe('publishing it (npm run release:riga:publish)', () => {
  it('uploads to Riga\'s own repository, the list before latest.yml, and reads it back', () => {
    const out = run(['publish', '--version', VERSION])
    expect(out).toMatch(/Published: Wivo 2\.0\.5 for Riga/)
    expect(out).toContain(`git push origin ${'a'.repeat(40)}:refs/heads/riga`)
    const calls = readFileSync(GH_LOG, 'utf8').trim().split('\n').map(l => JSON.parse(l) as string[])
    const uploads = calls.filter(c => c[1] === 'upload').map(c => c.slice(3, c.indexOf('--repo')).map(p => p.split(/[\\/]/).pop()))
    expect(uploads).toEqual([[FILE], ['updates.json'], ['latest.yml']])
    for (const c of calls.filter(c => c[0] === 'release')) {
      expect(c[c.indexOf('--repo') + 1]).toBe(RIGA_REPO)
      expect(c).not.toContain('SniperInSuit/Wivo')
    }
    expect(calls.find(c => c[1] === 'create')).toBeTruthy()
  })

  it('what is published installs on Riga\'s desktop, and on nothing else', async () => {
    expect((await appCheck()).ok).toBe(true)
    expect(await appCheck({ build: 'main' })).toEqual({ ok: false, reason: 'wrong_build' })
    expect(await appCheck({ running: VERSION })).toEqual({ ok: false, reason: 'not_newer' })
    expect(await appCheck({ pinned: [{ id: 'root-test', publicKey: stranger.pub }] })).toMatchObject({ ok: false })
  })

  it('refuses a list whose signature was changed', () => {
    const p = join(RELEASES, VERSION, 'updates.json')
    const good = readFileSync(p, 'utf8')
    const list = JSON.parse(good)
    const sig = list.app.split('.')[2]
    list.app = `${list.app.split('.').slice(0, 2).join('.')}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`
    writeFileSync(p, JSON.stringify(list))
    rmSync(join(FEED, 'updates.json'))
    expect(refusal(['publish', '--version', VERSION])).toMatch(/does not pass the app's own check \(bad_signature\)/)
    writeFileSync(p, good)
    run(['publish', '--version', VERSION])
  })

  it('the same version again is refused: it must rise', () => {
    makeRelease({ first: false })
    expect(refusal(['sign', '--version', VERSION])).toMatch(/the version must rise: 2\.0\.5 is published/)
  })
})

describe('a new list for the published release (--refresh)', () => {
  it('one touch on the update key, the next serial, and the app still accepts it after the old one', async () => {
    rmSync(join(dir, 'floor.json'), { force: true })
    makeRelease() // the same bytes as published: the app checks them against the list
    expect((await appCheck()).ok).toBe(true) // remembers serial 1
    run(['sign', '--refresh', '--days', '30'])
    expect(seen().job.statements.map((x: { slot: string }) => x.slot)).toEqual(['9c'])
    run(['publish', '--refresh'])
    const index = JSON.parse(Buffer.from(JSON.parse(readFileSync(join(FEED, 'updates.json'), 'utf8')).index.split('.')[1], 'base64url').toString('utf8'))
    expect(index.serial).toBe(2)
    expect(Date.parse(index.expires) - Date.parse(index.generated_at)).toBe(30 * 86_400_000)
    expect((await appCheck()).ok).toBe(true)
  })

  it('refuses a list valid for more than 30 days', () => {
    expect(refusal(['sign', '--refresh', '--days', '31'])).toMatch(/1 to 30/)
  })
})

describe('the parts', () => {
  it('YubiKey C and D: their update and app keys, from root A\'s certificates', () => {
    const payloads = ROOT_A_CERTIFICATES.map(certificatePayload)
    expect(keysFor('C', payloads)).toMatchObject({ update: { id: 'update-C-cfbcf4eb' }, app: { id: 'app-C-c17eb189' } })
    expect(keysFor('D', payloads)).toMatchObject({ update: { id: 'update-D-f02808a2' }, app: { id: 'app-D-22a3e357' } })
    expect(keysFor('A', payloads)).toBeNull()
  })

  it('latest.yml is electron-updater\'s feed for this one file', () => {
    expect(latestYml({ version: '2.0.5', file: FILE, sha512: 'abc==', size: 10, releaseDate: '2026-11-25T06:00:00Z' }))
      .toBe(`version: 2.0.5\nfiles:\n  - url: ${FILE}\n    sha512: abc==\n    size: 10\npath: ${FILE}\nsha512: abc==\nreleaseDate: '2026-11-25T06:00:00Z'\n`)
  })

  it('the migrations since the last release, by number', () => {
    const files = migrationFiles(['125_mail_quota.sql', '009_a.sql', 'README.md', '126_b.sql', '124_c.sql'])
    expect(files).toEqual(['009_a.sql', '124_c.sql', '125_mail_quota.sql', '126_b.sql'])
    expect(migrationsAfter(files, '124_c.sql')).toEqual(['125_mail_quota.sql', '126_b.sql'])
    expect(migrationsAfter(files, null)).toEqual([])
  })

  it('the version must rise; the list lives 1 to 30 days', () => {
    expect(versionProblem(null, '2.0.5', compareVersions)).toBeNull()
    expect(versionProblem('2.0.4', '2.0.5', compareVersions)).toBeNull()
    expect(versionProblem('2.0.5', '2.0.5', compareVersions)).toMatch(/must rise/)
    expect(versionProblem('2.0.10', '2.0.9', compareVersions)).toMatch(/must rise/)
    expect(listDays(undefined)).toBe(14)
    expect(() => listDays('31')).toThrow()
    expect(() => listDays('0')).toThrow()
  })

  it('uploads the installer, then the list, then latest.yml, always to Riga\'s repository', () => {
    const plan = uploadPlan({ installer: 'a.exe', blockmap: 'a.exe.blockmap', list: 'updates.json', feed: 'latest.yml' }) as string[][]
    expect(plan.map(c => c.slice(3, c.indexOf('--repo')))).toEqual([['a.exe', 'a.exe.blockmap'], ['updates.json'], ['latest.yml']])
    for (const c of plan) expect(c.slice(-3)).toEqual(['--repo', 'SniperInSuit/wivo-riga-releases', '--clobber'])
  })
})
