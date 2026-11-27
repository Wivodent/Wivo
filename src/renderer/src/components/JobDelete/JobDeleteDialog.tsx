/**
 * "Delete this job?" (sql/146), on the desk and the phone. It first asks the
 * database what the job is tied to (job_delete_check) and says so:
 *
 *  - an invoice line, a payment or a pay line: it cannot be deleted, and why;
 *  - an order from a Network client: "The client will see it as cancelled",
 *    a reason for the client, and the job's code typed to confirm;
 *  - anything else: a plain confirmation (and its files, if any, stay with it).
 *
 * Deleting puts the job in the bin (Settings → Audit log → Deleted jobs),
 * from where it can be restored. A database before 146 has no check: the
 * plain confirmation, as before.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { deleteVerdict, codeMatches, type DeleteCheck } from '../../lib/jobDelete'
import { t } from '@/lib/i18n'

export function JobDeleteDialog({ jobId, jobCode, onConfirm, onClose }: {
  jobId: string
  jobCode?: string | null
  onConfirm: (opts: { reason: string | null; confirm: string | null }) => Promise<void>
  onClose: () => void
}) {
  const check = useQuery<DeleteCheck | null>({
    queryKey: ['job-delete-check', jobId],
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('job_delete_check', { p_job: jobId })
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') return null  // a database before 146
        throw error
      }
      return data as DeleteCheck
    },
  })
  const [reason, setReason] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = check.data ?? null
  const verdict = deleteVerdict(c)
  const expected = c?.job_code ?? jobCode ?? ''
  const ready = verdict === 'plain' || (verdict === 'order' && !!reason.trim() && codeMatches(code, expected))

  async function go() {
    setBusy(true); setError(null)
    try {
      await onConfirm({ reason: verdict === 'order' ? reason.trim() : null, confirm: verdict === 'order' ? code.trim() : null })
      onClose()
    } catch (e) { setError(describeError(e)) } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="job-delete-h" className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-md space-y-4 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <h2 id="job-delete-h" className="flex-1 text-lg font-bold text-ink">{t('jobDelete.title', { code: expected || '—' })}</h2>
          <button type="button" onClick={onClose} aria-label={t('orders.close')} className="h-9 w-9 rounded-lg text-ink-muted hover:bg-bg-sidebar"><X size={18} className="mx-auto" /></button>
        </div>

        {check.isLoading && <p className="text-sm text-ink-muted">{t('jobDelete.checking')}</p>}
        {check.isError && <p className="text-sm text-rose-600" role="alert">{describeError(check.error)}</p>}

        {c && (
          <ul className="space-y-1 rounded-xl bg-bg-sidebar/60 p-3 text-sm text-ink">
            <li className="font-semibold">{t('jobDelete.tiedTo')}</li>
            {c.order && <li>• {t('jobDelete.tiedOrder', { client: c.order.client ?? '—', ref: c.order.ref })}</li>}
            <li>• {t('jobDelete.tiedInvoices', { n: c.invoice_lines })}</li>
            <li>• {t('jobDelete.tiedPayments', { n: c.payments })}</li>
            <li>• {t('jobDelete.tiedPayLines', { n: c.pay_lines })}</li>
            <li>• {t('jobDelete.tiedFiles', { n: c.files })}</li>
          </ul>
        )}

        {verdict === 'blocked_money' && <p className="flex gap-2 text-sm text-rose-700"><AlertTriangle size={18} className="shrink-0" aria-hidden="true" /> {t('jobDelete.blockedMoney')}</p>}
        {verdict === 'blocked_pay' && <p className="flex gap-2 text-sm text-rose-700"><AlertTriangle size={18} className="shrink-0" aria-hidden="true" /> {t('jobDelete.blockedPay')}</p>}

        {verdict === 'order' && c?.order && (
          <div className="space-y-3 rounded-xl border-2 border-amber-300 bg-amber-500/10 p-3">
            <p className="flex gap-2 text-sm font-semibold text-amber-900"><AlertTriangle size={18} className="shrink-0" aria-hidden="true" /> {t('jobDelete.orderWarning', { client: c.order.client ?? '—' })}</p>
            <label className="block"><span className="label">{t('jobDelete.reasonForClient')}</span>
              <textarea className="input min-h-16 text-base" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <label className="block"><span className="label">{t('jobDelete.typeCode', { code: expected })}</span>
              <input className="input h-11 font-mono text-base" value={code} onChange={e => setCode(e.target.value)} autoComplete="off" spellCheck={false} /></label>
          </div>
        )}

        {verdict === 'plain' && <p className="text-sm text-ink-muted">{t('jobDelete.plainText')}</p>}
        {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost h-11 px-4 text-sm">{t('confirm.cancel')}</button>
          {(verdict === 'plain' || verdict === 'order') && (
            <button type="button" disabled={busy || !ready || check.isLoading} onClick={() => void go()} className="btn-primary h-11 bg-rose-600 px-5 text-sm hover:bg-rose-700">
              <Trash2 size={16} aria-hidden="true" /> {t('jobDelete.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
