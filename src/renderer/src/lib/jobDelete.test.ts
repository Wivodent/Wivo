import { describe, expect, it } from 'vitest'
import { deleteVerdict, codeMatches, inBinWindow, type DeleteCheck } from './jobDelete'

const base: DeleteCheck = { job_code: 'DE-0042', order: null, invoice_lines: 0, payments: 0, pay_lines: 0, files: 2, blocked: null }

describe('what deleting a job may do (sql/146)', () => {
  it('money or a pay line: not at all; an order: the code and a reason; else a plain confirmation', () => {
    expect(deleteVerdict(base)).toBe('plain')
    expect(deleteVerdict({ ...base, invoice_lines: 1, blocked: 'money' })).toBe('blocked_money')
    expect(deleteVerdict({ ...base, payments: 1 })).toBe('blocked_money')
    expect(deleteVerdict({ ...base, pay_lines: 1, blocked: 'pay' })).toBe('blocked_pay')
    expect(deleteVerdict({ ...base, order: { id: 'o', ref: 'TF-1', client: 'Tess' } })).toBe('order')
    // Money wins over an order: still not deletable.
    expect(deleteVerdict({ ...base, order: { id: 'o', ref: 'TF-1', client: 'Tess' }, invoice_lines: 1, blocked: 'money' })).toBe('blocked_money')
    // A database before 146: the plain confirmation, as before.
    expect(deleteVerdict(null)).toBe('plain')
  })

  it('the typed code, trimmed and in any case', () => {
    expect(codeMatches(' de-0042 ', 'DE-0042')).toBe(true)
    expect(codeMatches('DE-0043', 'DE-0042')).toBe(false)
    expect(codeMatches('', null)).toBe(false)
  })

  it('the bin shows 30 days', () => {
    const now = new Date('2026-11-27T12:00:00Z')
    expect(inBinWindow('2026-11-01T12:00:00Z', now)).toBe(true)
    expect(inBinWindow('2026-10-20T12:00:00Z', now)).toBe(false)
  })
})
