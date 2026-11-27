/**
 * sql/153: prices of Wivo Network orders. Only the types offered to clients;
 * each price as the clinic shows it (exact, from, on request) and as this
 * client pays it (its discount, its own price); accepting puts the price on
 * the job; a price on request or a custom request is quoted and the work
 * starts only once the client approves it; a job accepted without a price gets
 * one; the automatic invoice bills the job's price. The catalogue and the
 * estimate agree with the app's price engine (shared/pricing/clientPrices).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PGlite } from '@electric-sql/pglite'
import { freshDb, createTenant, rowsAs, errorAs, type Tenant } from './harness'
import { quoteJob } from '@shared/pricing/quote'
import { clientPriceBook } from '@shared/pricing/clientPrices'
import type { PriceBook } from '@shared/pricing/priceBook'
import type { WorkType } from '@shared/pricing/workTypes'
import type { CatalogueItem } from '@shared/network/order'
import { handleNetworkClient } from '../../supabase/functions/_shared/networkClient'
import { cataloguePriceText, catalogueEstimate } from '../../src/renderer/src/lib/orderView'
import { en } from '@shared/i18n/en'

let db: PGlite
let A: Tenant
const NET = 'aaaaaaaa-0000-4000-8000-000000000153'
const KEY = 'A'.repeat(43)
const acct = (n: number) => `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`
let accounts = 0
let refs = 0

const TYPES: WorkType[] = [
  { nimi: 'Zirconia crown', hex: '#000', hind: 120, hinnaTyyp: 'hammas', astmed: [{ alates: 4, hind: 100 }] },
  { nimi: 'Night guard', hex: '#000', hind: 90, kliendiHind: 'from', astmed: [{ alates: 2, hind: 70 }] },
  { nimi: 'Implant bridge', hex: '#000', hind: 2400, kliendiHind: 'request' },
  { nimi: 'Secret work', hex: '#000', hind: 50, klientidele: false },
  { nimi: 'All-on-4', hex: '#000', hind: 2400, liik: 'arch',
    valikuGrupid: [{ key: 'framework', nimi: 'Framework', mitu: false, valikud: ['metal-bar', 'titanium'] }],
    valikuHinnad: { 'metal-bar': { lisahind: 400 } } },
]
const LIBRARY = [{ id: 'metal-bar', nimi: 'Metal bar', lisahind: 300 }, { id: 'titanium', nimi: 'Titanium', lisahind: 25, yhik: 'hammas' as const }]
const BOOK: PriceBook = { workTypes: TYPES, materialPrices: {}, hambaHind: 0, kiirtooKordaja: 2, designFee: 0, mudeliHind: 0, options: LIBRARY }

async function service<T = unknown>(sql: string, params: unknown[] = []): Promise<T> {
  await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`)
  await db.exec('set role service_role')
  try { return (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T } finally {
    await db.exec('reset role')
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}
async function serviceError(sql: string, params: unknown[] = []): Promise<string | null> {
  try { await service(sql, params); return null } catch (e) { return (e as Error).message }
}
const profile = (name: string) => JSON.stringify({ name, kind: 'company', role: 'clinic', company: `${name} SIA`, country: 'LV' })

/** A confirmed client that sees prices, with its record's discount and own prices; its session and record. */
async function client(over: { discount?: number | null; prices?: Record<string, number>; prices_on?: boolean } = {}) {
  const account = acct(++accounts)
  const name = `Client ${accounts}`
  await service(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`, [NET, account, profile(name)])
  const { rows: [{ id }] } = await db.query<{ id: string }>(`select id from public.network_client where account_id = $1`, [account])
  const customer = (await rowsAs<{ c: string }>(db, { id: A.ownerId }, `select public.network_confirm_client($1, 'clinics', $2::jsonb) as c`,
    [id, JSON.stringify({ prices: over.prices_on ?? true })]))[0].c
  await db.query(`update public.customers set discount_pct = $2, client_prices = $3::jsonb, email = 'buh@client.lv', reg_code = '4000', address = 'Rīga' where id = $1`,
    [customer, over.discount ?? null, JSON.stringify(over.prices ?? {})])
  const session = (await service<{ session: string }>(`select public.network_connect($1, $2, gen_random_uuid(), $3::jsonb) as r`, [NET, account, profile(name)])).session
  return { session, customer, clientId: id }
}
const catalog = async (session: string) => service<{ name: string; price?: number; price_form?: string; unit?: string;
  groups: { key: string; options: { id: string; price?: number; unit?: string }[] }[] }[]>(`select public.client_catalog($1) as r`, [session])
const send = (session: string, over: Record<string, unknown> = {}) => service<string>(`select public.client_new_order($1, $2::jsonb) as r`, [session, JSON.stringify({
  format: 'wivo-order', version: 2, work_type: 'Zirconia crown', teeth: '11,21', options: {}, shade: null, due: null,
  patient_ref: `P-${++refs}`, notes: 'Please', implants: '', abutment: null, ...over })])
const orderRow = async (id: string) => (await db.query<{ status: string; price: string | null; price_state: string | null; estimated_price: string | null; job_id: string | null }>(
  `select status, price::text, price_state, estimated_price::text, job_id from public.client_order where id = $1`, [id])).rows[0]
const jobPrice = async (job: string) => (await db.query<{ hind: string | null }>(`select hind::text from public.jobs where id = $1`, [job])).rows[0].hind
const accept = (order: string, price: number | null) =>
  rowsAs<{ j: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null, $2) as j`, [order, price]).then(r => r[0].j)

beforeAll(async () => {
  db = await freshDb()
  A = await createTenant(db, 'Dentiks')
  await db.query(`insert into public.clinic_settings (clinic_id, work_types, pricing) values ($1, $2::jsonb, $3::jsonb)
                  on conflict (clinic_id) do update set work_types = excluded.work_types, pricing = excluded.pricing`,
    [A.clinicId, JSON.stringify(TYPES), JSON.stringify({ tooValikud: LIBRARY, kmMaar: 21 })])
  await rowsAs(db, { id: A.ownerId }, `select public.network_save_settings(true, $1, $2, 8)`, [KEY, NET])
}, 120_000)

describe('what a client may order, and how its price shows', () => {
  it('only the types offered to clients; exact, from (its lowest) and on request (no price)', async () => {
    const { session } = await client()
    const items = await catalog(session)
    expect(items.map(i => i.name)).toEqual(['Zirconia crown', 'Night guard', 'Implant bridge', 'All-on-4'])
    expect(items[0]).toMatchObject({ price: 120, price_form: 'exact', unit: 'hammas' })
    expect(items[1]).toMatchObject({ price: 70, price_form: 'from' })
    expect(items[2].price_form).toBe('request')
    expect(items[2].price).toBeUndefined()
    // An option shows its price the same way: the type's own amount over the library's.
    expect(items[3].groups[0].options).toEqual([{ id: 'metal-bar', name: 'Metal bar', price: 400, unit: 'too' }, { id: 'titanium', name: 'Titanium', price: 25, unit: 'hammas' }])
  })

  it('a type not offered cannot be ordered; a client that does not see prices sees none', async () => {
    const { session } = await client({ prices_on: false })
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, JSON.stringify({
      format: 'wivo-order', version: 1, work_type: 'Secret work', teeth: '', options: {}, shade: null, due: null, patient_ref: 'X-1', notes: null })])).toMatch(/not in the clinic's catalogue/)
    const items = await catalog(session)
    expect(items.every(i => i.price === undefined && i.price_form === undefined)).toBe(true)
  })
})

