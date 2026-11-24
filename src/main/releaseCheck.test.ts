/**
 * The desktop's check of an app update before it installs (releaseCheck.ts):
 * a real file on disk, made-up keys signing made-up releases, and a stand-in
 * for the network.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { b64urlEncode, encode, listAddress, type Fetcher, type RootKey, type Signer } from '../../shared/release/release'
import { buildOf, feedUrlFor, verifyDownloadedApp, type ReleaseCheckDeps } from './releaseCheck'

async function key(): Promise<{ publicKey: string; sign: Signer }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  return {
    publicKey: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    sign: async b => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(b))),
  }
}

const SOURCE = 'https://updates.test/wivo'
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const dir = mkdtempSync(join(tmpdir(), 'wivo-release-check-'))
const installer = join(dir, 'Wivo Setup 2.3.0.exe')
const floorPath = join(dir, 'release-floor.json')
let pinned: RootKey[]
let files: Map<string, Uint8Array>
let publish: (serial: number, sha512?: string, build?: string) => Promise<void>

beforeAll(async () => {
  writeFileSync(installer, 'pretend this is an installer')
  const sha512 = createHash('sha512').update(readFileSync(installer)).digest('base64')
  const size = readFileSync(installer).length
  const [root, update, appKey] = [await key(), await key(), await key()]
  pinned = [{ id: 'root-a', publicKey: root.publicKey }]
  const cert = (id: string, k: { publicKey: string }, purpose: 'update' | 'app') => encode('certificate', {
    v: 1, key_id: id, public_key: k.publicKey, purpose, not_before: day(-1), not_after: day(365), root_id: 'root-a',
  }, root.sign)
  const certificates = [await cert('update-c', update, 'update'), await cert('app-c', appKey, 'app')]
  files = new Map()
  publish = async (serial, listedSha = sha512, build) => {
    const index = await encode('index', {
      v: 1, key_id: 'update-c', channel: 'stable', serial, generated_at: day(0), expires: day(14),
      versions: [], withdrawn: [], revocations: [], app: { version: '2.3.0', file: 'Wivo Setup 2.3.0.exe', sha512: listedSha, size },
    }, update.sign)
    const app = await encode('app', {
      v: 1, key_id: 'app-c', version: '2.3.0', file: 'Wivo Setup 2.3.0.exe', sha512: listedSha, size, created_at: day(-1),
      ...(build ? { build, schema: '125_mail_quota.sql' } : {}),
    }, appKey.sign)
    files.set(listAddress(SOURCE, 'stable'), new TextEncoder().encode(JSON.stringify({ index, certificates, app })))
  }
})

const deps = (over: Partial<ReleaseCheckDeps> = {}): ReleaseCheckDeps => ({
  pinned, sources: [SOURCE], floorPath, now: () => new Date(), channel: 'stable', build: 'main', running: '2.2.0',
  fetch: (async (url, max) => { const b = files.get(url); return b && b.length <= max ? b : null }) as Fetcher,
  ...over,
})

describe('an app update, before it installs', () => {
  it('before the root keys are pinned, there is nothing to check against: it installs as before, unchecked', async () => {
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ pinned: [] }))).toEqual({ ok: true, checked: false })
  })

  it('the release Wivo signed, byte for byte: it installs, and the list\'s serial is remembered', async () => {
    await publish(5)
    expect(await verifyDownloadedApp(installer, '2.3.0', deps())).toEqual({ ok: true, checked: true })
    expect(JSON.parse(readFileSync(floorPath, 'utf-8'))['update-c'].serial).toBe(5)
  })

  it('a file other than the one signed: refused', async () => {
    await publish(6, createHash('sha512').update('another file').digest('base64'))
    expect(await verifyDownloadedApp(installer, '2.3.0', deps())).toEqual({ ok: false, reason: 'not_this_release' })
  })

  it('an older list than one this desktop already accepted: refused', async () => {
    await publish(7)
    expect((await verifyDownloadedApp(installer, '2.3.0', deps())).ok).toBe(true)
    await publish(4)
    expect(await verifyDownloadedApp(installer, '2.3.0', deps())).toEqual({ ok: false, reason: 'rollback' })
  })

  it('nowhere to check, or a file that can\'t be read: refused', async () => {
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ sources: [] }))).toEqual({ ok: false, reason: 'no_source' })
    expect(await verifyDownloadedApp(join(dir, 'missing.exe'), '2.3.0', deps())).toEqual({ ok: false, reason: 'unreadable' })
    expect(existsSync(floorPath)).toBe(true)
  })

  it('the same or an older version than the running one: refused, even when signed', async () => {
    await publish(20)
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ running: '2.3.0' }))).toEqual({ ok: false, reason: 'not_newer' })
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ running: '2.10.0' }))).toEqual({ ok: false, reason: 'not_newer' })
    expect(await verifyDownloadedApp(installer, 'not-a-version', deps())).toEqual({ ok: false, reason: 'not_newer' })
  })

  it("a clinic's desktop installs a release signed for its clinic, and refuses main's and another clinic's", async () => {
    await publish(21)
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ build: 'dentiks' }))).toEqual({ ok: false, reason: 'wrong_build' })
    await publish(22, undefined, 'dentiks')
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ build: 'dentiks' })))
      .toEqual({ ok: true, checked: true, schema: '125_mail_quota.sql' })
    // and main's desktop, or another clinic's, refuses Dentiks's
    await publish(23, undefined, 'dentiks')
    expect(await verifyDownloadedApp(installer, '2.3.0', deps())).toEqual({ ok: false, reason: 'wrong_build' })
    expect(await verifyDownloadedApp(installer, '2.3.0', deps({ build: 'another-clinic' }))).toEqual({ ok: false, reason: 'wrong_build' })
  })
})

describe('which build, and where it reads its updates (docs/RELEASE.md)', () => {
  it("only a plain id is a build; anything else is main's", () => {
    expect(buildOf('dentiks')).toBe('dentiks')
    expect(buildOf(undefined)).toBe('main')
    expect(buildOf('')).toBe('main')
    expect(buildOf('../dentiks')).toBe('main')
  })

  it("a clinic's feed is the stable release of its own repository; main keeps package.json's", () => {
    const own = 'https://github.com/Wivodent/wivo-dentiks-releases/releases/download'
    expect(feedUrlFor('dentiks', own)).toBe(`${own}/stable`)
    expect(feedUrlFor('main', own)).toBeNull()
    expect(feedUrlFor('dentiks', null)).toBeNull()
  })
})
