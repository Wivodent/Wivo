/**
 * The delivery of a sent job (sql/145), on the job page, the phone's job
 * page and the Orders page's order: Sent → Received, or a problem until the
 * clinic resolves it. Works with or without the `ratings` module.
 *
 *  - Our own job, for whoever ordered it (the doctor who ordered it, a doctor
 *    of the clinic, the owner): "Received ✓" and "Problem with delivery"
 *    (a reason and what happened).
 *  - Anyone who edits jobs: "Received (confirmed by phone)" with a note, for
 *    our own job or an order from outside (the client says it itself on
 *    /network); "Resolved" on an open problem (resend, replaced, other, a
 *    note; for damaged work or a wrong item, optionally a remake).
 *  - "Not confirmed" once the clinic's days have passed without Received.
 *
 * The database decides who may (job_mark_received, job_report_problem,
 * job_resolve_problem); the buttons are shown to whoever it would let. A
 * database before 145 (no sent_at on the job) shows nothing.
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Phone, Truck } from 'lucide-react'
import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useSettings } from '../../stores/useSettings'
import { PORTAL_KEY } from '../../hooks/useNetworkPortal'
import { useOrderOfJob } from '../Network/MarkSent'
import { ProblemFields } from './DeliveryFields'
import { deliveryStep, notConfirmed, reminderDays, mayRemake, RESOLUTIONS, problemReasonText, resolutionText } from '../../lib/delivery'
import { confirmDialog } from '../../lib/confirm'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

export interface DeliveryJobRow {
  id: string
  delivery_status?: string | null
  sent_at?: string | null
  received_at?: string | null
  received_via?: string | null
  received_note?: string | null
  order_doctor?: string | null
}

interface ProblemRow { id: string; reason: string; note: string; created_at: string; resolved_at: string | null; resolution: string | null; resolution_note: string | null }

const day = (iso: string) => format(new Date(iso), 'd MMM yyyy', { locale: dateLocale })

/** The latest delivery problem on a job, open or resolved; null before sql/145 or with none. */
export function useJobProblem(jobId: string, enabled: boolean) {
  return useQuery<ProblemRow | null>({
    queryKey: ['delivery', jobId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from('delivery_problem')
        .select('id, reason, note, created_at, resolved_at, resolution, resolution_note')
        .eq('job_id', jobId).order('created_at', { ascending: false }).limit(1)
      if (error) return null
      return (data?.[0] as ProblemRow | undefined) ?? null
    },
  })
}

