/**
 * Feedback after the work is done (sql/144, module `ratings`).
 *
 *  - JobFeedback, on the job page once the work is received (sql/145: Sent →
 *    Received → Fitted), and from then on for good: anything can be changed
 *    later, weeks later too (every change of a rating is kept, sql/145):
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
import { isReceived } from '../../lib/delivery'
import { revisionReasonText, type Job } from '../../types/job'
import { describeError } from '../Patients/errors'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { remakesByPerson, ratingsByPerson, type RatingRow } from '../../lib/feedbackStats'
import { useOrderOfJob } from '../Network/MarkSent'
import { feedbackRoles } from '../../lib/feedbackRoles'
import { t, dateLocale } from '@/lib/i18n'

interface FitRow { decision: 'fitted' | 'adjust'; reason: string | null; created_at: string; by_client?: string | null }
interface MyRating { direction: 'work' | 'input'; score: number; comment: string | null; created_at?: string; updated_at?: string }

export function JobFeedback({ job }: { job: Pick<Job, 'id' | 'status' | 'delivery_status' | 'order_doctor' | 'assigned_to' | 'designed_by' | 'sent_at' | 'received_at'> & { fitted_at?: string | null } }) {
  const { moduleOn, isOwner } = usePermissions()
  const { user, profile } = useAuth()
  const qc = useQueryClient()
  // Received (or sent before that step existed, or a database before sql/145): feedback is open.
  const done = isReceived(job)
  const me = user?.id ?? null
  // sql/146: only someone on the work rates it; on an order from outside the client says how it fitted.
  const order = useOrderOfJob(job.id)
  const fromOutside = !!order.data
  const roles = feedbackRoles(job, { me, isOwner, isDoctor: profile?.org_role === 'doctor', fromOutside, orderKnown: order.isFetched })
  const { mayFit, rateWork, rateInput, rateClient } = roles
  const isDoctor = mayFit || rateWork
  const on = moduleOn('ratings') && done && (mayFit || rateWork || rateInput || rateClient)
  const key = ['feedback', job.id]
  const data = useQuery<{ fit: FitRow | null; mine: MyRating[] }>({
    queryKey: key,
    enabled: on,
    queryFn: async () => {
      const [fit, mine] = await Promise.all([
        supabase.from('job_fit').select('decision, reason, created_at, by_client').eq('job_id', job.id).order('created_at', { ascending: false }).limit(1),
        supabase.from('job_rating').select('direction, score, comment, created_at, updated_at').eq('job_id', job.id).eq('rater_profile', me!),
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
    if (e) { setError(describeError(e)); throw e }
    refresh()
  }
  const mine = (d: 'work' | 'input') => data.data?.mine.find(r => r.direction === d) ?? null

  return (
    <section className="space-y-3 rounded-xl bg-bg-card px-5 py-4" aria-label={t('feedback.title')}>
      <h3 className="text-base font-bold text-ink">{t('feedback.title')}</h3>
      {/* An order from outside: what the client said (it decides), and the clinic's rating of its input. */}
      {fromOutside && fit?.by_client && (
        <p className={`text-sm font-semibold ${fit.decision === 'fitted' ? 'text-emerald-700' : 'text-amber-700'}`}>
          {fit.decision === 'fitted' ? t('feedback.clientFitted') : t('feedback.clientAdjust')}
          {fit.decision === 'adjust' && fit.reason ? ` · ${revisionReasonText(fit.reason)}` : ''}
        </p>
      )}
      {fromOutside && rateClient && order.data && <RateClientRow orderId={order.data} jobId={job.id} />}
      {isDoctor && (
        <div className="space-y-2">
          {mayFit && (job.fitted_at
            ? <p className="flex items-center gap-1 text-sm font-semibold text-emerald-700"><Check size={16} aria-hidden="true" /> {t('feedback.fittedOn', { date: format(new Date(job.fitted_at), 'd MMM yyyy', { locale: dateLocale }) })}</p>
            : fit?.decision === 'adjust' && <p className="text-sm text-amber-700">{t('feedback.adjustAsked', { reason: revisionReasonText(fit.reason ?? '') })}</p>)}
          {!mayFit ? null : !adjusting ? (
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
          {rateWork && data.isFetched && <RateRow key={`work:${mine('work')?.updated_at ?? ''}`} label={t('feedback.rateWork')} current={mine('work')} onSave={(s, c) => rate('work', s, c)} />}
        </div>
      )}
      {rateInput && data.isFetched && (
        <RateRow key={`input:${mine('input')?.updated_at ?? ''}`} label={t('feedback.rateInput')} current={mine('input')} onSave={(s, c) => rate('input', s, c)} />
      )}
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </section>
  )
}

