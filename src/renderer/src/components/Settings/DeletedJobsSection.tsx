/**
 * Deleted jobs, and the way back (sql/089: a delete keeps the job). Needs
 * jobs.delete, like deleting does (sql/102). The last 30 days first, older
 * ones behind "Show older" (sql/146); restoring a job from a Network order
 * takes the order back to where it was. The owner may delete a job here for
 * good, its code typed (not one with files: they are never deleted for good).
 */
import { format } from 'date-fns'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Undo2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { usePermissions } from '../../hooks/usePermissions'
import { describeError } from '../Patients/errors'
import { inBinWindow, codeMatches } from '../../lib/jobDelete'
import { t, dateLocale } from '@/lib/i18n'
import { useState } from 'react'

interface DeletedJob {
  id: string; job_code: string | null; patient: string | null; work_type: string | null; deleted_at: string; deleted_by_name: string | null
  /** sql/146: the client whose Network order the job came from; whether it has files (then it is never purged). */
  order_client?: string | null; has_files?: boolean
}

export function DeletedJobsSection() {
  const allowed = usePermissions().can('jobs.delete')
  return allowed ? <DeletedJobsList /> : null
}

function DeletedJobsList() {
  const qc = useQueryClient()
  const { isOwner } = usePermissions()
  const [error, setError] = useState<string | null>(null)
  const [older, setOlder] = useState(false)
  const [purging, setPurging] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const { data = [] } = useQuery<DeletedJob[]>({
    queryKey: ['deleted_jobs'],
    queryFn: async () => {
      const { data: rows, error: err } = await supabase.rpc('deleted_jobs')
      if (err) return [] // sql/089 not applied yet
      return (rows ?? []) as DeletedJob[]
    },
  })

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['deleted_jobs'] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: ['network_portal'] })
  }
  async function restore(id: string) {
    setError(null)
    const { error: err } = await supabase.rpc('restore_job', { p_job: id })
    if (err) { setError(describeError(err)); return }
    refresh()
  }
  async function purge(id: string) {
    setError(null)
    const { error: err } = await supabase.rpc('purge_job', { p_job: id, p_confirm: code.trim() })
    if (err) { setError(describeError(err)); return }
    setPurging(null); setCode('')
    refresh()
  }
  const recent = data.filter(j => inBinWindow(j.deleted_at))
  const old = data.filter(j => !inBinWindow(j.deleted_at))
  const shown = older ? data : recent

  return (
    <section className="space-y-2 mt-8">
      <h3 className="text-sm font-semibold text-ink">{t('deletedJobs.deletedJobs')}</h3>
      <p className="text-xs text-ink-muted max-w-2xl">{t('deletedJobs.intro')}</p>
      {shown.length === 0
        ? <p className="text-sm text-ink-muted">{t('deletedJobs.none')}</p>
        : (
          <ul className="space-y-1">
            {shown.map(j => (
              <li key={j.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-mono text-xs">{j.job_code ?? '—'}</span>
                  <span className="text-ink">{j.patient ?? '—'}</span>
                  <span className="text-ink-muted">{j.work_type ?? ''}</span>
                  {j.order_client && <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-800">{t('deletedJobs.fromOrder', { client: j.order_client })}</span>}
                  <span className="text-xs text-ink-muted">
                    {t('deletedJobs.deletedBy', { who: j.deleted_by_name ?? '—', when: format(new Date(j.deleted_at), 'd MMM yyyy HH:mm', { locale: dateLocale }) })}
                  </span>
                  <button type="button" onClick={() => void restore(j.id)} className="ml-auto flex items-center gap-1 text-xs text-accent hover:underline">
                    <Undo2 size={12} aria-hidden="true" /> {t('deletedJobs.restore')}
                  </button>
                  {isOwner && !j.has_files && (
                    <button type="button" onClick={() => { setPurging(j.id); setCode('') }} className="flex items-center gap-1 text-xs text-rose-600 hover:underline">
                      <Trash2 size={12} aria-hidden="true" /> {t('deletedJobs.purge')}
                    </button>
                  )}
                </div>
                {purging === j.id && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-300 bg-rose-500/5 p-2 text-xs">
                    <span className="text-rose-700">{t('deletedJobs.purgeAsk', { code: j.job_code ?? '' })}</span>
                    <input className="input h-8 w-36 font-mono text-xs" value={code} onChange={e => setCode(e.target.value)} aria-label={t('deletedJobs.purgeAsk', { code: j.job_code ?? '' })} autoComplete="off" />
                    <button type="button" disabled={!codeMatches(code, j.job_code)} onClick={() => void purge(j.id)} className="rounded bg-rose-600 px-2 py-1 text-white disabled:opacity-50">{t('deletedJobs.purgeConfirm')}</button>
                    <button type="button" onClick={() => setPurging(null)} className="px-2 py-1 text-ink-muted">{t('confirm.cancel')}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {old.length > 0 && (
        <button type="button" onClick={() => setOlder(o => !o)} className="text-xs text-accent hover:underline">
          {older ? t('deletedJobs.showRecent') : t('deletedJobs.showOlder', { n: old.length })}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-rose-500">{error}</p>}
    </section>
  )
}
