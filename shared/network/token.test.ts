import { describe, expect, it } from 'vitest'
import {
  importPublicKey, importSigningKey, makeNetworkKeyPair, signNetworkToken, verifyNetworkToken,
  NETWORK_ISSUER, NETWORK_TOKEN_SECONDS, type NetworkTokenPayload,
} from './token'
import { LICENCE_SIGNING_DOMAIN } from '../license/token'

const CLINIC_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLINIC_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const NOW = 1_800_000_000

const payload = (over: Partial<NetworkTokenPayload> = {}): NetworkTokenPayload => ({
  v: 1, iss: NETWORK_ISSUER, aud: CLINIC_A, sub: 'cccccccc-0000-4000-8000-000000000003',
  conn: 'dddddddd-0000-4000-8000-000000000004', name: 'Tess Fake', kind: 'person', role: 'technician',
  company: null, country: 'LV', iat: NOW, exp: NOW + NETWORK_TOKEN_SECONDS, ...over,
})

async function keys() {
  const pair = await makeNetworkKeyPair()
  return { sign: await importSigningKey(pair.privateKey), verify: await importPublicKey(pair.publicKey), pub: pair.publicKey }
}

describe('the Network token', () => {
  it('signed for a clinic, it is good there', async () => {
    const k = await keys()
    const token = await signNetworkToken(payload(), k.sign)
    const r = await verifyNetworkToken(token, k.verify, CLINIC_A, NOW + 10)
    expect(r.ok && r.payload.name).toBe('Tess Fake')
    expect(k.pub).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('a token for one clinic is not good in another', async () => {
    const k = await keys()
    const token = await signNetworkToken(payload({ aud: CLINIC_A }), k.sign)
    expect(await verifyNetworkToken(token, k.verify, CLINIC_B, NOW)).toEqual({ ok: false, reason: 'other_clinic' })
  })

  it('expired, from the future, signed by another key, or changed: refused', async () => {
    const k = await keys()
    const other = await keys()
    const token = await signNetworkToken(payload(), k.sign)
    expect(await verifyNetworkToken(token, k.verify, CLINIC_A, NOW + NETWORK_TOKEN_SECONDS + 61)).toEqual({ ok: false, reason: 'expired' })
    expect(await verifyNetworkToken(token, k.verify, CLINIC_A, NOW - 120)).toEqual({ ok: false, reason: 'not_yet' })
    expect(await verifyNetworkToken(token, other.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'signature' })
    const [body, sig] = token.split('.')
    const changed = btoa(JSON.stringify({ ...payload(), aud: CLINIC_B })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyNetworkToken(`${changed}.${sig}`, k.verify, CLINIC_B, NOW)).toEqual({ ok: false, reason: 'signature' })
    expect(await verifyNetworkToken(body, k.verify, CLINIC_A, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('will not sign a long-lived token or a bad payload', async () => {
    const k = await keys()
    await expect(signNetworkToken(payload({ exp: NOW + 86_400 }), k.sign)).rejects.toThrow(/lifetime/)
    await expect(signNetworkToken(payload({ role: 'admin' as never }), k.sign)).rejects.toThrow(/role/)
    await expect(signNetworkToken(payload({ aud: 'not-a-uuid' }), k.sign)).rejects.toThrow(/aud/)
  })

  it('has its own signing domain: never a licence\'s', async () => {
    const { NETWORK_TOKEN_DOMAIN } = await import('./token')
    expect(NETWORK_TOKEN_DOMAIN).not.toBe(LICENCE_SIGNING_DOMAIN)
    expect(NETWORK_TOKEN_DOMAIN.startsWith('WIVO-NETWORK-')).toBe(true)
  })
})
