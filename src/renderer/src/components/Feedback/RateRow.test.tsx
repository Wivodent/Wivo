/**
 * The bug from testing (sql/144): a rating was saved, but after reopening the
 * job the form was empty. The form took its starting values before the saved
 * rating had loaded (and the clinic's rating of a client never loaded it at
 * all). Now the form is made only once it has loaded, keyed by when it was
 * last changed, so it shows what was saved.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { t } from '@/lib/i18n'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const { RateRow } = await import('./Feedback')

const read = (p: string) => readFileSync(p, 'utf8')

describe('a saved rating shows when the form opens again', () => {
  it('the stars and the comment it was saved with', () => {
    const html = renderToStaticMarkup(
      <RateRow label="Rate" current={{ score: 4, comment: 'Clear scan', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' }} onSave={async () => {}} />)
    expect(html).toContain('value="Clear scan"')
    expect(html).toContain(`aria-checked="true" aria-label="${t('feedback.nOfFive', { n: 4 })}"`)
    expect(html).toContain(t('feedback.canChange'))
  })

  it('a changed rating says when it was changed', () => {
    const html = renderToStaticMarkup(
      <RateRow label="Rate" current={{ score: 2, comment: null, created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-25T10:00:00Z' }} onSave={async () => {}} />)
    expect(html).toContain(t('feedback.changedOn', { date: '' }).split(' ')[0])
  })

  it('every form waits for what was saved, and is made again when it changes', () => {
    const fb = read('src/renderer/src/components/Feedback/Feedback.tsx')
    expect(fb).toMatch(/rateWork && data\.isFetched && <RateRow key=\{`work:/)
    expect(fb).toMatch(/rateInput && data\.isFetched && \(/)
    expect(fb).toMatch(/if \(!on \|\| !mine\.isFetched\) return null/)
    expect(fb).toMatch(/<RateRow key=\{mine\.data\?\.updated_at \?\? 'none'\}/)
    const app = read('src/renderer/src/mobile/network/NetworkApp.tsx')
    expect(app).toContain("<ClinicRating key={data.rating?.updated_at ?? 'none'}")
    // The clinic's rating of a client is on the order and on the job page, from one component.
    expect(read('src/renderer/src/components/Network/OrdersView.tsx')).toContain("import { RateClientRow } from '../Feedback/Feedback'")
    expect(fb).toContain('<RateClientRow orderId={order.data} jobId={job.id} />')
  })
})
