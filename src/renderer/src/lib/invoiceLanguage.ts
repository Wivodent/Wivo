/**
 * Which language a new invoice starts in (sql/149), before anyone changes it:
 *
 *   the client's own invoice language            (customers.invoice_language)
 *   English, for a client in another country     (customers.country ≠ the clinic's), suggested
 *   the clinic's default                         (Settings → Invoices, else its country's)
 *
 * A patient has no language of their own in Wivo: the clinic's default. The
 * choice on the form is for that invoice only, and the invoice keeps it.
 */
import type { DocLanguage } from '@shared/billing/countryInvoice'

export function startingInvoiceLanguage(
  client: { invoice_language?: string | null; country?: string | null } | null,
  clinic: { country: string; defaultLanguage: DocLanguage },
): { language: DocLanguage; abroad: boolean } {
  const own = client?.invoice_language
  if (own === 'et' || own === 'lv' || own === 'en') return { language: own, abroad: false }
  const country = client?.country?.trim().toUpperCase()
  if (country && country !== clinic.country.trim().toUpperCase()) return { language: 'en', abroad: true }
  return { language: clinic.defaultLanguage, abroad: false }
}
