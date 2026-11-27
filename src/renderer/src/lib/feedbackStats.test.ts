import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { remakesByPerson, ratingsByPerson } from './feedbackStats'

const rev = (reasons: string[]) => ({ id: 'r', ts: '2026-11-27', note: '', reasons }) as never

describe('remakes per person (sql/144)', () => {
  it('each person on a job once; the rate per 100 jobs; reasons most given first', () => {
    const rows = remakesByPerson([
      { assigned_to: 'tech', designed_by: 'des', revisions: [rev(['Halb passivus'])] },
      { assigned_to: 'tech', designed_by: 'tech', revisions: [rev(['Vale värv']), rev(['Halb passivus'])] },
      { assigned_to: 'tech', designed_by: null, revisions: [] },
      { assigned_to: null, designed_by: null, revisions: [rev(['Muu'])] },
    ])
    const tech = rows.find(r => r.id === 'tech')!
    expect(tech).toMatchObject({ jobs: 3, remakes: 3, rate: 100 })
    expect(tech.reasons).toEqual([['Halb passivus', 2], ['Vale värv', 1]])
    expect(rows.find(r => r.id === 'des')).toMatchObject({ jobs: 1, remakes: 1 })
    expect(rows).toHaveLength(2)
  })
})

describe('ratings per person', () => {
  it('the work and the input apart; client ratings are not a person’s; nobody unrated shows as zero', () => {
    const out = ratingsByPerson([
      { direction: 'work', ratee_profile: 'tech', score: 4 },
      { direction: 'work', ratee_profile: 'tech', score: 5 },
      { direction: 'input', ratee_profile: 'doc', score: 3 },
      { direction: 'clinic_to_client', ratee_profile: null, score: 1 },
    ])
    expect(out.find(r => r.id === 'tech')).toEqual({ id: 'tech', work: { average: 4.5, count: 2 }, input: null })
    expect(out.find(r => r.id === 'doc')).toEqual({ id: 'doc', work: null, input: { average: 3, count: 1 } })
    expect(out).toHaveLength(2)
  })
})