export function JobDelivery({ job, orderId }: { job: DeliveryJobRow; orderId?: string | null }) {
  const { user, profile } = useAuth()
  const { can, isOwner } = usePermissions()
  const days = reminderDays(useSettings().settings.vastuvotuPaevad)
  const qc = useQueryClient()
  const known = job.sent_at !== undefined
  const sentNow = job.delivery_status === 'teel' || job.delivery_status === 'yle_antud'
  const problemQ = useJobProblem(job.id, known && sentNow)
  const order = useOrderOfJob(job.id, orderId ?? undefined)
  const [mode, setMode] = useState<'idle' | 'problem' | 'phone' | 'resolve'>('idle')
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [resolution, setResolution] = useState('')
  const [remake, setRemake] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!known || !sentNow) return null

  const problem = problemQ.data ?? null
  const open = !!problem && !problem.resolved_at
  const step = deliveryStep(job, open)
  // Sent before this step existed: nothing to say about it.
  if (step === 'received' && !job.received_at && !problem) return null
  const fromOutside = !!(orderId ?? order.data)
  const me = user?.id ?? null
  const isOrderer = !fromOutside && !!me && (isOwner || job.order_doctor === me || profile?.org_role === 'doctor')
  const canWrite = can('jobs.write')
  const waiting = step === 'awaiting' || step === 'problem'
  const late = notConfirmed(job, open, days)

  const reset = () => { setMode('idle'); setReason(''); setNote(''); setResolution(''); setRemake(false) }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['delivery', job.id] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: [...PORTAL_KEY] })
    void qc.invalidateQueries({ queryKey: ['feedback', job.id] })
  }
  async function run(fn: () => PromiseLike<{ error: unknown }>) {
    setBusy(true); setError(null)
    const { error: e } = await fn()
    setBusy(false)
    if (e) { setError(describeError(e)); return }
    reset(); refresh()
  }
  async function received(byPhone: boolean) {
    if (!byPhone && !(await confirmDialog({ message: t('delivery.receivedAsk'), confirmLabel: t('delivery.received') }))) return
    await run(() => supabase.rpc('job_mark_received', { p_job: job.id, p_by_phone: byPhone, p_note: byPhone ? note.trim() || null : null }))
  }

  return (
    <section className="space-y-3 rounded-xl bg-bg-card px-5 py-4" aria-label={t('delivery.title')}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-base font-bold text-ink">{t('delivery.title')}</h3>
        {step === 'problem' && <span className="rounded-full bg-rose-600 px-2.5 py-1 text-xs font-bold text-white">{t('delivery.problemBadge')}</span>}
        {late && <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-800">{t('delivery.notConfirmed')}</span>}
      </div>

      {job.sent_at && <p className="flex items-center gap-1 text-sm text-ink-muted"><Truck size={16} aria-hidden="true" /> {t('delivery.sentOn', { date: day(job.sent_at) })}</p>}
      {step === 'received' && job.received_at && (
        <p className="flex items-center gap-1 text-sm font-semibold text-emerald-700">
          <Check size={16} aria-hidden="true" /> {receivedLine(job)}
        </p>
      )}

      {open && problem && (
        <div className="space-y-1 rounded-xl border-2 border-rose-300 bg-rose-500/10 p-3">
          <p className="flex items-center gap-1 text-sm font-bold text-rose-700"><AlertTriangle size={16} aria-hidden="true" /> {problemReasonText(problem.reason)} · {day(problem.created_at)}</p>
          <p className="whitespace-pre-wrap text-sm text-ink">{problem.note}</p>
        </div>
      )}
      {problem?.resolved_at && problem.resolution && (
        <p className="text-sm text-ink-muted">{t('delivery.resolvedLine', { reason: problemReasonText(problem.reason), resolution: resolutionText(problem.resolution) })}
          {problem.resolution_note ? ` — ${problem.resolution_note}` : ''}</p>
      )}

      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {waiting && isOrderer && (
            <button type="button" disabled={busy} onClick={() => void received(false)} className="btn-primary h-10 px-4 text-sm">
              <Check size={16} aria-hidden="true" /> {t('delivery.received')}</button>
          )}
          {step === 'awaiting' && isOrderer && (
            <button type="button" disabled={busy} onClick={() => setMode('problem')} className="btn-ghost h-10 border border-ink-faint/30 px-4 text-sm">
              <AlertTriangle size={16} aria-hidden="true" /> {t('delivery.problem')}</button>
          )}
          {waiting && canWrite && !isOrderer && (
            <button type="button" disabled={busy} onClick={() => setMode('phone')} className="btn-ghost h-10 border border-ink-faint/30 px-4 text-sm">
              <Phone size={16} aria-hidden="true" /> {t('delivery.receivedByPhone')}</button>
          )}
          {open && canWrite && (
            <button type="button" disabled={busy} onClick={() => setMode('resolve')} className="btn-primary h-10 px-4 text-sm">{t('delivery.resolve')}</button>
          )}
        </div>
      )}

      {mode === 'problem' && (
        <div className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
          <ProblemFields reason={reason} note={note} onReason={setReason} onNote={setNote} />
          <p className="text-xs text-ink-muted">{t('delivery.problemTells')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="btn-ghost h-10 px-4 text-sm">{t('confirm.cancel')}</button>
            <button type="button" disabled={busy || !reason || !note.trim()} className="btn-primary h-10 px-4 text-sm"
              onClick={() => void run(() => supabase.rpc('job_report_problem', { p_job: job.id, p_reason: reason, p_note: note.trim() }))}>
              {t('delivery.sendProblem')}</button>
          </div>
        </div>
      )}

      {mode === 'phone' && (
        <div className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
          <label className="block"><span className="label">{t('delivery.phoneNote')}</span>
            <input className="input h-11 text-base" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder={t('delivery.phoneNoteHint')} /></label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="btn-ghost h-10 px-4 text-sm">{t('confirm.cancel')}</button>
            <button type="button" disabled={busy} onClick={() => void received(true)} className="btn-primary h-10 px-4 text-sm">
              <Phone size={16} aria-hidden="true" /> {t('delivery.markReceived')}</button>
          </div>
        </div>
      )}

      {mode === 'resolve' && problem && (
        <div className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
          <label className="block"><span className="label">{t('delivery.howResolved')}</span>
            <select className="input h-11 text-base" value={resolution} onChange={e => setResolution(e.target.value)}>
              <option value="">{t('delivery.chooseResolution')}</option>
              {RESOLUTIONS.map(r => <option key={r} value={r}>{resolutionText(r)}</option>)}
            </select>
          </label>
          <label className="block"><span className="label">{t('delivery.resolveNote')}{resolution === 'other' ? '' : ` (${t('feedback.optional')})`}</span>
            <textarea className="input min-h-16 text-base" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
          {mayRemake(problem.reason) && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 h-5 w-5" checked={remake} onChange={e => setRemake(e.target.checked)} />
              <span>{t('delivery.addRemake')}<span className="block text-xs text-ink-muted">{t('delivery.addRemakeHelp')}</span></span>
            </label>
          )}
          <p className="text-xs text-ink-muted">{fromOutside ? t('delivery.resolveTellsClient') : t('delivery.resolveTellsReporter')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="btn-ghost h-10 px-4 text-sm">{t('confirm.cancel')}</button>
            <button type="button" disabled={busy || !resolution || (resolution === 'other' && !note.trim())} className="btn-primary h-10 px-4 text-sm"
              onClick={() => void run(() => supabase.rpc('job_resolve_problem', { p_problem: problem.id, p_resolution: resolution, p_note: note.trim() || null, p_remake: remake }))}>
              {t('delivery.markResolved')}</button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
    </section>
  )
}

/** "Received 24 Nov 2026", and how: by the client, confirmed by phone (with the note), handed over. */
function receivedLine(job: DeliveryJobRow): string {
  const date = day(job.received_at!)
  if (job.received_via === 'phone') return job.received_note ? t('delivery.receivedPhoneNote', { date, note: job.received_note }) : t('delivery.receivedPhone', { date })
  if (job.received_via === 'client') return t('delivery.receivedClient', { date })
  if (job.received_via === 'handed_over') return t('delivery.receivedHandedOver', { date })
  return t('delivery.receivedOn', { date })
}
