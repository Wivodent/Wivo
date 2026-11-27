/**
 * Remakes and ratings per person, for the owner's statistics (module
 * `ratings`, sql/144). Pure, so the numbers are tested without a database.
 * The remake rate per work type and the reasons overall already are on the
 * Production tab; this adds the same per person.
 */
import { revisionReasons, type Job, type Revision } from '../types/job'

export interface PersonRemakes { id: string; jobs: number; remakes: number; rate: number; reasons: [string, number][] }

/**
 * Per person on the job (the technician and the designer, each once per job):
 * how many jobs, how many remakes those jobs had, the rate per 100 jobs, and
 * the reasons most given first.
 */
export function remakesByPerson(jobs: readonly (Pick<Job, 'assigned_to' | 'designed_by'> & { revisions?: Revision[] | null })[]): PersonRemakes[] {
  const by = new Map<string, { jobs: number; remakes: number; reasons: Map<string, number> }>()
  for (const j of jobs) {
    const people = [...new Set([j.assigned_to, j.designed_by].filter((x): x is string => !!x))]
    const revs = j.revisions ?? []
    for (const p of people) {
      const cur = by.get(p) ?? { jobs: 0, remakes: 0, reasons: new Map<string, number>() }
      cur.jobs += 1
      cur.remakes += revs.length
      for (const r of revs) for (const reason of revisionReasons(r)) cur.reasons.set(reason, (cur.reasons.get(reason) ?? 0) + 1)
      by.set(p, cur)
    }
  }
  return [...by.entries()]
    .map(([id, v]) => ({ id, jobs: v.jobs, remakes: v.remakes, rate: v.jobs ? (v.remakes / v.jobs) * 100 : 0,
      reasons: [...v.reasons.entries()].sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.rate - a.rate || b.jobs - a.jobs)
}

export interface RatingRow { direction: 'work' | 'input' | 'client_to_clinic' | 'clinic_to_client'; ratee_profile: string | null; score: number }
export interface PersonRatings { id: string; work: { average: number; count: number } | null; input: { average: number; count: number } | null }

/** The average of the ratings each person received, the work and the input apart. Unrated is not zero: it is not there. */
export function ratingsByPerson(rows: readonly RatingRow[]): PersonRatings[] {
  const by = new Map<string, { work: number[]; input: number[] }>()
  for (const r of rows) {
    if (!r.ratee_profile || (r.direction !== 'work' && r.direction !== 'input')) continue
    const cur = by.get(r.ratee_profile) ?? { work: [], input: [] }
    cur[r.direction].push(r.score)
    by.set(r.ratee_profile, cur)
  }
  const avg = (xs: number[]) => (xs.length ? { average: xs.reduce((a, b) => a + b, 0) / xs.length, count: xs.length } : null)
  return [...by.entries()].map(([id, v]) => ({ id, work: avg(v.work), input: avg(v.input) }))
}
