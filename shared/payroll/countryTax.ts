/**
 * Payroll taxes by country: the clinic's country picks the rules.
 *
 * One file of rules, by country and by year, rather than `if (country === …)`
 * spread through the screens. Estonia is NOT here as numbers: its rates have
 * always been the clinic's own settings (lib/earnings, payslipFromGross), and
 * that logic stays exactly as it was. Latvia's rates are the law's, fixed per
 * year, so they live here and nobody has to type them in.
 *
 * NO DEPENDENCIES — `shared/README.md`.
 */

/** Which payroll rules a clinic's country uses. Null: none, pay is shown gross. */
export type TaxSystem = 'EE' | 'LV'

export function taxSystemOf(country: string | null | undefined): TaxSystem | null {
  const c = (country ?? '').trim().toUpperCase()
  return c === 'EE' || c === 'LV' ? c : null
}

/** Latvia, one year. Percentages as percentages (10.5 = 10.5%), money in € a month. */
export interface LatviaRules {
  year: number
  /** Employee's social insurance (VSAOI), withheld from gross. */
  employeeSocialPct: number
  /** Employer's social insurance (VSAOI), on top of gross. */
  employerSocialPct: number
  /** The same two for someone who receives an old-age pension. */
  pensionerEmployeeSocialPct: number
  pensionerEmployerSocialPct: number
  /** Personal income tax (IIN). One rate: the higher band (above 8 775 € a month) is not modelled. */
  incomeTaxPct: number
  /** Non-taxable minimum, only when the tax booklet is with this employer. */
  nonTaxableMinimum: number
  /** Allowance for each dependent. */
  dependentAllowance: number
  /** Minimum monthly wage: social insurance is computed on at least this much. */
  minimumWage: number
}

export const LATVIA_RULES: Record<number, LatviaRules> = {
  2026: {
    year: 2026,
    employeeSocialPct: 10.5,
    employerSocialPct: 23.59,
    pensionerEmployeeSocialPct: 9.25,
    pensionerEmployerSocialPct: 20.77,
    incomeTaxPct: 25.5,
    nonTaxableMinimum: 550,
    dependentAllowance: 250,
    minimumWage: 780,
  },
}

/** The rules for a year; the latest known year for a later one, the earliest for an earlier one. */
export function latviaRulesFor(year: number): LatviaRules {
  const years = Object.keys(LATVIA_RULES).map(Number).sort((a, b) => a - b)
  const pick = years.filter(y => y <= year).pop() ?? years[0]
  return LATVIA_RULES[pick]
}

/** A Latvian employee's own tax situation. Every field optional: the defaults below. */
export interface LatviaTaxProfile {
  /** The tax booklet (algas nodokļu grāmatiņa) is with this employer. Default yes. */
  taxBooklet?: boolean | null
  /** Number of dependents registered. Default 0. */
  dependents?: number | null
  /** Receives an old-age pension. Default no. */
  pensioner?: boolean | null
}

export interface LatviaPayslip {
  gross: number
  /** The base social insurance was computed on: gross, or the minimum wage when gross is below it. */
  socialBase: number
  /** True when gross was below the minimum wage and the base was raised to it. */
  minimumWageApplied: boolean
  employeeSocialPct: number
  employeeSocial: number
  /** Non-taxable minimum + dependents actually deducted. */
  allowances: number
  taxable: number
  incomeTaxPct: number
  incomeTax: number
  net: number
  employerSocialPct: number
  employerSocial: number
  employerCost: number
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Gross → take-home and the clinic's cost, Latvia.
 *
 *   social base  = max(gross, minimum wage)
 *   employee VSAOI = base × employee rate
 *   taxable      = gross − employee VSAOI − non-taxable minimum (booklet only) − dependents
 *   income tax   = max(0, taxable) × rate
 *   net          = gross − employee VSAOI − income tax
 *   employer VSAOI = base × employer rate; cost = gross + employer VSAOI
 */
export function latviaPayslip(gross: number, profile: LatviaTaxProfile = {}, rules: LatviaRules = latviaRulesFor(2026)): LatviaPayslip {
  const g = Math.max(0, Number(gross) || 0)
  const pensioner = profile.pensioner === true
  const booklet = profile.taxBooklet !== false
  const dependents = Math.max(0, Math.floor(Number(profile.dependents) || 0))
  const employeeSocialPct = pensioner ? rules.pensionerEmployeeSocialPct : rules.employeeSocialPct
  const employerSocialPct = pensioner ? rules.pensionerEmployerSocialPct : rules.employerSocialPct
  const minimumWageApplied = g > 0 && g < rules.minimumWage
  const socialBase = minimumWageApplied ? rules.minimumWage : g
  const employeeSocial = round2(socialBase * employeeSocialPct / 100)
  const allowances = (booklet ? rules.nonTaxableMinimum : 0) + dependents * rules.dependentAllowance
  const taxable = round2(Math.max(0, g - employeeSocial - allowances))
  const incomeTax = round2(taxable * rules.incomeTaxPct / 100)
  const employerSocial = round2(socialBase * employerSocialPct / 100)
  return {
    gross: round2(g),
    socialBase: round2(socialBase),
    minimumWageApplied,
    employeeSocialPct,
    employeeSocial,
    allowances,
    taxable,
    incomeTaxPct: rules.incomeTaxPct,
    incomeTax,
    net: round2(g - employeeSocial - incomeTax),
    employerSocialPct,
    employerSocial,
    employerCost: round2(g + employerSocial),
  }
}