describe('the whole way: the connection’s "Prices" right to the text on the card', () => {
  /** The network-client Edge Function's logic, its database calls made here with the service role. */
  const viaFunction = (body: Record<string, unknown>) => handleNetworkClient(body, {
    rpc: async (fn, args) => {
      const names = Object.keys(args)
      try {
        const r = await service(`select public.${fn}(${names.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, names.map(k => args[k]))
        return { data: r, error: null }
      } catch (e) { return { data: null, error: { message: (e as Error).message } } }
    },
    nowSeconds: () => Math.floor(Date.now() / 1000), signDownload: async () => null, signUpload: async () => null,
  })
  const words = { perTooth: en['network.perTooth'] as string, from: (price: string) => (en['network.priceFrom'] as string).replace('{price}', price), onRequest: en['network.priceOnRequest'] as string }

  it('a session made before the owner let the client see prices: its catalogue has them at once, "from 450 € / tooth" on the card, the total in Review', async () => {
    // Kroon: 500 €/tooth, shown "from"; the client 10 % off; with an option.
    await db.query(`update public.clinic_settings set work_types = work_types || $2::jsonb where clinic_id = $1`, [A.clinicId, JSON.stringify([
      { nimi: 'Kroon', hex: '#000', hind: 500, hinnaTyyp: 'hammas', kliendiHind: 'from',
        valikuGrupid: [{ key: 'extra', nimi: 'Extra', mitu: true, valikud: ['metal-bar'] }] }])])
    const c = await client({ discount: 10, prices_on: false })
    const before = await viaFunction({ action: 'catalog', session: c.session })
    const kroon0 = (before.body.data as CatalogueItem[]).find(i => i.name === 'Kroon')!
    expect(cataloguePriceText(kroon0, words)).toBe('')
    // The owner turns "Prices" on; the client keeps the session it has (the phone keeps it for hours).
    await rowsAs(db, { id: A.ownerId }, `select public.network_set_client_visibility($1, $2::jsonb)`, [c.clientId, JSON.stringify({ status: true, messages: true, files: true, prices: true })])
    const after = await viaFunction({ action: 'catalog', session: c.session })
    expect(after.status).toBe(200)
    const kroon = (after.body.data as CatalogueItem[]).find(i => i.name === 'Kroon')!
    expect(kroon).toMatchObject({ price: 450, price_form: 'from', unit: 'hammas' })
    expect(cataloguePriceText(kroon, words)).toBe('from 450 € / tooth')
    expect(kroon.groups[0].options[0]).toMatchObject({ id: 'metal-bar', price: 270 })
    // Review: two teeth and the option, "from" (the type shows its lowest price).
    const estimate = catalogueEstimate(kroon, '11,21', { extra: ['metal-bar'] })
    expect(estimate).toEqual({ amount: 1170, from: true })
    expect((en['network.estimateFrom'] as string).replace('{price}', String(estimate!.amount))).toBe('Estimated price: from 1170 €')
  })

  it('the order form does not ask the session whether prices may show: the catalogue says', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'src', 'renderer', 'src', 'mobile', 'network', 'NetworkApp.tsx'), 'utf8')
    expect(app).not.toMatch(/can_see\.prices/)
    expect(app).not.toMatch(/prices && /)
  })
})

describe('a client’s own price', () => {
  it('its discount off every price (tiers and options too); its own price for a type over the list and the discount', async () => {
    const { session } = await client({ discount: 10, prices: { 'Night guard': 60 } })
    const items = await catalog(session)
    expect(items.find(i => i.name === 'Zirconia crown')?.price).toBe(108)
    expect(items.find(i => i.name === 'Night guard')?.price).toBe(60)
    expect(items.find(i => i.name === 'All-on-4')?.groups[0].options[0].price).toBe(360)
  })

  it('the estimate on sending is what the app’s price engine makes of it at the client’s prices', async () => {
    const pricing = { discountPct: 10, prices: { 'Night guard': 60 } }
    const { session } = await client({ discount: 10, prices: { 'Night guard': 60 } })
    const cases: [Record<string, unknown>, { too: string; hambad: string; valikud?: Record<string, string[]> }][] = [
      [{ work_type: 'Zirconia crown', teeth: '11,21' }, { too: 'Zirconia crown', hambad: '11,21' }],
      [{ work_type: 'Zirconia crown', teeth: '11,21,22,23' }, { too: 'Zirconia crown', hambad: '11,21,22,23' }],
      [{ work_type: 'Night guard', teeth: '' }, { too: 'Night guard', hambad: '' }],
      [{ work_type: 'All-on-4', teeth: '11,12,13,14', options: { framework: ['titanium'] } }, { too: 'All-on-4', hambad: '11,12,13,14', valikud: { framework: ['titanium'] } }],
      [{ work_type: 'All-on-4', teeth: '11,12', options: { framework: ['metal-bar'] } }, { too: 'All-on-4', hambad: '11,12', valikud: { framework: ['metal-bar'] } }],
    ]
    for (const [order, item] of cases) {
      const id = await send(session, order)
      const engine = quoteJob({ items: [item] }, clientPriceBook(BOOK, pricing)).total
      expect(Number((await orderRow(id)).estimated_price), JSON.stringify(order)).toBe(engine)
    }
  })
})

describe('accepting puts the price on the job', () => {
  it('the price the clinic accepts with is the job’s and the order’s, confirmed', async () => {
    const { session } = await client({ discount: 10 })
    const id = await send(session)
    expect((await orderRow(id)).price_state).toBe('estimated')
    const job = await accept(id, 216)
    expect(await jobPrice(job)).toBe('216.00')
    expect(await orderRow(id)).toMatchObject({ status: 'accepted', price: '216.00', price_state: 'confirmed' })
    // The client sees it confirmed.
    const detail = await service<{ price: number; price_state: string }>(`select public.client_order_detail($1, $2) as r`, [session, id])
    expect(detail).toMatchObject({ price: 216, price_state: 'confirmed' })
  })

  it('an app before 153 (no price): the job as before, without one', async () => {
    const { session } = await client()
    const id = await send(session)
    const job = (await rowsAs<{ j: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as j`, [id]))[0].j
    expect(await jobPrice(job)).toBeNull()
  })
})

describe('a price to approve: on request, and "Other / custom request"', () => {
  it('a custom request is quoted; the work starts only once the client approves; both sides are told', async () => {
    const { session, clientId } = await client()
    const id = await send(session, { work_type: 'Sports mouthguard', custom: true, teeth: '', notes: 'Red, 4 mm' })
    expect(await orderRow(id)).toMatchObject({ price_state: 'needs_quote', estimated_price: null })
    // Not accepted without the client's approval.
    expect(await errorAs(db, { id: A.ownerId }, `select public.accept_client_order($1, null, 100)`, [id])).toMatch(/approve its price/)
    await rowsAs(db, { id: A.ownerId }, `select public.quote_client_order($1, 150, null)`, [id])
    expect(await orderRow(id)).toMatchObject({ status: 'received', price: '150.00', price_state: 'quoted' })
    const [notice] = (await db.query<{ kind: string; reason: string }>(`select kind, reason from public.client_notification where client_id = $1 and kind = 'quoted'`, [clientId])).rows
    expect(notice).toEqual({ kind: 'quoted', reason: '150.00' })
    expect(await service<{ price: number; price_state: string }>(`select public.client_order_detail($1, $2) as r`, [session, id])).toMatchObject({ price: 150, price_state: 'quoted' })

    await service(`select public.client_price_decision($1, $2, true) as r`, [session, id])
    const row = await orderRow(id)
    expect(row).toMatchObject({ status: 'accepted', price_state: 'approved', price: '150.00' })
    expect(await jobPrice(row.job_id!)).toBe('150.00')
    const told = (await db.query<{ detail: { decision: string } }>(`select detail from public.notification where user_id = $1 and kind = 'client_price'`, [A.ownerId])).rows
    expect(told.map(n => n.detail.decision)).toContain('approved')
  })

  it('on request: declined, quoted again, then approved; a custom request needs its description', async () => {
    const { session } = await client()
    const id = await send(session, { work_type: 'Implant bridge', teeth: '11,12,13' })
    expect((await orderRow(id)).price_state).toBe('needs_quote')
    await rowsAs(db, { id: A.ownerId }, `select public.quote_client_order($1, 2600, null)`, [id])
    await service(`select public.client_price_decision($1, $2, false) as r`, [session, id])
    expect(await orderRow(id)).toMatchObject({ status: 'received', price_state: 'declined' })
    expect(await serviceError(`select public.client_price_decision($1, $2, true)`, [session, id])).toMatch(/no price to approve/)
    await rowsAs(db, { id: A.ownerId }, `select public.quote_client_order($1, 2500, null)`, [id])
    await service(`select public.client_price_decision($1, $2, true) as r`, [session, id])
    expect(await orderRow(id)).toMatchObject({ status: 'accepted', price: '2500.00' })
    expect(await serviceError(`select public.client_new_order($1, $2::jsonb)`, [session, JSON.stringify({
      format: 'wivo-order', version: 2, work_type: 'Thing', custom: true, teeth: '', options: {}, shade: null, due: null, patient_ref: 'C-9', notes: null, implants: '', abutment: null })]))
      .toMatch(/says what is wanted/)
  })

  it('only the client of the order decides, only through the service role', async () => {
    const a = await client()
    const b = await client()
    const id = await send(a.session, { work_type: 'Implant bridge', teeth: '11' })
    await rowsAs(db, { id: A.ownerId }, `select public.quote_client_order($1, 900, null)`, [id])
    expect(await serviceError(`select public.client_price_decision($1, $2, true)`, [b.session, id])).toMatch(/Order not found/)
    expect(await errorAs(db, { id: A.ownerId }, `select public.client_price_decision($1, $2, true)`, [a.session, id])).toMatch(/permission denied/)
  })
})

describe('a job accepted without a price', () => {
  it('gets one with Set price, once; the automatic invoice bills it', async () => {
    const { session } = await client()
    await db.query(`update public.clinics set country = 'LV' where id = $1`, [A.clinicId])
    const id = await send(session)
    const job = (await rowsAs<{ j: string }>(db, { id: A.ownerId }, `select public.accept_client_order($1, null) as j`, [id]))[0].j
    await rowsAs(db, { id: A.ownerId }, `select public.set_order_price($1, 240)`, [id])
    expect(await jobPrice(job)).toBe('240.00')
    expect(await errorAs(db, { id: A.ownerId }, `select public.set_order_price($1, 300)`, [id])).toMatch(/has a price already/)
  })

  it('the automatic invoice: the job’s price, the client’s discount included', async () => {
    await db.query(`update public.clinic_settings set pricing = pricing || $2::jsonb where clinic_id = $1`,
      [A.clinicId, JSON.stringify({ autoArve: { on: true, trigger: 'received', mode: 'per_job', send: 'draft' } })])
    const { session } = await client({ discount: 10 })
    const id = await send(session)
    const engine = quoteJob({ items: [{ too: 'Zirconia crown', hambad: '11,21' }] }, clientPriceBook(BOOK, { discountPct: 10 })).total
    const job = await accept(id, engine)
    const [{ last }] = (await db.query<{ last: string }>(`select (public.stage_order($1))[array_length(public.stage_order($1), 1)] as last`, [A.clinicId])).rows
    await db.query(`update public.jobs set status = $2, delivery_status = 'teel' where id = $1`, [job, last])
    // An order from outside: the client says it arrived, or the clinic records it confirmed by phone.
    await rowsAs(db, { id: A.ownerId }, `select public.job_mark_received($1, true, 'Confirmed by phone')`, [job])
    const [inv] = (await db.query<{ net_total: string }>(
      `select i.net_total::text from public.invoices i join public.invoice_lines l on l.invoice_id = i.id where l.job_id = $1`, [job])).rows
    expect(Number(inv.net_total)).toBe(216)
  })
})