/**
 * A rating that stays open: shows what was given (and when it was last
 * changed), and saves a change at any time.
 */
export function RateRow({ label, current, onSave }: { label: string; current: Pick<MyRating, 'score' | 'comment' | 'created_at' | 'updated_at'> | null; onSave: (score: number, comment: string | null) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(current?.score ?? null)
  const [comment, setComment] = useState(current?.comment ?? '')
  const [saved, setSaved] = useState(false)
  const changed = current?.updated_at && current.created_at && current.updated_at.slice(0, 19) !== current.created_at.slice(0, 19)
  return (
    <div className="space-y-2 border-t border-ink-faint/15 pt-3">
      <p className="text-sm font-semibold text-ink">{label} <span className="font-normal text-ink-muted">({t('feedback.optional')})</span></p>
      {current && (
        <p className="text-xs text-ink-muted">
          {changed ? t('feedback.changedOn', { date: format(new Date(current.updated_at!), 'd MMM yyyy', { locale: dateLocale }) }) : t('feedback.canChange')}
        </p>
      )}
      <Stars value={score} onChange={n => { setScore(n); setSaved(false) }} label={label} />
      <div className="flex gap-2">
        <input className="input h-10 flex-1 text-sm" maxLength={1000} value={comment} onChange={e => { setComment(e.target.value); setSaved(false) }} placeholder={t('feedback.comment')} aria-label={t('feedback.comment')} />
        <button type="button" disabled={score === null} onClick={async () => { try { await onSave(score!, comment.trim() || null); setSaved(true) } catch { setSaved(false) } }} className="btn-primary h-10 px-4 text-sm">
          {saved ? t('feedback.saved') : t('feedback.save')}</button>
      </div>
    </div>
  )
}

/**
 * The clinic's rating of a Network client's input (clinic_to_client): for
 * someone on the job, once the order is received, open for good. The form is
 * made only after what this person gave before has loaded, so it shows it
 * (the form used to start empty and stay so, sql/144); saving again changes
 * that one row (sql/146).
 */
export function RateClientRow({ orderId, jobId }: { orderId: string; jobId: string }) {
  const { moduleOn } = usePermissions()
  const { user } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const on = moduleOn('ratings')
  const mine = useQuery<{ score: number; comment: string | null; created_at: string; updated_at: string } | null>({
    queryKey: ['feedback', jobId, 'client', user?.id],
    enabled: on && !!user,
    queryFn: async () => {
      const { data, error: e } = await supabase.from('job_rating').select('score, comment, created_at, updated_at')
        .eq('job_id', jobId).eq('direction', 'clinic_to_client').eq('rater_profile', user!.id).limit(1)
      if (e) throw e
      return (data?.[0] as { score: number; comment: string | null; created_at: string; updated_at: string } | undefined) ?? null
    },
  })
  if (!on || !mine.isFetched) return null
  return (
    <div className="space-y-2">
      <RateRow key={mine.data?.updated_at ?? 'none'} label={t('feedback.rateClient')} current={mine.data ?? null}
        onSave={async (score, comment) => {
          setError(null)
          const { error: e } = await supabase.rpc('rate_client', { p_order: orderId, p_score: score, p_comment: comment })
          if (e) { setError(describeError(e)); throw e }
          await mine.refetch()
        }} />
      {(error || mine.isError) && <p className="text-sm text-rose-600" role="alert">{error ?? describeError(mine.error)}</p>}
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
