import { describe, it, expect } from 'vitest'
import { latviaPayslip, latviaRulesFor, taxSystemOf, LATVIA_RULES } from './countryTax'

describe('which rules a country uses', () => {
  it('Estonia and Latvia have rules; any other country shows gross only', () => {
    expect(taxSystemOf('EE')).toBe('EE')
    expect(taxSystemOf('lv')).toBe('LV')
    expect(taxSystemOf('FI')).toBeNull()
    expect(taxSystemOf(null)).toBeNull()
  })

  it('a year without its own rules uses the nearest earlier one', () => {
    expect(latviaRulesFor(2027)).toBe(LATVIA_RULES[2026])
    expect(latviaRulesFor(2020)).toBe(LATVIA_RULES[2026])
  })
})

describe('Latvia 2026', () => {
  it('the control case: gross 2000, booklet with us, 1 dependent', () => {
    const s = latviaPayslip(2000, { taxBooklet: true, dependents: 1 })
    expect(s.employeeSocial).toBe(210)
    expect(s.taxable).toBe(990)
    expect(s.incomeTax).toBe(252.45)
    expect(s.net).toBe(1537.55)
    expect(s.employerSocial).toBe(471.8)
    expect(s.employerCost).toBe(2471.8)
    expect(s.minimumWageApplied).toBe(false)
  })

  it('defaults: booklet with us, no dependents, not a pensioner', () => {
    const s = latviaPayslip(2000)
    expect(s.allowances).toBe(550)
    expect(s.taxable).toBe(1240)
    expect(s.incomeTax).toBe(316.2)
  })

  it('without the booklet there is no non-taxable minimum', () => {
    const s = latviaPayslip(2000, { taxBooklet: false })
    expect(s.allowances).toBe(0)
    expect(s.taxable).toBe(1790)
    expect(s.incomeTax).toBe(456.45)
  })

  it('a pensioner pays 9.25% and the employer 20.77%', () => {
    const s = latviaPayslip(2000, { pensioner: true })
    expect(s.employeeSocial).toBe(185)
    expect(s.employerSocial).toBe(415.4)
    expect(s.employerCost).toBe(2415.4)
  })

  it('below the minimum wage social insurance is computed on 780 €', () => {
    const s = latviaPayslip(500)
    expect(s.minimumWageApplied).toBe(true)
    expect(s.socialBase).toBe(780)
    expect(s.employeeSocial).toBe(81.9)
    expect(s.employerSocial).toBe(184)
    // The allowances cover the rest: no income tax, never a negative taxable amount.
    expect(s.taxable).toBe(0)
    expect(s.incomeTax).toBe(0)
  })

  it('nothing earned is nothing owed, not tax on the minimum wage', () => {
    const s = latviaPayslip(0)
    expect(s.minimumWageApplied).toBe(false)
    expect(s.employerCost).toBe(0)
    expect(s.net).toBe(0)
  })
})
