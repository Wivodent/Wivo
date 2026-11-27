/**
 * The clinic's Edge Function `network-client` (networkClient.ts): the Network
 * token is checked before the database is asked; a token for another clinic
 * opens nothing; a session needs no Network; the database's words never
 * reach the caller.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleNetworkClient, type NetworkClientDeps } from './networkClient'
import { importSigningKey, makeNetworkKeyPair, signNetworkToken, NETWORK_ISSUER } from '../../../shared/network/token'

const CLINIC_A = 'aaaaaaaa-0000-4000-8000-000000000001'
const CLINIC_B = 'bbbbbbbb-0000-4000-8000-000000000002'
const NOW = 1_800_000_000
const SESSION = 'e'.repeat(64)
const ORDER_ID = '11111111-1111-4111-8111-111111111111'

async function setup(settings: Record<string, { key: string }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const deps: NetworkClientDeps = {
    nowSeconds: () => NOW,
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'network_settings_for') {
        const s = settings[args.p_network_clinic as string]
        return { data: s ? [{ org_id: 'org', enabled: true, network_public_key: s.key, session_hours: 8 }] : [], error: null }
      }
      if (fn === 'network_connect') return { data: { state: 'confirmed', session: SESSION }, error: null }
      if (fn === 'client_orders') return { data: [], error: null }
      if (fn === 'client_reference_preview') return { data: 'TF-DE-261127-001', error: null }
      if (fn === 'client_new_order') return { data: null, error: { code: '23505', message: 'This reference is already used in this clinic' } }
      if (fn === 'client_order_detail') return { data: null, error: { code: '42501', message: 'Order not found (public.client_order_detail)' } }
      if (fn === 'client_file_slot') return { data: { file_id: ORDER_ID, path: 'client-orders/org/o/f' }, error: null }
      return { data: null, error: { message: 'Session not valid', code: '42501' } }
    }),
    signDownload: vi.fn(async () => 'https://signed/download'),
    signUpload: vi.fn(async () => ({ url: 'https://signed/upload', token: 'tok' })),
  }
  return { deps, calls }
}

async function tokenFor(aud: string, privateKey: string, over: Record<string, unknown> = {}) {
  return signNetworkToken({
    v: 1, iss: NETWORK_ISSUER, aud, sub: 'cccccccc-0000-4000-8000-000000000003', conn: 'dddddddd-0000-4000-8000-000000000004',
    name: 'Tess Fake', kind: 'person', role: 'technician', company: null, country: 'LV', iat: NOW, exp: NOW + 300, ...over,
  } as never, await importSigningKey(privateKey))
}

describe('network-client', () => {
  it('connect: a good token for this clinic reaches the database with the account it names', async () => {
    const net = await makeNetworkKeyPair()
    const { deps, calls } = await setup({ [CLINIC_A]: { key: net.publicKey } })
    const a = await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_A, net.privateKey) }, deps)
    expect(a).toEqual({ status: 200, body: { state: 'confirmed', session: SESSION } })
    const connect = calls.find(c => c.fn === 'network_connect')!
    expect(connect.args).toMatchObject({ p_network_clinic: CLINIC_A, p_account: 'cccccccc-0000-4000-8000-000000000003' })
  })

  it('a token for another clinic opens nothing here', async () => {
    const net = await makeNetworkKeyPair()
    const { deps, calls } = await setup({ [CLINIC_A]: { key: net.publicKey } })
    const a = await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_B, net.privateKey) }, deps)
    expect(a.status).toBe(403)
    expect(calls.some(c => c.fn === 'network_connect')).toBe(false)
  })

  it('a token signed by anyone but the Network, or expired: refused before the database is asked to connect', async () => {
    const net = await makeNetworkKeyPair()
    const forger = await makeNetworkKeyPair()
    const { deps, calls } = await setup({ [CLINIC_A]: { key: net.publicKey } })
    expect((await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_A, forger.privateKey) }, deps)).body)
      .toEqual({ error: 'network_token', reason: 'signature' })
    const old = await tokenFor(CLINIC_A, net.privateKey, { iat: NOW - 1000, exp: NOW - 700 })
    expect((await handleNetworkClient({ action: 'connect', networkToken: old }, deps)).body).toEqual({ error: 'network_token', reason: 'expired' })
    expect(calls.some(c => c.fn === 'network_connect')).toBe(false)
  })

  it('with a session: the database only, never the Network (it may be down)', async () => {
    const { deps, calls } = await setup({})
    const a = await handleNetworkClient({ action: 'orders', session: SESSION }, deps)
    expect(a).toEqual({ status: 200, body: { data: [] } })
    expect(calls.map(c => c.fn)).toEqual(['client_orders'])
    expect(calls[0].args).toEqual({ p_session: SESSION })
  })

  it('the database\'s own words never reach the caller', async () => {
    const { deps } = await setup({})
    const a = await handleNetworkClient({ action: 'order', session: SESSION, orderId: ORDER_ID }, deps)
    expect(a).toEqual({ status: 403, body: { error: 'not_allowed' } })
    const gone = await handleNetworkClient({ action: 'catalog', session: SESSION }, deps)
    expect(gone).toEqual({ status: 401, body: { error: 'session' } })
    expect(await handleNetworkClient({ action: 'orders', session: 'short' }, deps)).toEqual({ status: 401, body: { error: 'session' } })
  })

  it('the reference the form shows comes from the clinic database; a reference it already has is said as such', async () => {
    const { deps, calls } = await setup({})
    expect(await handleNetworkClient({ action: 'next_ref', session: SESSION }, deps)).toEqual({ status: 200, body: { data: 'TF-DE-261127-001' } })
    expect(calls[0]).toEqual({ fn: 'client_reference_preview', args: { p_session: SESSION } })
    const order = { format: 'wivo-order', version: 1, work_type: 'Crown', teeth: '11', options: {}, shade: null, due: null, patient_ref: 'CASE-118', notes: null }
    expect(await handleNetworkClient({ action: 'new_order', session: SESSION, order }, deps)).toEqual({ status: 409, body: { error: 'duplicate_reference' } })
  })

  it('an order that is not Wivo order v1 does not reach the database', async () => {
    const { deps, calls } = await setup({})
    const a = await handleNetworkClient({ action: 'new_order', session: SESSION, order: { format: 'other' } }, deps)
    expect(a.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('an upload: a name with a folder in it is refused; a good one gets an upload link only', async () => {
    const { deps } = await setup({})
    const base = { action: 'upload', session: SESSION, orderId: ORDER_ID, size: 10, sha256: 'a'.repeat(64) }
    expect((await handleNetworkClient({ ...base, name: '../etc/passwd' }, deps)).status).toBe(400)
    const ok = await handleNetworkClient({ ...base, name: 'scan.stl' }, deps)
    expect(ok).toEqual({ status: 200, body: { fileId: ORDER_ID, uploadUrl: 'https://signed/upload', uploadToken: 'tok' } })
  })
})
