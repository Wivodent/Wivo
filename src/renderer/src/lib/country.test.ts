import { describe, it, expect } from 'vitest'
import { clinicCountry, hasEstonianTax, invoicesAvailable, fieldExamples, employerRateForStaff } from './country'

describe("the clinic's country", () => {
  it('Estonian until the clinic says otherwise, as every clinic was before', () => {
    expect(clinicCountry(null)).toBe('EE')
    expect(clinicCountry({})).toBe('EE')
    expect(clinicCountry({ country: '' })).toBe('EE')
    expect(clinicCountry({ country: 'lv' })).toBe('LV')
  })

  it('Estonian tax and invoices only in Estonia; Latvia, or any other country, gets neither', () => {
    expect(hasEstonianTax('EE')).toBe(true)
    expect(invoicesAvailable('EE')).toBe(true)
    for (const c of ['LV', 'LT', 'FI']) {
      expect(hasEstonianTax(c)).toBe(false)
      expect(invoicesAvailable(c)).toBe(false)
    }
  })
})

describe('sample text in the clinic fields', () => {
  it('follows the country: no Tallinn or +372 in a Latvian clinic', () => {
    const lv = fieldExamples('LV')
    expect(lv.city).toBe('Rīga')
    expect(Object.values(lv).join(' ')).not.toMatch(/Tallinn|\+372|EE\d|OÜ/)
    expect(fieldExamples('EE').phone).toMatch(/^\+372/)
    expect(fieldExamples('FI').city).toBe('')
  })
})

describe("the employer's share for the staff (Finance, Statistics)", () => {
  it('Latvia: each person at their own rate, a pensioner at 20.77%', () => {
    const staff = [{ grossPay: 2000, pensioner: false }, { grossPay: 1000, pensioner: true }]
    const pct = employerRateForStaff('LV', 33, staff, 2026)
    // 2000 × 23.59% + 1000 × 20.77% = 471.80 + 207.70 = 679.50, on 3000 gross
    expect(Math.round(3000 * pct) / 100).toBe(679.5)
    expect(employerRateForStaff('LV', 33, [{ grossPay: 1500, pensioner: true }], 2026)).toBeCloseTo(20.77, 10)
    expect(employerRateForStaff('LV', 33, [{ grossPay: 1500 }], 2026)).toBeCloseTo(23.59, 10)
  })

  it('Latvia with no wages yet: the ordinary rate', () => {
    expect(employerRateForStaff('LV', 33, [], 2026)).toBe(23.59)
  })

  it("anywhere else: the Settings rate, whoever is a pensioner", () => {
    expect(employerRateForStaff('EE', 33, [{ grossPay: 1000, pensioner: true }], 2026)).toBe(33)
    expect(employerRateForStaff('FI', 0, [{ grossPay: 1000 }], 2026)).toBe(0)
  })
})
