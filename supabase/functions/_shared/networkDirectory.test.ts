/**
 * network-directory: the owner's directory entry. The order of the checks
 * (second factor, owner by row security, orders on for listing) and that
 * nothing is signed or sent before they pass; the request the Network gets
 * is signed by the clinic's key, for the clinic's own Network number.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleNetworkDirectory, type NetworkDirectoryDeps } from './networkDirectory'
import {
  importClinicPublicKey, importClinicSigningKey, makeClinicKeyPair, verifyClinicRequest,
} from '../../../shared/network/clinicRequest'

const CLINIC = 'aaaaaaaa-0000-4000-8000-000000000001'
const NETWORK = 'https://abcdefghijklmnopqrst.supabase.co'
const NOW = 1_800_000_000_000
const ENTRY = { listed: true, inviteCode: 'abcdef123456789012', name: 'Dentiks', city: 'Rīga', country: 'LV' }

async function setup(over: Partial<NetworkDirectoryDeps> = {}) {
  const pair = await makeClinicKeyPair()
  const sign = await importClinicSigningKey(pair.privateKey)
  const verify = await importClinicPublicKey(pair.publicKey)
  const post = vi.fn(async (_url: string, _body: unknown) => ({ status: 200, data: ENTRY as unknown }))
  const deps: NetworkDirectoryDeps = {
    hasMfa: async () => true,
    ownerSettings: async () => ({ enabled: true, network_clinic_id: CLINIC }),
    key: async () => sign,
    networkUrl: NETWORK,
    nowMs: () => NOW,
    post,
    ...over,
  }
  return { deps, post: (over.post as typeof post | undefined) ?? post, verify }
}

describe('network-directory', () => {
  it('signs a request for this clinic only, sends it to the Network, passes on the entry', async () => {
    const { deps, post, verify } = await setup()
    const r = await handleNetworkDirectory({ action: 'set_listed', listed: true, clinic: 'bbbbbbbb-0000-4000-8000-000000000002' }, deps)
    expect(r).toEqual({ status: 200, body: ENTRY })
    expect(post).toHaveBeenCalledTimes(1)
    const [url, body] = post.mock.calls[0]
    expect(url).toBe(`${NETWORK}/functions/v1/network-clinic`)
    const v = await verifyClinicRequest((body as { request: string }).request, verify, CLINIC, NOW)
    // The Network number comes from the clinic's settings, never from the call.
    expect(v.ok && v.payload).toMatchObject({ clinic: CLINIC, op: 'set_listed', listed: true, iat: NOW })
  })

  it('get asks without changing anything', async () => {
    const { deps, post, verify } = await setup()
    expect((await handleNetworkDirectory({ action: 'get' }, deps)).status).toBe(200)
    const v = await verifyClinicRequest((post.mock.calls[0][1] as { request: string }).request, verify, CLINIC, NOW)
    expect(v.ok && v.payload.op).toBe('get')
    expect(v.ok && 'listed' in v.payload).toBe(false)
  })

  it('nothing is signed or sent without the second factor, for a non-owner, or before set-up', async () => {
    for (const [over, status, error] of [
      [{ hasMfa: async () => false }, 403, 'second_factor'],
      [{ ownerSettings: async () => null }, 403, 'not_allowed'],
      [{ ownerSettings: async () => ({ enabled: true, network_clinic_id: null }) }, 409, 'not_set_up'],
      [{ key: async () => null }, 503, 'not_set_up'],
      [{ networkUrl: null }, 503, 'not_set_up'],
      [{ networkUrl: 'https://evil.example.com' }, 503, 'not_set_up'],
    ] as [Partial<NetworkDirectoryDeps>, number, string][]) {
      const { deps, post } = await setup(over)
      expect(await handleNetworkDirectory({ action: 'set_listed', listed: false }, deps)).toEqual({ status, body: { error } })
      expect(post).not.toHaveBeenCalled()
    }
  })

  it('listing needs orders on; hiding never does', async () => {
    const off = { ownerSettings: async () => ({ enabled: false, network_clinic_id: CLINIC }) }
    const a = await setup(off)
    expect(await handleNetworkDirectory({ action: 'set_listed', listed: true }, a.deps)).toEqual({ status: 409, body: { error: 'orders_off' } })
    expect(a.post).not.toHaveBeenCalled()
    const b = await setup(off)
    expect((await handleNetworkDirectory({ action: 'set_listed', listed: false }, b.deps)).status).toBe(200)
  })

  it('a bad request is refused before anything else', async () => {
    const hasMfa = vi.fn(async () => true)
    const { deps } = await setup({ hasMfa })
    for (const body of [null, {}, { action: 'drop' }, { action: 'set_listed' }, { action: 'set_listed', listed: 'yes' }]) {
      expect((await handleNetworkDirectory(body, deps)).status).toBe(400)
    }
    expect(hasMfa).not.toHaveBeenCalled()
  })

  it('the Network\'s answer: only a well-formed entry is passed on', async () => {
    for (const [res, status, error] of [
      [null, 502, 'network_unreachable'],
      [{ status: 200, data: { ...ENTRY, inviteCode: '../x' } }, 502, 'network_unreachable'],
      [{ status: 403, data: { error: 'not_allowed' } }, 502, 'network_refused'],
      [{ status: 409, data: { error: 'older_request' } }, 409, 'try_again'],
      [{ status: 500, data: null }, 502, 'network_unreachable'],
    ] as [{ status: number; data: unknown } | null, number, string][]) {
      const { deps } = await setup({ post: vi.fn(async () => res) })
      expect(await handleNetworkDirectory({ action: 'get' }, deps)).toEqual({ status, body: { error } })
    }
  })
})
