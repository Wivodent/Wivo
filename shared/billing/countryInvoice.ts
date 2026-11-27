/**
 * Which countries have Wivo's invoices, and what each starts from — one file,
 * like the payroll rules (shared/payroll/countryTax). A country not listed
 * here has no invoices in Wivo: its accountant's own software does them.
 *
 *   invoices        New invoice, the list, printing / saving as PDF
 *   email           sending an invoice by e-mail from Wivo (the e-mailed copy
 *                   is still written in Estonian, so Estonia only for now)
 *   language        the document's language unless the clinic chooses another
 *   standardVatPct  the country's standard VAT rate, shown as a hint; the rate
 *                   on an invoice is always the clinic's own setting
 *
 * NO DEPENDENCIES (shared/README.md).
 */
export type DocLanguage = 'et' | 'lv' | 'en'
export const DOC_LANGUAGES: readonly DocLanguage[] = ['et', 'lv', 'en']

export interface CountryInvoicing {
  invoices: boolean
  email: boolean
  language: DocLanguage
  standardVatPct: number | null
}

const COUNTRIES: Record<string, CountryInvoicing> = {
  EE: { invoices: true, email: true, language: 'et', standardVatPct: 24 },
  LV: { invoices: true, email: false, language: 'lv', standardVatPct: 21 },
}

const NONE: CountryInvoicing = { invoices: false, email: false, language: 'en', standardVatPct: null }

export const countryInvoicing = (country: string): CountryInvoicing => COUNTRIES[country.trim().toUpperCase()] ?? NONE

export const isDocLanguage = (v: unknown): v is DocLanguage => typeof v === 'string' && (DOC_LANGUAGES as readonly string[]).includes(v)

/** The document's language: the clinic's choice, else its country's. */
export const docLanguageFor = (country: string, chosen: unknown): DocLanguage =>
  isDocLanguage(chosen) ? chosen : countryInvoicing(country).language

/** An invoice number's prefix as the database keeps it: letters, digits, - / _ only, at most 12. */
export const cleanPrefix = (raw: string): string => raw.replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 12)
