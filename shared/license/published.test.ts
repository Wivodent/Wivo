/**
 * The rules a licence delivered with the updates must pass
 * (shared/license/published). The app and make-license.mjs --publish both run
 * judgePublishedLicence, so these are the rules of both.
 */
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign as nodeSign, verify as nodeVerify, type KeyObject } from 'node:crypto'
import { encodePayload, parseToken, signingInput, type LicencePayload } from './token'
import {
  judgePublishedLicence, licenceDifference, licenceFileText, parseLicenceChange, parseLicenceFile,
  type LicenceOffer,
} from './published'

const ORG = '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f'
const OTHER_ORG = '8f14e45f-ceea-467a-9b71-1c4a9c0e8b2d'
const API = 'https://fwsrnsdrlrlmjfkkkhvp.supabase.co'

const ours = generateKeyPairSync('ed25519')
const stranger = generateKeyPairSync('ed25519')

function tokenOf(p: LicencePayload, key: KeyObject = ours.privateKey): string {
  const b64 = encodePayload(p)
  return `WIVO1.${b64}.${Buffer.from(nodeSign(null, Buffer.from(signingInput(b64, p.v)), key)).toString('base64url')}`
}

/** The app's check, with our test key as the only pinned one. */
function verify(token: string): LicencePayload | null {
  const t = parseToken(token)
  if (!t) return null
  return nodeVerify(null, Buffer.from(signingInput(t.payloadB64, t.payload.v)), ours.publicKey, Buffer.from(t.signature)) ? t.payload : null
}

const base: LicencePayload = {
  v: 2, name: 'Dentiks', plan: 'labor', seats: 10, iat: '2026-11-24', exp: '2027-11-24',
  org: ORG, api: [API], modules: ['jobs', 'payroll', 'stock'],
}
const installed = { token: tokenOf({ ...base, iat: '2026-01-10', exp: '2027-01-10', modules: ['jobs', 'payroll'] }),
  payload: { ...base, iat: '2026-01-10', exp: '2027-01-10', modules: ['jobs', 'payroll'] } }

const offer = (o: Partial<LicenceOffer> & { token?: string }): LicenceOffer => ({
  file: o.file !== undefined ? o.file : licenceFileText('dentiks', o.token ?? tokenOf(base)),
  build: 'dentiks', org: ORG, api: API, current: installed, verify, ...o,
})

