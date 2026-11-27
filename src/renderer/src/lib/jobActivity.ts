/**
 * "New activity" on a job card (sql/136): what someone else did on a job
 * since I last opened it. Pure, so the card and the phone say it the same way.
 */
import { t } from '@/lib/i18n'

/** One row of job_activity(): counts by kind, the latest time, who (at most five names). */
export interface JobActivity {
  job_id: string
  files: number
  notes: number
  messages: number
  stages: number
  last_at: string | null
  people: string[] | null
}

export type ActivityKind = 'file' | 'note' | 'message' | 'stage'

const KINDS: readonly ActivityKind[] = ['file', 'note', 'message', 'stage']

const countOf = (a: JobActivity, k: ActivityKind): number =>
  Math.max(0, Number(k === 'file' ? a.files : k === 'note' ? a.notes : k === 'message' ? a.messages : a.stages) || 0)

export interface ActivitySummary {
  /** Everything new, added up. */
  total: number
  /** The one kind there is, when there is only one: the card shows its icon. */
  only: ActivityKind | null
  /** "2 new: file, note · by Anna" */
  text: string
}

const kindWord = (k: ActivityKind): string =>
  k === 'file' ? t('activity.file') : k === 'note' ? t('activity.note') : k === 'message' ? t('activity.message') : t('activity.stage')

export function activitySummary(a: JobActivity | undefined | null): ActivitySummary | null {
  if (!a) return null
  const present = KINDS.filter(k => countOf(a, k) > 0)
  const total = present.reduce((sum, k) => sum + countOf(a, k), 0)
  if (total === 0) return null
  const people = (a.people ?? []).filter(Boolean)
  const head = t('activity.new', { n: total, what: present.map(kindWord).join(', ') })
  return {
    total,
    only: present.length === 1 ? present[0] : null,
    text: people.length ? `${head} · ${t('activity.by', { who: people.join(', ') })}` : head,
  }
}

/** The rows of job_activity() by job, for a card to look itself up. */
export function activityByJob(rows: readonly JobActivity[] | null | undefined): Map<string, JobActivity> {
  return new Map((rows ?? []).map(r => [r.job_id, r]))
}
