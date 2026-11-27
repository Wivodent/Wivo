import { describe, expect, it } from 'vitest'
import {
  CLINIC_REQUEST_AUDIENCE, CLINIC_REQUEST_WINDOW_MS, claimedClinic, clinicNonce, directoryEntryOf,
  importClinicPublicKey, importClinicSigningKey, makeClinicKeyPair, signClinicRequest, verifyClinicRequest,
  type ClinicRequestPayload,
} from './clinicRequest'
import {
  importSigningKey, makeNetworkKeyPair, signNetworkToken, NETWORK_ISSUER, NETWORK_TOKEN_SECONDS,
} from './token'

const CLINIC_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLINIC_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const NOW = 1_800_000_000_000

const payload = (over: Partial<ClinicRequestPayload> = {}): ClinicRequestPayload => ({
  v: 1, aud: CLINIC_REQUEST_AUDIENCE, clinic: CLINIC_A, op: 'set_listed', listed: true, iat: NOW, nonce: clinicNonce(), ...over,
})

async function keys() {
  const pair = await makeClinicKeyPair()
  return { sign: await importClinicSigningKey(pair.privateKey), verify: await importClinicPublicKey(pair.publicKey), pub: pair.publicKey }
}

describe("a clinic's signed request to the Network", () => {
  it('signed by the clinic, it is good for that clinic, within a minute', async () => {
    const k = await keys()
    const req = await signClinicRequest(payload(), k.sign)
    const r = await verifyClinicRequest(req, k.verify, CLINIC_A, NOW + 5_000)
    expect(r.ok && r.payload.listed).toBe(true)
    expect(k.pub).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(claimedClinic(req)).toBe(CLINIC_A)
  })

  it('another clinic\'s key, another clinic, a changed byte: refused', async () => {
    const a = await keys()
    const b = await keys()
    const req = await signClinicRequest(payload(), a.sign)
    expect(await verifyClinicRequest(req, b.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(await verifyClinicRequest(req, a.verify, CLINIC_B, NOW)).toEqual({ ok: false, reason: 'other_clinic' })
    // Hidden → listed by editing the payload: the signature no longer fits.
    const [body, sig] = req.split('.')
    const json = JSON.parse(Buffer.from(body, 'base64url').toString())
    const forged = `${Buffer.from(JSON.stringify({ ...json, listed: false })).toString('base64url')}.${sig}`
    expect(await verifyClinicRequest(forged, a.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(await verifyClinicRequest('x', a.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'malformed' })
    expect(await verifyClinicRequest(`${body}.!!`, a.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('older or newer than a minute: refused', async () => {
    const k = await keys()
    const req = await signClinicRequest(payload(), k.sign)
    expect((await verifyClinicRequest(req, k.verify, CLINIC_A, NOW + CLINIC_REQUEST_WINDOW_MS)).ok).toBe(true)
    expect(await verifyClinicRequest(req, k.verify, CLINIC_A, NOW + CLINIC_REQUEST_WINDOW_MS + 1)).toEqual({ ok: false, reason: 'stale_clock' })
    expect(await verifyClinicRequest(req, k.verify, CLINIC_A, NOW - CLINIC_REQUEST_WINDOW_MS - 1)).toEqual({ ok: false, reason: 'stale_clock' })
  })

  it('a Network token signed with the same kind of key never passes for a clinic request (own domain)', async () => {
    const pair = await makeNetworkKeyPair()
    const token = await signNetworkToken({
      v: 1, iss: NETWORK_ISSUER, aud: CLINIC_A, sub: CLINIC_B, conn: CLINIC_B, name: 'Tess Fake', kind: 'person',
      role: 'technician', company: null, country: 'LV', iat: 1_800_000_000, exp: 1_800_000_000 + NETWORK_TOKEN_SECONDS,
    }, await importSigningKey(pair.privateKey))
    expect(await verifyClinicRequest(token, await importClinicPublicKey(pair.publicKey), CLINIC_A, NOW)).toEqual({ ok: false, reason: 'signature' })
  })

  it('will not sign a payload that is not one', async () => {
    const k = await keys()
    await expect(signClinicRequest(payload({ op: 'get' }), k.sign)).rejects.toThrow(/listed/)
    await expect(signClinicRequest(payload({ listed: undefined }), k.sign)).rejects.toThrow(/listed/)
    await expect(signClinicRequest(payload({ clinic: 'nope' }), k.sign)).rejects.toThrow(/clinic/)
    await expect(signClinicRequest(payload({ iat: 1.5 }), k.sign)).rejects.toThrow(/iat/)
    await expect(signClinicRequest(payload({ nonce: 'short' }), k.sign)).rejects.toThrow(/nonce/)
    await expect(signClinicRequest({ ...payload(), aud: 'other' } as unknown as ClinicRequestPayload, k.sign)).rejects.toThrow(/audience/)
    const get = await signClinicRequest(payload({ op: 'get', listed: undefined }), k.sign)
    expect((await verifyClinicRequest(get, k.verify, CLINIC_A, NOW)).ok).toBe(true)
  })

  it('claimedClinic reads only a well-formed clinic id', () => {
    expect(claimedClinic(null)).toBeNull()
    expect(claimedClinic('a.b')).toBeNull()
    expect(claimedClinic(`${Buffer.from(JSON.stringify({ clinic: 'x' })).toString('base64url')}.c2ln`)).toBeNull()
    expect(claimedClinic(`${Buffer.from(JSON.stringify({ clinic: CLINIC_B.toUpperCase() })).toString('base64url')}.c2ln`)).toBe(CLINIC_B)
  })
})

describe('the Network\'s answer, as the clinic trusts it', () => {
  const good = { listed: true, inviteCode: 'abcdef123456789012', name: 'Dentiks', city: 'Rīga', country: 'LV' }
  it('takes a well-formed entry and nothing more', () => {
    expect(directoryEntryOf({ ...good, extra: 'dropped' })).toEqual(good)
    expect(directoryEntryOf({ ...good, city: null })).toEqual({ ...good, city: null })
  })
  it('refuses anything else', () => {
    expect(directoryEntryOf(null)).toBeNull()
    expect(directoryEntryOf({ ...good, listed: 'yes' })).toBeNull()
    expect(directoryEntryOf({ ...good, inviteCode: 'ABC/../x' })).toBeNull()
    expect(directoryEntryOf({ ...good, inviteCode: 'short' })).toBeNull()
    expect(directoryEntryOf({ ...good, name: '' })).toBeNull()
    expect(directoryEntryOf({ ...good, country: 'Latvia' })).toBeNull()
  })
})
