import { taxSystemOf, latviaRulesFor } from '@shared/payroll/countryTax'
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

/** Which payroll rules apply: Estonia's (the clinic's own rates), Latvia's (the law's), or none (gross only). */
export { taxSystemOf as payrollTaxSystem } from '@shared/payroll/countryTax'

/**
 * The employer's share on top of gross, as a percentage, for the clinic's cost.
 * Estonia and any other country: the rate in Settings. Latvia: the law's rate
 * for the year (a pensioner's lower rate is applied per person on Payroll).
 */
export function employerRatePct(country: string, settingsPct: number, year = new Date().getFullYear()): number {
  return taxSystemOf(country) === 'LV' ? latviaRulesFor(year).employerSocialPct : settingsPct
}

/**
 * The employer's share for a group of employees, as one percentage of their
 * total gross. Latvia: each person's own rate, weighted by what they earned
 * (a working pensioner's is lower, 20.77% against 23.59% in 2026). Anywhere
 * else every employee has the same rate, the one in Settings.
 *
 * One percentage rather than an amount, so Finance and Statistics keep
 * applying it to the employees' gross exactly as before.
 */
export function employerRateForStaff(
  country: string,
  settingsPct: number,
  staff: readonly { grossPay: number; pensioner?: boolean | null }[],
  year = new Date().getFullYear(),
): number {
  if (taxSystemOf(country) !== 'LV') return settingsPct
  const rules = latviaRulesFor(year)
  const total = staff.reduce((s, p) => s + Math.max(0, p.grossPay), 0)
  if (total <= 0) return rules.employerSocialPct
  const tax = staff.reduce((s, p) =>
    s + Math.max(0, p.grossPay) * (p.pensioner === true ? rules.pensionerEmployerSocialPct : rules.employerSocialPct), 0)
  return tax / total
}
