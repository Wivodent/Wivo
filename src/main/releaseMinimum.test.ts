/**
 * The minimum desktop version from the signed list (releaseMinimum.ts,
 * docs/RELEASE.md §6a): made-up keys signing made-up lists, and a stand-in
 * for the network. What it decides: which lists count, what is kept between
 * starts, and that a list it can't read changes nothing.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { b64urlEncode, encode, listAddress, type Fetcher, type RootKey, type Signer } from '../../shared/release/release'
import { checkReleaseMinimum, isBelow, storedMinimum, type MinimumDeps } from './releaseMinimum'

async function key(): Promise<{ publicKey: string; sign: Signer }> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  return {
    publicKey: b64urlEncode(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))),
    sign: async b => new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(b))),
  }
}

const SOURCE = 'https://updates.test/dentiks'
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString()
const dir = mkdtempSync(join(tmpdir(), 'wivo-release-minimum-'))
const statePath = join(dir, 'release-minimum.json')
const floorPath = join(dir, 'release-floor.json')
let pinned: RootKey[]
let files: Map<string, Uint8Array>
let publish: (o: { serial: number; min?: unknown; build?: string; expires?: string; app?: boolean }) => Promise<void>

beforeAll(async () => {
  const [root, update, appKey] = [await key(), await key(), await key()]
  pinned = [{ id: 'root-a', publicKey: root.publicKey }]
  const cert = (id: string, k: { publicKey: string }, purpose: 'update' | 'app') => encode('certificate', {
    v: 1, key_id: id, public_key: k.publicKey, purpose, not_before: day(-1), not_after: day(365), root_id: 'root-a',
  }, root.sign)
  const certificates = [await cert('update-c', update, 'update'), await cert('app-c', appKey, 'app')]
  const release = { version: '2.2.1', file: 'Wivo-dentiks-Setup-2.2.1.exe', sha512: 'x', size: 10 }
  files = new Map()
  publish = async ({ serial, min, build = 'dentiks', expires = day(14), app = true }) => {
    const index = await encode('index', {
      v: 1, key_id: 'update-c', channel: 'stable', serial, generated_at: day(0), expires,
      versions: [], withdrawn: [], revocations: [], app: release,
      ...(min !== undefined ? { min_version: min as string } : {}),
    }, update.sign)
    const statement = await encode('app', { v: 1, key_id: 'app-c', ...release, created_at: day(0), build }, appKey.sign)
    files.set(listAddress(SOURCE, 'stable'), new TextEncoder().encode(JSON.stringify({ index, certificates, ...(app ? { app: statement } : {}) })))
  }
})

beforeEach(() => {
  rmSync(statePath, { force: true })
  rmSync(floorPath, { force: true })
  files.clear()
})

const deps = (over: Partial<MinimumDeps> = {}): MinimumDeps => ({
  pinned, sources: [SOURCE], channel: 'stable', build: 'dentiks', statePath, floorPath, now: () => new Date(),
  fetch: (async (url, max) => { const b = files.get(url); return b && b.length <= max ? b : null }) as Fetcher,
  ...over,
})

describe('the minimum version, from the signed list', () => {
  it('a valid list with a minimum: kept, with the serial it came from, and remembered for the update check', async () => {
    await publish({ serial: 3, min: '2.2.1' })
    expect(await checkReleaseMinimum(deps())).toEqual({ changed: true, minimum: '2.2.1' })
    expect(storedMinimum(statePath)).toMatchObject({ min_version: '2.2.1', key_id: 'update-c', serial: 3 })
    expect(JSON.parse(readFileSync(floorPath, 'utf-8'))['update-c'].serial).toBe(3)
    expect(await checkReleaseMinimum(deps())).toEqual({ changed: false, minimum: '2.2.1' })
  })

  it('a list that cannot be read, has expired or is not Wivo\'s: the kept minimum stays', async () => {
    await publish({ serial: 3, min: '2.2.1' })
    await checkReleaseMinimum(deps())
    files.clear()
    expect(await checkReleaseMinimum(deps())).toEqual({ refused: 'unreachable' })
    await publish({ serial: 4, min: null as unknown as string, expires: day(-1) })
    expect(await checkReleaseMinimum(deps())).toEqual({ refused: 'expired' })
    await publish({ serial: 5 })
    expect(await checkReleaseMinimum(deps({ pinned: [{ id: 'root-a', publicKey: pinned[0].publicKey.replace(/^./, c => (c === 'A' ? 'B' : 'A')) }] }))).toMatchObject({ refused: expect.any(String) })
    expect(storedMinimum(statePath)?.min_version).toBe('2.2.1')
  })

  it('an older list than one already accepted: refused, the minimum stays (no rolling back to unlock)', async () => {
    await publish({ serial: 7, min: '2.2.1' })
    await checkReleaseMinimum(deps())
    await publish({ serial: 6 })
    expect(await checkReleaseMinimum(deps())).toEqual({ refused: 'rollback' })
    expect(storedMinimum(statePath)?.min_version).toBe('2.2.1')
  })

  it('a newer list lowers it or takes it away', async () => {
    await publish({ serial: 3, min: '2.2.1' })
    await checkReleaseMinimum(deps())
    await publish({ serial: 4, min: '2.2.0' })
    expect(await checkReleaseMinimum(deps())).toEqual({ changed: true, minimum: '2.2.0' })
    await publish({ serial: 5 })
    expect(await checkReleaseMinimum(deps())).toEqual({ changed: true, minimum: null })
    expect(storedMinimum(statePath)?.min_version).toBeNull()
  })

  it('a list for another clinic\'s build, or main\'s, or with no release statement, sets nothing', async () => {
    await publish({ serial: 3, min: '2.2.1', build: 'another-clinic' })
    expect(await checkReleaseMinimum(deps())).toEqual({ refused: 'wrong_build' })
    await publish({ serial: 3, min: '2.2.1', app: false })
    expect(await checkReleaseMinimum(deps())).toEqual({ refused: 'no_app_release' })
    expect(storedMinimum(statePath)).toBeNull()
  })

  it('a minimum that is not x.y.z asks nothing, rather than refusing the list', async () => {
    await publish({ serial: 3, min: 'soon' })
    expect(await checkReleaseMinimum(deps())).toEqual({ changed: false, minimum: null })
  })

  it('no pinned roots or no source: nothing to check, no minimum', async () => {
    await publish({ serial: 3, min: '2.2.1' })
    expect(await checkReleaseMinimum(deps({ pinned: [] }))).toEqual({ refused: 'not_pinned' })
    expect(await checkReleaseMinimum(deps({ sources: [] }))).toEqual({ refused: 'no_source' })
    expect(storedMinimum(statePath)).toBeNull()
  })

  it('a kept file that is broken counts as none', () => {
    writeFileSync(statePath, '{not json')
    expect(storedMinimum(statePath)).toBeNull()
    writeFileSync(statePath, JSON.stringify({ min_version: '2.x', key_id: 'update-c', serial: 1 }))
    expect(storedMinimum(statePath)?.min_version).toBeNull()
  })

  it('below: compared as numbers; an unreadable running version is never locked', () => {
    expect(isBelow('2.2.0', '2.2.1')).toBe(true)
    expect(isBelow('2.2.1', '2.2.1')).toBe(false)
    expect(isBelow('2.10.0', '2.9.0')).toBe(false)
    expect(isBelow('2.2.0', null)).toBe(false)
    expect(isBelow('dev', '2.2.1')).toBe(false)
  })
})
