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
    // An older token (no e-mail fields): no contact is stored.
    expect(calls.some(c => c.fn === 'client_set_contact')).toBe(false)
    expect(calls.some(c => c.fn === 'client_set_billing')).toBe(false)
  })

  it('connect: the billing e-mail in the token goes onto the client here (Network 004, sql/152); removed, it says so', async () => {
    const net = await makeNetworkKeyPair()
    const { deps, calls } = await setup({ [CLINIC_A]: { key: net.publicKey } })
    await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_A, net.privateKey, { email: 'tess@fake.test', billing: 'invoices@fake.test' }) }, deps)
    expect(calls.find(c => c.fn === 'client_set_billing')!.args).toEqual({
      p_network_clinic: CLINIC_A, p_account: 'cccccccc-0000-4000-8000-000000000003', p_billing: 'invoices@fake.test' })
    const again = await setup({ [CLINIC_A]: { key: net.publicKey } })
    await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_A, net.privateKey, { billing: null }) }, again.deps)
    expect(again.calls.find(c => c.fn === 'client_set_billing')!.args).toMatchObject({ p_billing: null })
  })

  it('connect: the address and e-mail choice in the token are kept for the e-mails of the clinic (sql/142)', async () => {
    const net = await makeNetworkKeyPair()
    const { deps, calls } = await setup({ [CLINIC_A]: { key: net.publicKey } })
    await handleNetworkClient({ action: 'connect', networkToken: await tokenFor(CLINIC_A, net.privateKey, { email: 'tess@fake.test', mail: false }) }, deps)
    expect(calls.find(c => c.fn === 'client_set_contact')!.args).toEqual({
      p_network_clinic: CLINIC_A, p_account: 'cccccccc-0000-4000-8000-000000000003', p_email: 'tess@fake.test', p_mail: false })
  })

  it('price_decision (sql/153): approve or decline through the session; a yes or no only', async () => {
    const { deps, calls } = await setup({})
    await handleNetworkClient({ action: 'price_decision', session: SESSION, orderId: 'eeeeeeee-0000-4000-8000-000000000005', approve: true }, deps)
    expect(calls.find(c => c.fn === 'client_price_decision')!.args).toEqual({ p_session: SESSION, p_order: 'eeeeeeee-0000-4000-8000-000000000005', p_approve: true })
    expect((await handleNetworkClient({ action: 'price_decision', session: SESSION, orderId: 'eeeeeeee-0000-4000-8000-000000000005', approve: 'yes' }, deps)).status).toBe(400)
    expect((await handleNetworkClient({ action: 'price_decision', session: SESSION, orderId: 'x', approve: true }, deps)).status).toBe(400)
  })

  it('the notices of the client: read and marked through its session; ids must be ids', async () => {
    const { deps, calls } = await setup({})
    await handleNetworkClient({ action: 'notifications', session: SESSION }, deps)
    await handleNetworkClient({ action: 'notifications_read', session: SESSION, ids: [ORDER_ID] }, deps)
    await handleNetworkClient({ action: 'notifications_read', session: SESSION }, deps)
    expect(calls.map(c => [c.fn, c.args.p_ids])).toEqual([
      ['client_notifications', undefined], ['client_notifications_read', [ORDER_ID]], ['client_notifications_read', null]])
    expect((await handleNetworkClient({ action: 'notifications_read', session: SESSION, ids: ['x'] }, deps)).status).toBe(400)
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

  it('a file with a message, and a review answer: checked here, then the database decides (sql/143)', async () => {
    const { deps, calls } = await setup({})
    const up = await handleNetworkClient({ action: 'message_upload', session: SESSION, messageId: ORDER_ID, name: 'photo.jpg', size: 10, sha256: 'b'.repeat(64), mime: 'image/jpeg' }, deps)
    expect(calls[0]).toMatchObject({ fn: 'client_message_file_slot', args: { p_message: ORDER_ID, p_name: 'photo.jpg', p_size: 10 } })
    expect(up.status).not.toBe(400)
    expect((await handleNetworkClient({ action: 'message_upload', session: SESSION, messageId: ORDER_ID, name: 'a/b.jpg', size: 10, sha256: 'b'.repeat(64) }, deps)).status).toBe(400)
    await handleNetworkClient({ action: 'review', session: SESSION, messageId: ORDER_ID, decision: 'approved' }, deps)
    expect(calls.at(-1)).toEqual({ fn: 'client_review', args: { p_session: SESSION, p_message: ORDER_ID, p_decision: 'approved', p_comment: null } })
    expect((await handleNetworkClient({ action: 'review', session: SESSION, messageId: ORDER_ID, decision: 'changes', comment: '  ' }, deps)).status).toBe(400)
    expect((await handleNetworkClient({ action: 'review', session: SESSION, messageId: ORDER_ID, decision: 'maybe' }, deps)).status).toBe(400)
  })

  it('how it fitted and the rating of the clinic: checked here, the database decides (sql/144)', async () => {
    const { deps, calls } = await setup({})
    await handleNetworkClient({ action: 'fit', session: SESSION, orderId: ORDER_ID, decision: 'adjust', reason: 'Halb passivus', note: 'Rocks' }, deps)
    expect(calls.at(-1)).toEqual({ fn: 'client_fit', args: { p_session: SESSION, p_order: ORDER_ID, p_decision: 'adjust', p_reason: 'Halb passivus', p_note: 'Rocks' } })
    expect((await handleNetworkClient({ action: 'fit', session: SESSION, orderId: ORDER_ID, decision: 'adjust', reason: 'Muu', note: ' ' }, deps)).status).toBe(400)
    await handleNetworkClient({ action: 'rate_clinic', session: SESSION, orderId: ORDER_ID, score: 5 }, deps)
    expect(calls.at(-1)).toEqual({ fn: 'client_rate_clinic', args: { p_session: SESSION, p_order: ORDER_ID, p_score: 5, p_comment: null } })
    expect((await handleNetworkClient({ action: 'rate_clinic', session: SESSION, orderId: ORDER_ID, score: 6 }, deps)).status).toBe(400)
    await handleNetworkClient({ action: 'feedback', session: SESSION, orderId: ORDER_ID }, deps)
    expect(calls.at(-1)?.fn).toBe('client_feedback')
  })

  it('Received and a delivery problem: checked here, the database decides (sql/145)', async () => {
    const { deps, calls } = await setup({})
    await handleNetworkClient({ action: 'received', session: SESSION, orderId: ORDER_ID }, deps)
    expect(calls.at(-1)).toEqual({ fn: 'client_received', args: { p_session: SESSION, p_order: ORDER_ID } })
    expect((await handleNetworkClient({ action: 'received', session: SESSION, orderId: 'nope' }, deps)).status).toBe(400)
    await handleNetworkClient({ action: 'problem', session: SESSION, orderId: ORDER_ID, reason: 'damaged', note: ' Cracked ' }, deps)
    expect(calls.at(-1)).toEqual({ fn: 'client_report_problem', args: { p_session: SESSION, p_order: ORDER_ID, p_reason: 'damaged', p_note: 'Cracked' } })
    const n = calls.length
    expect((await handleNetworkClient({ action: 'problem', session: SESSION, orderId: ORDER_ID, reason: 'broken', note: 'x' }, deps)).status).toBe(400)
    expect((await handleNetworkClient({ action: 'problem', session: SESSION, orderId: ORDER_ID, reason: 'other', note: '  ' }, deps)).status).toBe(400)
    expect(calls.length).toBe(n)
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
