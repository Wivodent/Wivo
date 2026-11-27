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
    expect(fb).toMatch(/const on = moduleOn\('ratings'\) && done && \(isDoctor \|\| isMaker\)/)
    expect(fb).toMatch(/if \(!moduleOn\('ratings'\) \|\| !summary\) return null/)
    expect(fb).toMatch(/const on = moduleOn\('ratings'\) && isOwner/)
    const orders = read('../Network/OrdersView.tsx')
    expect(orders).toMatch(/enabled: moduleOn\('ratings'\) && isOwner/)
    expect(orders).toMatch(/if \(!moduleOn\('ratings'\)\) return null/)
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
})
