import { describe, expect, it } from 'vitest'
import { deliveryStep, isReceived, notConfirmed, reminderDays, mayRemake, PROBLEM_REASONS, RESOLUTIONS, problemReasonText, resolutionText } from './delivery'

const day = 86_400_000
const now = new Date('2026-11-27T12:00:00Z')
const ago = (days: number) => new Date(now.getTime() - days * day).toISOString()

describe('delivery steps (sql/145)', () => {
  it('Sent → Received, or a problem in between', () => {
    expect(deliveryStep({ delivery_status: 'labor', sent_at: null }, false)).toBe('not_sent')
    expect(deliveryStep({ delivery_status: 'teel', sent_at: ago(1), received_at: null }, false)).toBe('awaiting')
    expect(deliveryStep({ delivery_status: 'teel', sent_at: ago(1), received_at: null }, true)).toBe('problem')
    expect(deliveryStep({ delivery_status: 'teel', sent_at: ago(1), received_at: ago(0) }, false)).toBe('received')
  })

  it('sent before 145 (no sent_at), or a database without it: received', () => {
    expect(isReceived({ delivery_status: 'teel', sent_at: null })).toBe(true)
    expect(isReceived({ delivery_status: 'yle_antud' })).toBe(true)
    expect(isReceived({ delivery_status: 'labor' })).toBe(false)
  })

  it('"Not confirmed" only after the days, only while waiting', () => {
    expect(notConfirmed({ delivery_status: 'teel', sent_at: ago(2) }, false, 3, now)).toBe(false)
    expect(notConfirmed({ delivery_status: 'teel', sent_at: ago(4) }, false, 3, now)).toBe(true)
    expect(notConfirmed({ delivery_status: 'teel', sent_at: ago(4) }, true, 3, now)).toBe(false)
    expect(notConfirmed({ delivery_status: 'teel', sent_at: ago(4), received_at: ago(1) }, false, 3, now)).toBe(false)
  })

  it('the reminder days as the database reads them', () => {
    expect(reminderDays(undefined)).toBe(3)
    expect(reminderDays(0)).toBe(1)
    expect(reminderDays(99)).toBe(60)
    expect(reminderDays(7)).toBe(7)
  })

  it('a remake only for damaged work or a wrong item; every reason and resolution has a label', () => {
    expect(PROBLEM_REASONS.filter(mayRemake)).toEqual(['damaged', 'wrong_item'])
    for (const r of PROBLEM_REASONS) expect(problemReasonText(r)).not.toMatch(/^delivery\./)
    for (const r of RESOLUTIONS) expect(resolutionText(r)).not.toMatch(/^delivery\./)
  })
})
