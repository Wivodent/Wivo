/**
 * Deleting a job on the phone: the desktop's rule (Delete jobs) and the
 * desktop's dialog (JobDeleteDialog, sql/146), only after the button.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { t } from '@/lib/i18n'

let perms: string[] = []
vi.mock('../hooks/usePermissions', () => ({ usePermissions: () => ({ can: (p: string) => perms.includes(p) }) }))
vi.mock('../hooks/useJobs', () => ({ useDeleteJob: () => ({ mutateAsync: async () => {}, isPending: false }) }))
vi.mock('../components/JobDelete/JobDeleteDialog', () => ({ JobDeleteDialog: () => 'DIALOG' }))
const { MobileDeleteJob } = await import('./MobileDeleteJob')

describe('deleting a job on the phone', () => {
  beforeEach(() => { perms = [] })

  it('without Delete jobs: nothing to press', () => {
    perms = ['jobs.write', 'jobs.read']
    expect(renderToStaticMarkup(<MobileDeleteJob jobId="j" onDeleted={() => {}} />)).toBe('')
  })

  it('with Delete jobs: the button, and not yet the dialog', () => {
    perms = ['jobs.delete']
    const html = renderToStaticMarkup(<MobileDeleteJob jobId="j" onDeleted={() => {}} />)
    expect(html).toContain(t('mobile.deleteJob'))
    expect(html).not.toContain('DIALOG')
  })

  it('the job screen shows it, and leaves the job once it is deleted', () => {
    const src = readFileSync('src/renderer/src/mobile/MobileJob.tsx', 'utf8')
    expect(src).toContain('<MobileDeleteJob jobId={job.id} jobCode={job.job_code} onDeleted={onClose} />')
  })
})
