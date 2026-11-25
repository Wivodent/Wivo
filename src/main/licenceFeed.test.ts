/**
 * The app's side of a delivered licence (src/main/licenceFeed.ts): where it
 * looks, what it installs, and that a refusal leaves the installed licence
 * alone. The rules themselves are tested in shared/license/published.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify } from 'node:crypto'
import { encodePayload, parseToken, signingInput, type LicencePayload } from '../../shared/license/token'
import { licenceFileText } from '../../shared/license/published'
import { checkPublishedLicence, licenceAddress, type LicenceFeedDeps } from './licenceFeed'

const SOURCE = 'https://github.com/Wivodent/wivo-dentiks-releases/releases/download'
const ORG = '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'
const API = 'https://fwsrnsdrlrlmjfkkkhvp.supabase.co'
const keys = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')

const tokenOf = (p: LicencePayload, key = keys.privateKey): string => {
  const b64 = encodePayload(p)
  return `WIVO1.${b64}.${Buffer.from(nodeSign(null, Buffer.from(signingInput(b64, p.v)), key)).toString('base64url')}`
}
const verify = (token: string): LicencePayload | null => {
  const t = parseToken(token)
  return t && nodeVerify(null, Buffer.from(signingInput(t.payloadB64, t.payload.v)), keys.publicKey, Buffer.from(t.signature)) ? t.payload : null
}

const old: LicencePayload = { v: 2, name: 'Dentiks', plan: 'labor', seats: 5, iat: '2026-01-10', exp: '2027-01-10', org: ORG, api: [API], modules: ['jobs'] }
const renewed: LicencePayload = { ...old, seats: 10, iat: '2026-11-24', exp: '2027-11-24', modules: ['jobs', 'stock'] }

/** A machine with `old` installed, and a release that holds `published` (null: no licence.json). */
function machine(published: string | null, o: Partial<LicenceFeedDeps> = {}) {
  let file: { token: string; payload: LicencePayload } | null = { token: tokenOf(old), payload: old }
  const asked: string[] = []
  const deps: LicenceFeedDeps = {
    source: SOURCE, build: 'dentiks', buildOrg: ORG, api: API, enforced: true, verify,
    fetch: async (url, max) => { asked.push(`${url} ${max}`); return published === null ? null : new TextEncoder().encode(published) },
    installed: () => file,
    install: token => { const p = verify(token); if (!p) return false; file = { token, payload: p }; return true },
    now: () => new Date('2026-11-24T12:00:00Z'),
    ...o,
  }
  return { deps, asked, installed: () => file }
}

describe('the licence published with the updates', () => {
  it('is read from the stable release, next to updates.json', async () => {
    const m = machine(null)
    await checkPublishedLicence(m.deps)
    expect(licenceAddress(SOURCE)).toBe(`${SOURCE}/stable/licence.json`)
    expect(m.asked).toEqual([`${SOURCE}/stable/licence.json 16384`])
  })

  it('the right one is installed, and what changed is reported', async () => {
    const m = machine(licenceFileText('dentiks', tokenOf(renewed)))
    const r = await checkPublishedLicence(m.deps)
    expect(r).toEqual({ installed: { at: '2026-11-24T12:00:00.000Z', from: old, to: renewed } })
    expect(m.installed()?.payload).toEqual(renewed)
  })

  it('a wrong signature, another clinic\'s organisation, an older date: refused, the licence stays', async () => {
    const cases: [string, string][] = [
      [tokenOf(renewed, stranger.privateKey), 'bad_signature'],
      [tokenOf({ ...renewed, org: '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d' }), 'other_org'],
      [tokenOf({ ...renewed, iat: '2025-06-01' }), 'not_newer'],
    ]
    for (const [token, reason] of cases) {
      const m = machine(licenceFileText('dentiks', token))
      expect(await checkPublishedLicence(m.deps), reason).toEqual({ refused: reason })
      expect(m.installed()?.payload).toEqual(old)
    }
  })

  it('the end of a contract (make-license.mjs terminate): issued later, it replaces the old one though it ends sooner', async () => {
    const ended: LicencePayload = { ...old, iat: '2026-11-24', exp: '2026-12-08' }
    expect(ended.exp < old.exp).toBe(true)
    const m = machine(licenceFileText('dentiks', tokenOf(ended)))
    expect(await checkPublishedLicence(m.deps)).toEqual({ installed: { at: '2026-11-24T12:00:00.000Z', from: old, to: ended } })
    expect(m.installed()?.payload).toEqual(ended)
    // An older token re-published by mistake cannot bring the longer licence back.
    const again = machine(licenceFileText('dentiks', tokenOf(old)), { installed: () => ({ token: tokenOf(ended), payload: ended }) })
    expect(await checkPublishedLicence(again.deps)).toEqual({ refused: 'not_newer' })
  })

  it('no licence.json: nothing changes', async () => {
    const m = machine(null)
    expect(await checkPublishedLicence(m.deps)).toEqual({ refused: 'missing' })
    expect(m.installed()?.payload).toEqual(old)
  })

  it("the build's organisation decides, not the installed licence's", async () => {
    const m = machine(licenceFileText('dentiks', tokenOf(renewed)), { buildOrg: '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d' })
    expect(await checkPublishedLicence(m.deps)).toEqual({ refused: 'other_org' })
  })

  it('a build without one compares with the installed licence; with neither, nothing is taken', async () => {
    expect('installed' in await checkPublishedLicence(machine(licenceFileText('dentiks', tokenOf(renewed)), { buildOrg: null }).deps)).toBe(true)
    const bare = machine(licenceFileText('dentiks', tokenOf(renewed)), { buildOrg: null, installed: () => null })
    expect(await checkPublishedLicence(bare.deps)).toEqual({ refused: 'no_org' })
  })

  it('a new machine with no licence takes it, by the build\'s organisation', async () => {
    let stored: string | null = null
    const m = machine(licenceFileText('dentiks', tokenOf(renewed)), { installed: () => null, install: t => { stored = t; return true } })
    expect(await checkPublishedLicence(m.deps)).toMatchObject({ installed: { from: null, to: renewed } })
    expect(stored).toBe(tokenOf(renewed))
  })

  it('main\'s build, a build without keys, a build without its address: does not even look', async () => {
    for (const o of [{ source: null }, { enforced: false }, { api: null }]) {
      const m = machine(licenceFileText('dentiks', tokenOf(renewed)), o)
      expect((await checkPublishedLicence(m.deps) as { refused: string }).refused).toMatch(/no_source|not_enforced|no_api/)
      expect(m.asked).toEqual([])
    }
  })

  it('a file the app cannot save: reported, not claimed as installed', async () => {
    const m = machine(licenceFileText('dentiks', tokenOf(renewed)), { install: () => false })
    expect(await checkPublishedLicence(m.deps)).toEqual({ refused: 'not_saved' })
  })
})
