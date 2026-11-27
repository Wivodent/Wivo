/**
 * Feedback (sql/144) is behind the licence module `ratings` everywhere it
 * shows, the owner's Wivo tells the database, and the Network form's pieces
 * carry no clinic database code (the network-only build uses them).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')

describe('the ratings module gates every piece', () => {
  it('the job card, my feedback, the owner statistics, the client ratings', () => {
    const fb = read('Feedback.tsx')
    expect(fb).toMatch(/const on = moduleOn\('ratings'\) && done && \(mayFit \|\| rateWork \|\| rateInput \|\| rateClient\)/)
    expect(fb).toMatch(/if \(!moduleOn\('ratings'\) \|\| !summary\) return null/)
    expect(fb).toMatch(/const on = moduleOn\('ratings'\) && isOwner/)
    const orders = read('../Network/OrdersView.tsx')
    expect(orders).toMatch(/enabled: moduleOn\('ratings'\) && isOwner/)
    // The clinic's rating of a client (sql/146: one component, on the order and the job page).
    expect(fb).toMatch(/if \(!on \|\| !mine\.isFetched\) return null/)
    expect(fb).toMatch(/const on = moduleOn\('ratings'\)\r?\n/)
  })
  it('the owner’s Wivo writes the licence’s answer for the database, only once the licence is read', () => {
    const sync = read('../RatingsLicenceSync.tsx')
    expect(sync).toContain("if (loading || !isOwner) return")
    expect(sync).toContain("setFlag('hinnangud', on)")
    expect(read('../../lib/clinicSettings.ts')).toContain('ratings: s.hinnangud')
  })
  it('the Network form’s stars and reason fields carry no clinic database code', () => {
    const fields = read('FeedbackFields.tsx')
    expect(fields).not.toMatch(/lib\/supabase|from '\.\.\/\.\.\/lib\/supabase'/)
    expect(read('../../mobile/network/NetworkApp.tsx')).toContain("import { Stars, AdjustFields } from '../../components/Feedback/FeedbackFields'")
  })
  it('the delivery pieces the Network form uses carry no clinic database code either (sql/145)', () => {
    expect(read('../Delivery/DeliveryFields.tsx')).not.toMatch(/lib\/supabase/)
    expect(read('../../lib/delivery.ts')).not.toMatch(/lib\/supabase/)
    const app = read('../../mobile/network/NetworkApp.tsx')
    expect(app).toContain("import { ProblemFields } from '../../components/Delivery/DeliveryFields'")
    expect(app).not.toMatch(/Delivery\/JobDelivery|Feedback\/Feedback'/)
  })
  it('Received and the delivery problem work without the ratings module; feedback opens only after Received (sql/145)', () => {
    const delivery = read('../Delivery/JobDelivery.tsx')
    expect(delivery).not.toMatch(/moduleOn/)
    expect(read('Feedback.tsx')).toMatch(/const done = isReceived\(job\)/)
  })
})
