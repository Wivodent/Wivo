/**
 * What an invoice to a company should carry about the buyer (the EU's VAT
 * directive, art. 226): its registry code, VAT number and address. The invoice
 * form warns when the client's record lacks them; it does not refuse (a client
 * without a VAT number may simply not have one). A person (a dentist on their
 * own, sql/128) is not asked.
 */
export type BuyerField = 'reg' | 'vat' | 'address'

export function buyerDetailsMissing(c: { kind?: 'clinic' | 'person' | null; reg_code?: string | null; vat_number?: string | null; address?: string | null }): BuyerField[] {
  if (c.kind === 'person') return []
  const out: BuyerField[] = []
  if (!c.reg_code?.trim()) out.push('reg')
  if (!c.vat_number?.trim()) out.push('vat')
  if (!c.address?.trim()) out.push('address')
  return out
}
