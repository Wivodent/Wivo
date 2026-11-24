/**
 * The clinic's country (`clinics.country`, sql/070) and what follows from it
 * (docs/ARCHITECTURE-INSTANCES.md §9, "Riga's workers and pay", option a).
 *
 * Estonian tax is only for an Estonian clinic: the payslip estimate, net pay
 * agreements, the employee's tax settings, and invoices. Anywhere else, pay
 * is shown gross, "before tax", and the clinic's accountant does the tax from
 * the monthly export. A clinic whose country isn't loaded yet is Estonian, as
 * every clinic was before.
 */
export const clinicCountry = (clinic: { country?: string | null } | null | undefined): string =>
  (clinic?.country?.trim() || 'EE').toUpperCase()

/** The payslip estimate, net agreements and the employee's tax settings. */
export const hasEstonianTax = (country: string): boolean => country === 'EE'

/** Wivo's invoices are Estonian documents; another country's are not built yet. */
export const invoicesAvailable = (country: string): boolean => country === 'EE'

/**
 * The grey sample text in the clinic's own fields (city, phone, VAT, bank),
 * in the clinic's country. A Latvian clinic seeing "Tallinn" and "+372" reads
 * the app as built for someone else. Empty for a country not listed here.
 */
export interface FieldExamples {
  city: string; postcode: string; phone: string; vat: string; bank: string; iban: string; company: string
}

const EXAMPLES: Record<string, FieldExamples> = {
  EE: { city: 'Tallinn', postcode: '10111', phone: '+372 5123 4567', vat: 'EE123456789', bank: 'LHV, SEB…', iban: 'EE00 1234 5678 9012 3456', company: 'Hambaravi OÜ' },
  LV: { city: 'Rīga', postcode: 'LV-1010', phone: '+371 2000 0000', vat: 'LV40003000000', bank: 'Swedbank, SEB…', iban: 'LV00 HABA 0000 0000 0000 0', company: 'Zobārstniecība SIA' },
}

export const fieldExamples = (country: string): FieldExamples =>
  EXAMPLES[country] ?? { city: '', postcode: '', phone: '+', vat: '', bank: '', iban: '', company: '' }
