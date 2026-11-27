/**
 * A client's own price (sql/153): the clinic's price list with this client's
 * discount and its own prices per work type, as one PriceBook, so the price
 * engine (quoteJob) counts it like any other price. The database's catalogue
 * and estimate (client_unit_price, client_from_price, client_option_price,
 * client_order_estimate) follow the same rules; sql/test/networkOrderPrices
 * checks the two agree.
 *
 *   own price     customers.client_prices[type]: the type's unit price for
 *                 this client, whatever the list, its tiers or the discount say
 *   discount %    customers.discount_pct: off every other price of the list —
 *                 the types, their tiers and discount prices, the options
 *                 (the type's own option prices too), materials and the
 *                 per-tooth fallback. Not the design fee, the model or the
 *                 rush multiplier.
 * Each discounted unit price is rounded to the cent, as the database rounds it.
 *
 * And how a type shows to clients (Settings → Work types & prices):
 *   klientidele   false: not offered (absent: offered)
 *   kliendiHind   'exact' | 'from' (its lowest price) | 'request' (no price; quoted)
 *
 * NO DEPENDENCIES (shared/README.md).
 */
import type { PriceBook } from './priceBook'
import type { WorkType } from './workTypes'

export interface ClientPricing {
  /** 0–100; null or 0: none. */
  discountPct?: number | null
  /** Work type name → this client's own unit price. */
  prices?: Record<string, unknown> | null
}

export type ClientPriceForm = 'exact' | 'from' | 'request'

export const clientPriceForm = (t: Pick<WorkType, 'kliendiHind'> | null | undefined): ClientPriceForm =>
  t?.kliendiHind === 'from' || t?.kliendiHind === 'request' ? t.kliendiHind : 'exact'

/** Offered to clients unless switched off (absent: offered, as before sql/153). */
export const clientMayOrder = (t: Pick<WorkType, 'klientidele'> | null | undefined): boolean => t?.klientidele !== false

const round2 = (n: number): number => Math.round(n * 100) / 100

/** A positive number, else undefined. */
const price = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** The discount as a factor: 1 = none. */
export function clientFactor(c: ClientPricing | null | undefined): number {
  const d = typeof c?.discountPct === 'number' && Number.isFinite(c.discountPct) ? Math.min(Math.max(c.discountPct, 0), 100) : 0
  return 1 - d / 100
}

/** This client's own unit price for a type, if it has one. */
export const ownPrice = (c: ClientPricing | null | undefined, typeName: string): number | undefined =>
  c?.prices ? price((c.prices as Record<string, unknown>)[typeName]) : undefined

/** The clinic's price book as this client pays it. The same book, untouched, without a discount or own prices. */
export function clientPriceBook(book: PriceBook, client: ClientPricing | null | undefined): PriceBook {
  const f = clientFactor(client)
  const hasOwn = !!client?.prices && Object.keys(client.prices).some(k => ownPrice(client, k) !== undefined)
  if (f === 1 && !hasOwn) return book
  const scale = (n: number | undefined): number | undefined => (typeof n === 'number' ? round2(n * f) : n)
  const scaleOptions = (v: WorkType['valikuHinnad']): WorkType['valikuHinnad'] => v
    ? Object.fromEntries(Object.entries(v).map(([id, p]) => [id, { ...p, lisahind: scale(p.lisahind) }]))
    : v
  return {
    ...book,
    workTypes: book.workTypes.map((t): WorkType => {
      const own = ownPrice(client, t.nimi)
      if (own !== undefined) return { ...t, hind: round2(own), soodushind: undefined, astmed: undefined, valikuHinnad: scaleOptions(t.valikuHinnad) }
      return {
        ...t,
        hind: scale(t.hind),
        soodushind: scale(t.soodushind),
        astmed: t.astmed?.map(a => ({ ...a, hind: round2(a.hind * f), soodushind: scale(a.soodushind) })),
        valikuHinnad: scaleOptions(t.valikuHinnad),
      }
    }),
    materialPrices: Object.fromEntries(Object.entries(book.materialPrices).map(([m, p]) => [m, { small: round2(p.small * f), large: round2(p.large * f) }])),
    hambaHind: round2(book.hambaHind * f),
    options: book.options?.map(o => ({ ...o, lisahind: scale(o.lisahind) })),
  }
}
