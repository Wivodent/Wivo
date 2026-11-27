/**
 * "Mark as sent": a job at the last stage goes on its way.
 *
 * It sets the job's own delivery state to on its way ('teel', the same as
 * the job page's Delivery control), so the order moves to Sent on the Orders
 * page and the client is told "Your order TF-… is on its way" (sql/142's
 * trigger). A courier, a tracking number and a note are optional and are not
 * new fields: when given, they reach the client as one message on the order.
 *
 * Asked first, in a dialog that is the confirmation: a second, deliberate
 * click on "Mark as sent".
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useUpdateJob } from '../../hooks/useJobs'
import { usePermissions } from '../../hooks/usePermissions'
import { usePipeline } from '../../context/PipelineContext'
import { usePostOrderMessage } from '../../hooks/useNetworkPortal'
import { sentMessage } from '../../lib/orderView'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

/** The order a job came from, if any: its tracking line goes there. */
export function useOrderOfJob(jobId: string, known?: string) {
  return useQuery<string | null>({
    queryKey: ['network_portal', 'order-of-job', jobId],
    enabled: !known,
    queryFn: async () => {
      const { data, error } = await supabase.from('client_order').select('id').eq('job_id', jobId).limit(1)
      if (error) return null  // a database without orders, or no right to them: nothing to tell
      return (data?.[0]?.id as string | undefined) ?? null
    },
  })
}

/**
 * The button, shown only when the job is at the last stage, still at the lab,
 * and the person edits jobs.
 */
export function MarkSentButton({ job, orderId, className = '' }: {
  job: { id: string; status: string | null; delivery_status?: string | null }
  orderId?: string | null
  className?: string
}) {
  const { can } = usePermissions()
  const { doneStageKey } = usePipeline()
  const [open, setOpen] = useState(false)
  const atLab = (job.delivery_status ?? 'labor') === 'labor'
  if (!can('jobs.write') || job.status !== doneStageKey || !atLab) return null
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`btn-primary h-10 justify-center px-4 text-sm ${className}`}>
        <Truck size={16} aria-hidden="true" /> {t('orders.markSent')}
      </button>
      {open && <MarkSentDialog jobId={job.id} orderId={orderId ?? undefined} onClose={() => setOpen(false)} />}
    </>
  )
}

function MarkSentDialog({ jobId, orderId, onClose }: { jobId: string; orderId?: string; onClose: () => void }) {
  const update = useUpdateJob()
  const post = usePostOrderMessage()
  const found = useOrderOfJob(jobId, orderId)
  const order = orderId ?? found.data ?? null
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = update.isPending || post.isPending

  async function send() {
    setError(null)
    try {
      await update.mutateAsync({ id: jobId, delivery_status: 'teel', delivered_at: null })
      const text = sentMessage({ courier, tracking, note }, {
        title: t('orders.sentTitle'), courier: c => t('orders.sentCourier', { courier: c }), tracking: n => t('orders.sentTracking', { tracking: n }),
      })
      if (order && text) await post.mutateAsync({ p_order: order, p_body: text })
      onClose()
    } catch (e) { setError(describeError(e)) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="mark-sent-h" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <h2 id="mark-sent-h" className="flex-1 text-lg font-bold text-ink">{t('orders.markSentTitle')}</h2>
          <button type="button" onClick={onClose} aria-label={t('orders.close')} className="h-9 w-9 rounded-lg text-ink-muted hover:bg-bg-sidebar"><X size={18} className="mx-auto" /></button>
        </div>
        <p className="text-sm text-ink-muted">{order ? t('orders.markSentTextOrder') : t('orders.markSentText')}</p>
        <label className="block"><span className="label">{t('orders.courier')}</span>
          <input className="input h-11 text-base" maxLength={80} value={courier} onChange={e => setCourier(e.target.value)} /></label>
        <label className="block"><span className="label">{t('orders.trackingNumber')}</span>
          <input className="input h-11 text-base" maxLength={80} value={tracking} onChange={e => setTracking(e.target.value)} /></label>
        <label className="block"><span className="label">{t('orders.sentNote')}</span>
          <textarea className="input min-h-20 text-base" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></label>
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost h-11 px-4 text-sm">{t('confirm.cancel')}</button>
          <button type="button" onClick={() => void send()} disabled={busy} className="btn-primary h-11 px-5 text-sm">
            <Truck size={16} aria-hidden="true" /> {t('orders.markSent')}
          </button>
        </div>
      </div>
    </div>
  )
}
