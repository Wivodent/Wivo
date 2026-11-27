/**
 * Feedback after the work is done (sql/144, module `ratings`).
 *
 *  - JobFeedback, on the job page once the work is at its last stage or sent:
 *    for the doctor who ordered it (a clinic doctor, the owner) "Fitted ✓" and
 *    "Needs adjustment" (a reason from the remake reasons and a text: a
 *    revision is made and the technician and designer are told), and a 1–5
 *    rating of the work; for the technician or designer a 1–5 rating of the
 *    input (the scan, the information).
 *  - MyFeedback: a person's own average and the comments, never who or which job.
 *  - Stars and AdjustFields, shared with the Network client's form.
 *
 * The database decides who may (job_fit_decide, rate_job); the buttons are
 * shown to whoever it would let.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, PencilLine } from 'lucide-react'
import { Stars, AdjustFields } from './FeedbackFields'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { usePipeline } from '../../context/PipelineContext'
import { revisionReasonText, type Job } from '../../types/job'
import { describeError } from '../Patients/errors'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { remakesByPerson, ratingsByPerson, type RatingRow } from '../../lib/feedbackStats'
import { t, dateLocale } from '@/lib/i18n'

interface FitRow { decision: 'fitted' | 'adjust'; reason: string | null; created_at: string }
interface MyRating { direction: 'work' | 'input'; score: number; comment: string | null }

export function JobFeedback({ job }: { job: Pick<Job, 'id' | 'status' | 'delivery_status' | 'order_doctor' | 'assigned_to' | 'designed_by'> & { fitted_at?: string | null } }) {
  const { moduleOn, isOwner } = usePermissions()
  const { doneStageKey } = usePipeline()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  const done = job.status === doneStageKey || job.delivery_status === 'teel' || job.delivery_status === 'yle_antud'
  const me = user?.id ?? null
  const isDoctor = !!me && (isOwner || job.order_doctor === me || profile?.org_role === 'doctor')
  const isMaker = !!me && (job.assigned_to === me || job.designed_by === me)
  const on = moduleOn('ratings') && done && (isDoctor || isMaker)
  const key = ['feedback', job.id]
  const data = useQuery<{ fit: FitRow | null; mine: MyRating[] }>({
    queryKey: key,
    enabled: on,
    queryFn: async () => {
      const [fit, mine] = await Promise.all([
        supabase.from('job_fit').select('decision, reason, created_at').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('job_rating').select('direction, score, comment').eq('job_id', job.id).eq('rater_profile', me!),
      ])
      return { fit: (fit.data?.[0] as FitRow | undefined) ?? null, mine: (mine.data ?? []) as MyRating[] }
    },
  })
  const [adjusting, setAdjusting] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!on) return null
  const fit = data.data?.fit ?? null
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['jobs'] }) }

  async function decide(decision: 'fitted' | 'adjust') {
    setBusy(true); setError(null)
    const { error: e } = await supabase.rpc('job_fit_decide', { p_job: job.id, p_decision: decision, p_reason: reason || null, p_note: note || null })
    setBusy(false)
    if (e) { setError(describeError(e)); return }
    setAdjusting(false); setReason(''); setNote('')
    refresh()
  }
  async function rate(direction: 'work' | 'input', score: number, comment: string | null) {
    setError(null)
    const { error: e } = await supabase.rpc('rate_job', { p_job: job.id, p_direction: direction, p_score: score, p_comment: comment })
    if (e) setError(describeError(e)); else refresh()
  }
  const mine = (d: 'work' | 'input') => data.data?.mine.find(r => r.direction === d) ?? null

  return (
    <section className="space-y-3 rounded-xl bg-bg-card px-5 py-4" aria-label={t('feedback.title')}>
      <h3 className="text-base font-bold text-ink">{t('feedback.title')}</h3>
      {isDoctor && (
        <div className="space-y-2">
          {job.fitted_at
            ? <p className="flex items-center gap-1 text-sm font-semibold text-emerald-700"><Check size={16} aria-hidden="true" /> {t('feedback.fittedOn', { date: format(new Date(job.fitted_at), 'd MMM yyyy', { locale: dateLocale }) })}</p>
            : fit?.decision === 'adjust' && <p className="text-sm text-amber-700">{t('feedback.adjustAsked', { reason: revisionReasonText(fit.reason ?? '') })}</p>}
          {!adjusting ? (
            <div className="flex flex-wrap gap-2">
              {!job.fitted_at && (
                <button type="button" disabled={busy} onClick={() => void decide('fitted')} className="btn-primary h-10 px-4 text-sm">
                  <Check size={16} aria-hidden="true" /> {t('feedback.fitted')}</button>
              )}
              <button type="button" disabled={busy} onClick={() => setAdjusting(true)} className="btn-ghost h-10 border border-ink-faint/30 px-4 text-sm">
                <PencilLine size={16} aria-hidden="true" /> {t('feedback.needsAdjustment')}</button>
            </div>
          ) : (
            <div className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
              <AdjustFields reason={reason} note={note} onReason={setReason} onNote={setNote} />
              <p className="text-xs text-ink-muted">{t('feedback.adjustMakesRevision')}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdjusting(false)} className="btn-ghost h-10 px-4 text-sm">{t('confirm.cancel')}</button>
                <button type="button" disabled={busy || !reason || !note.trim()} onClick={() => void decide('adjust')} className="btn-primary h-10 px-4 text-sm">{t('feedback.sendAdjustment')}</button>
              </div>
            </div>
          )}
          <RateRow label={t('feedback.rateWork')} current={mine('work')} onSave={(s, c) => rate('work', s, c)} />
        </div>
      )}
      {isMaker && job.order_doctor && job.order_doctor !== me && (
        <RateRow label={t('feedback.rateInput')} current={mine('input')} onSave={(s, c) => rate('input', s, c)} />
      )}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </section>
  )
}

function RateRow({ label, current, onSave }: { label: string; current: MyRating | null; onSave: (score: number, comment: string | null) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(current?.score ?? null)
  const [comment, setComment] = useState(current?.comment ?? '')
  const [saved, setSaved] = useState(false)
  return (
    <div className="space-y-2 border-t border-ink-faint/15 pt-3">
      <p className="text-sm font-semibold text-ink">{label} <span className="font-normal text-ink-muted">({t('feedback.optional')})</span></p>
      <Stars value={score} onChange={n => { setScore(n); setSaved(false) }} label={label} />
      <div className="flex gap-2">
        <input className="input h-10 flex-1 text-sm" maxLength={1000} value={comment} onChange={e => { setComment(e.target.value); setSaved(false) }} placeholder={t('feedback.comment')} aria-label={t('feedback.comment')} />
        <button type="button" disabled={score === null} onClick={async () => { await onSave(score!, comment.trim() || null); setSaved(true) }} className="btn-primary h-10 px-4 text-sm">
          {saved ? t('feedback.saved') : t('feedback.save')}</button>
      </div>
    </div>
  )
}

/** A person's own ratings: the average and the comments by month. Never who gave them or for which job. */
export function MyFeedback() {
  const { moduleOn } = usePermissions()
  const summary = useQuery<{ count: number; average: number | null; comments: { score: number; comment: string; month: string }[] } | null>({
    queryKey: ['feedback', 'mine'],
    enabled: moduleOn('ratings'),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_rating_summary')
      return error ? null : data
    },
  }).data
  if (!moduleOn('ratings') || !summary) return null
  return (
    <section className="space-y-2" aria-label={t('feedback.myTitle')}>
      <h4 className="text-sm font-semibold text-ink">{t('feedback.myTitle')}</h4>
      {summary.count === 0
        ? <p className="text-sm text-ink-muted">{t('feedback.myNone')}</p>
        : <p className="text-base text-ink">{t('feedback.myAverage', { average: Number(summary.average).toFixed(1), n: summary.count })}</p>}
      {summary.comments.length > 0 && (
        <ul className="space-y-1">
          {summary.comments.map((c, i) => (
            <li key={i} className="text-sm text-ink-soft">
              <span className="font-semibold text-amber-600">{'★'.repeat(c.score)}</span> {c.comment} <span className="text-xs text-ink-muted">{c.month}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">{t('feedback.myPrivacy')}</p>
    </section>
  )
}

/**
 * For the owner, on the Production tab: remakes per person (the rate and the
 * reasons) and the ratings each person received. Only the owner: people do
 * not see each other's numbers.
 */
export function FeedbackStats({ jobs }: { jobs: readonly Job[] }) {
  const { moduleOn, isOwner } = usePermissions()
  const on = moduleOn('ratings') && isOwner
  const people = useClinicProfiles().data ?? []
  const ratings = useQuery<RatingRow[]>({
    queryKey: ['feedback', 'all-ratings'],
    enabled: on,
    queryFn: async () => {
      const { data, error } = await supabase.from('job_rating').select('direction, ratee_profile, score')
      return error ? [] : (data ?? []) as RatingRow[]
    },
  }).data ?? []
  if (!on) return null
  const name = (id: string) => people.find(p => p.id === id)?.full_name || t('workers.noNameYet')
  const remakes = remakesByPerson(jobs)
  const rated = ratingsByPerson(ratings)
  return (
    <section className="space-y-3" aria-label={t('feedback.statsTitle')}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{t('feedback.statsTitle')}</h3>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <p className="mb-0.5 text-sm font-semibold text-ink">{t('feedback.remakesByPerson')}</p>
          <p className="mb-3 text-xs text-ink-faint">{t('dashboard.revisionsPer100Jobs')}</p>
          {remakes.length === 0 ? <p className="py-4 text-center text-sm text-ink-faint">{t('dashboard.noData')}</p> : (
            <ul className="space-y-2">
              {remakes.map(r => (
                <li key={r.id} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate text-ink">{name(r.id)}</span>
                    <span className="w-14 text-right font-semibold tabular-nums text-ink">{r.rate.toFixed(0)}%</span>
                    <span className="w-16 text-right tabular-nums text-ink-faint">{r.remakes}/{r.jobs}</span>
                  </div>
                  {r.reasons.length > 0 && (
                    <p className="text-xs text-ink-muted">{r.reasons.slice(0, 3).map(([reason, n]) => `${revisionReasonText(reason)} ${n}`).join(' · ')}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-4">
          <p className="mb-3 text-sm font-semibold text-ink">{t('feedback.ratingsByPerson')}</p>
          {rated.length === 0 ? <p className="py-4 text-center text-sm text-ink-faint">{t('feedback.noRatings')}</p> : (
            <ul className="space-y-2">
              {rated.map(r => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span className="flex-1 truncate text-ink">{name(r.id)}</span>
                  {r.work && <span className="tabular-nums text-ink">{t('feedback.workAvg', { average: r.work.average.toFixed(1), n: r.work.count })}</span>}
                  {r.input && <span className="tabular-nums text-ink-muted">{t('feedback.inputAvg', { average: r.input.average.toFixed(1), n: r.input.count })}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
