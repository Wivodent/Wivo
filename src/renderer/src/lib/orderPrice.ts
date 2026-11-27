/**
 * A Network order's price on accepting (sql/153): the price engine (quoteJob)
 * on the order's work type, teeth and options, with the client's own prices
 * (its discount and own price list: shared/pricing/clientPrices). What the
 * Accept dialog fills in and the clinic may change; the job gets it.
 *
 *   needsQuote   "Other / custom request", or a type "on request": the
 *                clinic quotes a price and the client approves it first
 *   amount       null when the engine cannot price it (no price in the list):
 *                the clinic types one
 */
import { quoteJob } from '@shared/pricing/quote'
import type { PriceBook } from '@shared/pricing/priceBook'
import { clientPriceBook, clientPriceForm, type ClientPricing } from '@shared/pricing/clientPrices'
import type { WivoOrder } from '@shared/network/order'

export interface OrderPriceSuggestion { amount: number | null; needsQuote: boolean }

export function orderPriceFor(order: { work_type: string; payload: WivoOrder | null }, book: PriceBook, client: ClientPricing | null): OrderPriceSuggestion {
  const p = order.payload
  if (p && p.version === 2 && p.custom) return { amount: null, needsQuote: true }
  const type = book.workTypes.find(w => w.nimi === order.work_type)
  if (clientPriceForm(type) === 'request') return { amount: null, needsQuote: true }
  const quote = quoteJob({ items: [{ too: order.work_type, hambad: p?.teeth ?? '', valikud: p?.options ?? null }] }, clientPriceBook(book, client))
  const amount = quote.unpriced.length === 0 && quote.total > 0 ? Math.round(quote.total * 100) / 100 : null
  return { amount, needsQuote: false }
}

/** A client's record as the price engine reads it (customers.discount_pct, client_prices). */
export const clientPricingOf = (c: { discount_pct?: number | null; client_prices?: Record<string, unknown> | null } | null | undefined): ClientPricing | null =>
  c ? { discountPct: c.discount_pct ?? null, prices: c.client_prices ?? null } : null

/** A price typed into a field: a number of 0 or more with at most two decimals, or null. */
export function parsePrice(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) && n <= 9_999_999 ? n : null
}
