/**
 * Prices of Wivo Network orders on the screens (sql/153): the client's own
 * price book, the Accept price from the engine (required where there is none),
 * a quote the client approves, the custom request, the client's view of its
 * price. The database's side: sql/test/networkOrderPrices.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { clientPriceBook, clientPriceForm, clientMayOrder, clientFactor } from '@shared/pricing/clientPrices'
import { quoteJob } from '@shared/pricing/quote'
import type { PriceBook } from '@shared/pricing/priceBook'
import { orderProblems, type CatalogueItem } from '@shared/network/order'
import { orderPriceFor, parsePrice, clientPricingOf } from '../../lib/orderPrice'
import { catalogueEstimate, wireOrder } from '../../lib/orderView'

const read = (p: string) => readFileSync(p, 'utf8')

const BOOK: PriceBook = {
  workTypes: [
    { nimi: 'Zirconia crown', hex: '#000', hind: 120, hinnaTyyp: 'hammas', soodushind: 110, astmed: [{ alates: 4, hind: 100 }] },
    { nimi: 'Implant bridge', hex: '#000', hind: 2400, kliendiHind: 'request' },
    { nimi: 'All-on-4', hex: '#000', hind: 2400, valikuHinnad: { 'metal-bar': { lisahind: 400 } } },
  ],
  materialPrices: { Tsirkoon: { small: 50, large: 60 } }, hambaHind: 40, kiirtooKordaja: 1.5, designFee: 30, mudeliHind: 20,
  options: [{ id: 'metal-bar', nimi: 'Metal bar', lisahind: 300 }],
}

describe('a client’s own price book', () => {
  it('no discount and no own price: the clinic’s book itself', () => {
    expect(clientPriceBook(BOOK, null)).toBe(BOOK)
    expect(clientPriceBook(BOOK, { discountPct: 0, prices: {} })).toBe(BOOK)
  })
  it('the discount off the types, tiers, discount prices, options, materials and the per-tooth fallback; not the design fee, model or rush', () => {
    const b = clientPriceBook(BOOK, { discountPct: 10 })
    const crown = b.workTypes[0]
    expect([crown.hind, crown.soodushind, crown.astmed?.[0].hind]).toEqual([108, 99, 90])
    expect(b.workTypes[2].valikuHinnad?.['metal-bar'].lisahind).toBe(360)
    expect(b.options?.[0].lisahind).toBe(270)
    expect(b.materialPrices.Tsirkoon).toEqual({ small: 45, large: 54 })
    expect(b.hambaHind).toBe(36)
    expect([b.designFee, b.mudeliHind, b.kiirtooKordaja]).toEqual([30, 20, 1.5])
  })
  it('an own price for a type wins over the list, its tiers and the discount', () => {
    const b = clientPriceBook(BOOK, { discountPct: 10, prices: { 'Zirconia crown': 95 } })
    expect(b.workTypes[0]).toMatchObject({ hind: 95, astmed: undefined, soodushind: undefined })
    expect(quoteJob({ items: [{ too: 'Zirconia crown', hambad: '11,21,22,23' }] }, b).total).toBe(380)
  })
  it('how a type shows to clients', () => {
    expect([clientPriceForm({}), clientPriceForm({ kliendiHind: 'from' }), clientPriceForm({ kliendiHind: 'request' })]).toEqual(['exact', 'from', 'request'])
    expect([clientMayOrder({}), clientMayOrder({ klientidele: false })]).toEqual([true, false])
    expect([clientFactor(null), clientFactor({ discountPct: 150 }), clientFactor({ discountPct: 12.5 })]).toEqual([1, 0, 0.875])
  })
})

describe('the Accept price', () => {
  const order = (over: Record<string, unknown> = {}) => ({ work_type: 'Zirconia crown', payload: {
    format: 'wivo-order', version: 2, work_type: 'Zirconia crown', teeth: '11,21', options: {}, shade: null, due: null, patient_ref: 'P', notes: null,
    implants: '', abutment: null, ...over } as never })
  it('the engine with the client’s prices', () => {
    expect(orderPriceFor(order(), BOOK, null)).toEqual({ amount: 240, needsQuote: false })
    expect(orderPriceFor(order(), BOOK, clientPricingOf({ discount_pct: 10, client_prices: {} }))).toEqual({ amount: 216, needsQuote: false })
    expect(orderPriceFor({ ...order({ options: { framework: ['metal-bar'] } }), work_type: 'All-on-4' }, BOOK, null)).toEqual({ amount: 2800, needsQuote: false })
  })
  it('on request and custom requests are quoted; nothing in the list: no amount (the clinic types one)', () => {
    expect(orderPriceFor({ ...order(), work_type: 'Implant bridge' }, BOOK, null)).toEqual({ amount: null, needsQuote: true })
    expect(orderPriceFor(order({ custom: true }), BOOK, null)).toEqual({ amount: null, needsQuote: true })
    expect(orderPriceFor({ ...order(), work_type: 'Unknown thing' }, { ...BOOK, hambaHind: 0, materialPrices: {} }, null).amount).toBeNull()
  })
  it('a typed price: 0 or more, two decimals, a comma too', () => {
    expect([parsePrice('120'), parsePrice('99,50'), parsePrice(' 12.3 '), parsePrice(''), parsePrice('-1'), parsePrice('1.234'), parsePrice('abc')])
      .toEqual([120, 99.5, 12.3, null, null, null, null])
  })
})

describe('the client’s side', () => {
  const crown: CatalogueItem = { name: 'Zirconia crown', teeth: 'tooth', price: 108, unit: 'hammas', price_form: 'exact',
    groups: [{ key: 'extra', name: 'Extra', multi: true, options: [{ id: 'glaze', name: 'Glaze', price: 5, unit: 'hammas' }] }] }
  it('the estimate from the catalogue: the client’s price times the teeth, with the options; on request: none', () => {
    expect(catalogueEstimate(crown, '11,21', { extra: ['glaze'] })).toEqual({ amount: 226, from: false })
    expect(catalogueEstimate({ ...crown, price_form: 'from' }, '11', {})).toEqual({ amount: 108, from: true })
    expect(catalogueEstimate({ ...crown, price_form: 'request', price: null }, '11', {})).toBeNull()
    expect(catalogueEstimate(crown, '', {})).toBeNull()
  })
  it('"Other / custom request": version 2, flagged, outside the catalogue, with a description', () => {
    const form = { format: 'wivo-order' as const, version: 1 as const, work_type: 'Mouthguard', teeth: '', options: {}, shade: null, due: null, patient_ref: 'P-1', notes: 'Red' }
    const wire = wireOrder(form, { implants: [], abutmentAll: '', abutmentTeeth: {}, custom: true }, true)
    expect(wire).toMatchObject({ version: 2, custom: true, implants: '', abutment: null })
    expect(orderProblems(wire, [crown])).toEqual([])
    expect(orderProblems({ ...wire, notes: null }, [crown])).toContain('custom')
    expect(orderProblems({ ...form, custom: true }, [crown])).toContain('custom')
  })
  it('the order form and the order view', () => {
    const app = read('src/renderer/src/mobile/network/NetworkApp.tsx')
    expect(app).toContain("t('network.customRequest')")
    expect(app).toContain('wireOrder(order, { implants, abutmentAll, abutmentTeeth, custom }, v2)')
    expect(app).toContain('{catalogPriceText(c) && <span className="text-xs text-ink-muted">{catalogPriceText(c)}</span>}')
    expect(app).toContain('<OrderPrice api={api} orderId={orderId} detail={d}')
    expect(app).toContain('api.priceDecision(orderId, approve)')
    expect(read('supabase/functions/_shared/networkClient.ts')).toContain("call('client_price_decision', { p_order: orderId, p_approve: b.approve })")
  })
})

describe('the clinic’s screens', () => {
  it('Orders: quick Accept only with the engine’s price and nothing to approve; the dialog’s price is required; a quote instead for on request', () => {
    const v = read('src/renderer/src/components/Network/OrdersView.tsx')
    expect(v).toContain('const quickAccept = tab === \'new\' && canAccept && !waitsForPrice && suggestion.amount != null')
    expect(v).toContain('p_price: suggestion.amount')
    expect(v).toContain('disabled={accept.isPending || typedPrice == null}')
    expect(v).toContain('quote.mutateAsync({ p_order: order.id, p_price: typedPrice!, p_template: template || null })')
    expect(v).toContain("setOrderPrice.mutateAsync({ p_order: order.id, p_price: typedPrice! })")
    expect(v).toContain("t('orders.noPrice')")
  })
  it('Settings: offered to clients and the price form per type; the client’s card: discount and own prices', () => {
    const s = read('src/renderer/src/components/SettingsPage.tsx')
    expect(s).toContain("onChange={e => onPatch({ klientidele: e.target.checked ? undefined : false })}")
    expect(s).toContain("onPatch({ kliendiHind: e.target.value === 'exact' ? undefined : e.target.value as 'from' | 'request' })")
    expect(read('src/renderer/src/components/Customers/CustomersView.tsx')).toContain('<ClientPricesFields discount={form.discount_pct} prices={form.client_prices}')
    expect(read('src/renderer/src/hooks/useCustomers.ts')).toContain("'discount_pct', 'client_prices'] as const")
  })
})
