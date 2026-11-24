/**
 * Deleting a job on the phone (Riga's trial, 2026-11-24), with the desktop's
 * rule and the desktop's confirmation (JobDetailPanel): only with Delete jobs
 * (`jobs.delete`, which the database checks again), and only after "Delete?
 * Yes". Deleting hides the job; Settings → Deleted jobs restores it.
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDeleteJob } from '../hooks/useJobs'
import { usePermissions } from '../hooks/usePermissions'
import { describeError } from '../components/Patients/errors'
import { t } from '@/lib/i18n'

export function MobileDeleteJob({ jobId, onDeleted }: { jobId: string; onDeleted: () => void }) {
  const { can } = usePermissions()
  const remove = useDeleteJob()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!can('jobs.delete')) return null

  async function confirmDelete() {
    setError(null)
    try {
      await remove.mutateAsync(jobId)
      onDeleted()
    } catch (e) {
      setError(describeError(e))
      setAsking(false)
    }
  }

  return (
    <section className="space-y-2">
      {asking ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3">
          <span className="text-sm font-medium text-red-600">{t('jobDetail.delete')}</span>
          <button type="button" onClick={() => void confirmDelete()} disabled={remove.isPending}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm text-white disabled:opacity-50">
            {t('jobDetail.yes')}
          </button>
          <button type="button" onClick={() => setAsking(false)} className="rounded-lg px-4 py-2 text-sm text-ink-muted">
            {t('jobDetail.no')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAsking(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-3 text-sm text-red-500">
          <Trash2 size={16} aria-hidden="true" /> {t('mobile.deleteJob')}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}
