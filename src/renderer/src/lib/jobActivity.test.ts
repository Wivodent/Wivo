import { describe, expect, it } from 'vitest'
import { activitySummary, activityByJob, type JobActivity } from './jobActivity'
import { t } from '@/lib/i18n'

const said = (n: number, what: string[], who?: string): string =>
  t('activity.new', { n, what: what.map(w => t(`activity.${w}` as 'activity.file')).join(', ') }) + (who ? ` · ${t('activity.by', { who })}` : '')

const row = (over: Partial<JobActivity>): JobActivity =>
  ({ job_id: 'j1', files: 0, notes: 0, messages: 0, stages: 0, last_at: null, people: null, ...over })

describe('the "new activity" mark', () => {
  it('says what and who: "2 new: file, note · by Anna"', () => {
    const s = activitySummary(row({ files: 1, notes: 1, people: ['Anna'] }))
    expect(s).toEqual({ total: 2, only: null, text: said(2, ['file', 'note'], 'Anna') })
  })

  it('one kind: its icon', () => {
    expect(activitySummary(row({ files: 3 }))).toMatchObject({ total: 3, only: 'file', text: said(3, ['file']) })
    expect(activitySummary(row({ stages: 1, people: ['Dana', 'Tomas'] }))?.text).toBe(said(1, ['stage'], 'Dana, Tomas'))
  })

  it('nothing new: no mark', () => {
    expect(activitySummary(row({}))).toBeNull()
    expect(activitySummary(undefined)).toBeNull()
  })

  it('looks a card up by its job', () => {
    const map = activityByJob([row({ job_id: 'a', files: 1 }), row({ job_id: 'b', notes: 2 })])
    expect(map.get('b')?.notes).toBe(2)
    expect(map.get('c')).toBeUndefined()
  })
})
