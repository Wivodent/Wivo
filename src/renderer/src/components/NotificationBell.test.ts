/** sql/126: one notification names every stage a person was put on. */
import { describe, it, expect } from 'vitest'
import { assignedStages, text } from './NotificationBell'
import type { AppNotification } from '../hooks/useNotifications'

const note = (detail: Record<string, unknown>): AppNotification => ({
  id: 'n1', job_id: 'j1', job_code: 'T-12', kind: 'stage_assigned', detail, created_at: '2026-11-25T08:00:00Z', read_at: null,
}) as AppNotification
const label = (key: string) => ({ disain: 'Design', freesimine: 'Milling', viimistlus: 'Finishing' } as Record<string, string>)[key] ?? key

describe('stage_assigned', () => {
  it('names every stage when there are several, in one sentence (tests run in Estonian, the default)', () => {
    expect(assignedStages({ stage: 'disain', stages: ['disain', 'freesimine', 'viimistlus'] })).toEqual(['disain', 'freesimine', 'viimistlus'])
    expect(text(note({ stage: 'disain', new: false, stages: ['disain', 'freesimine', 'viimistlus'] }), label))
      .toBe('Sind pandi töö T-12 etappidele Design, Milling, Finishing')
    expect(text(note({ stage: 'disain', new: true, stages: ['disain', 'freesimine'] }), label))
      .toBe('Uus töö T-12: sina oled etappidel Design, Milling')
  })

  it('one stage reads as before, and a notification from before sql/126 too', () => {
    expect(assignedStages({ stage: 'disain', new: false })).toEqual(['disain'])
    expect(text(note({ stage: 'disain', new: false }), label)).toBe('Sind lisati töö T-12 etappi Design')
    expect(text(note({ stage: 'disain', new: true }), label)).toBe('Uus töö T-12: sina oled etapis Design')
    expect(assignedStages({ stages: 'nonsense' })).toEqual([])
  })
})