describe('a published licence', () => {
  it('the right one: our signature, this clinic, issued later: taken', () => {
    const token = tokenOf(base)
    const r = judgePublishedLicence(offer({ token }))
    expect(r).toEqual({ ok: true, token, payload: base })
  })

  it('a wrong signature, or an edited payload: refused', () => {
    expect(judgePublishedLicence(offer({ token: tokenOf(base, stranger.privateKey) }))).toEqual({ ok: false, reason: 'bad_signature' })
    const [, , sig] = tokenOf(base).split('.')
    const edited = `WIVO1.${encodePayload({ ...base, seats: 999 })}.${sig}`
    expect(judgePublishedLicence(offer({ token: edited }))).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it("another clinic's organisation: refused, also when the address is ours", () => {
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, org: OTHER_ORG }) }))).toEqual({ ok: false, reason: 'other_org' })
  })

  it('issued earlier than, or on the same day as, the installed one: refused', () => {
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, iat: '2025-12-01' }) }))).toEqual({ ok: false, reason: 'not_newer' })
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, iat: '2026-01-10', seats: 20 }) }))).toEqual({ ok: false, reason: 'not_newer' })
  })

  it('no file published: nothing to do', () => {
    expect(judgePublishedLicence(offer({ file: null }))).toEqual({ ok: false, reason: 'missing' })
  })

  it('the installed token itself: nothing to do, and nothing to log', () => {
    expect(judgePublishedLicence(offer({ token: installed.token }))).toEqual({ ok: false, reason: 'same' })
  })

  it("a file for another clinic's build, or one that is not a licence: refused", () => {
    expect(judgePublishedLicence(offer({ file: licenceFileText('other', tokenOf(base)) }))).toEqual({ ok: false, reason: 'other_clinic' })
    for (const file of ['', 'not json', '{"v":1,"clinic":"dentiks","token":"hello"}', '{"v":2,"clinic":"dentiks","token":"WIVO1.a.b"}']) {
      expect(judgePublishedLicence(offer({ file })), file).toEqual({ ok: false, reason: 'malformed' })
    }
  })

  it('an address that is not this app\'s, or none: refused', () => {
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, api: ['https://zzzzzzzzzzzzzzzzzzzz.supabase.co'] }) }))).toEqual({ ok: false, reason: 'other_api' })
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, api: [] }) }))).toEqual({ ok: false, reason: 'other_api' })
    // The same origin written differently is the same address.
    expect(judgePublishedLicence(offer({ token: tokenOf({ ...base, api: [`${API.toUpperCase()}:443/`] }) })).ok).toBe(true)
  })

  it('a v1 key names no organisation: refused', () => {
    const v1: LicencePayload = { v: 1, name: 'Dentiks', plan: 'labor', seats: 10, iat: '2026-11-24', exp: '2027-11-24' }
    expect(judgePublishedLicence(offer({ token: tokenOf(v1) }))).toEqual({ ok: false, reason: 'not_v2' })
  })

  it('no organisation to compare with: refused', () => {
    expect(judgePublishedLicence(offer({ org: null, current: null }))).toEqual({ ok: false, reason: 'no_org' })
  })

  it('no licence installed (or an invalid one): any issue date', () => {
    expect(judgePublishedLicence(offer({ current: null, token: tokenOf({ ...base, iat: '2020-01-01' }) })).ok).toBe(true)
  })

  it('the file round-trips, with a BOM too', () => {
    const text = licenceFileText('dentiks', ` ${installed.token}\n`)
    expect(parseLicenceFile(text)).toEqual({ v: 1, clinic: 'dentiks', token: installed.token })
    expect(parseLicenceFile(`﻿${text}`)?.token).toBe(installed.token)
    expect(parseLicenceFile(new TextEncoder().encode(text))?.clinic).toBe('dentiks')
  })
})

describe('what changed, for the owner', () => {
  it('modules added and removed in the app\'s order, users, expiry, plan', () => {
    const d = licenceDifference(installed.payload, { ...base, modules: ['stock', 'jobs'], seats: null, plan: 'labor_plus' })
    expect(d).toEqual({
      modulesAdded: ['stock'], modulesRemoved: ['payroll'],
      seats: { from: 10, to: null }, exp: { from: '2027-01-10', to: '2027-11-24' }, plan: { from: 'labor', to: 'labor_plus' },
    })
  })

  it('the same terms: no differences', () => {
    expect(licenceDifference(base, { ...base, iat: '2026-12-01' })).toEqual({ modulesAdded: [], modulesRemoved: [], seats: null, exp: null, plan: null })
  })

  it('from no licence: everything is new', () => {
    expect(licenceDifference(null, base)).toMatchObject({ modulesAdded: ['jobs', 'payroll', 'stock'], seats: { from: null, to: 10 }, exp: { from: null, to: '2027-11-24' } })
  })

  it('a stored change is read back; anything else is not', () => {
    const c = { at: '2026-11-24T10:00:00.000Z', from: installed.payload, to: base }
    expect(parseLicenceChange(JSON.parse(JSON.stringify(c)))).toEqual(c)
    expect(parseLicenceChange({ ...c, from: null })).toEqual({ ...c, from: null })
    expect(parseLicenceChange({ at: 1, to: base })).toBeNull()
    expect(parseLicenceChange({ at: 'x', from: 'y', to: base })).toBeNull()
    expect(parseLicenceChange(null)).toBeNull()
  })
})
