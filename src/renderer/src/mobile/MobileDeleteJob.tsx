/**
 * Deleting a job on the phone, with the desktop's rule and the desktop's
 * confirmation (JobDeleteDialog, sql/146): only with Delete jobs (`jobs.delete`,
 * which the database checks again); what the job is tied to decides what is
 * asked. Deleting puts the job in the bin; Settings → Deleted jobs restores it.
 */
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useDeleteJob } from '../hooks/useJobs'
import { usePermissions } from '../hooks/usePermissions'
import { JobDeleteDialog } from '../components/JobDelete/JobDeleteDialog'
import { t } from '@/lib/i18n'

export function MobileDeleteJob({ jobId, jobCode, onDeleted }: { jobId: string; jobCode?: string | null; onDeleted: () => void }) {
  const { can } = usePermissions()
  const remove = useDeleteJob()
  const [asking, setAsking] = useState(false)
  if (!can('jobs.delete')) return null

  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setAsking(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 py-3 text-sm text-red-500">
        <Trash2 size={16} aria-hidden="true" /> {t('mobile.deleteJob')}
      </button>
      {asking && (
        <JobDeleteDialog jobId={jobId} jobCode={jobCode} onClose={() => setAsking(false)}
          onConfirm={async opts => { await remove.mutateAsync({ id: jobId, ...opts }); onDeleted() }} />
      )}
    </section>
  )
}
