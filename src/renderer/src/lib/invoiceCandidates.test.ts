import { describe, expect, it } from 'vitest'
import type { Job } from '../types/job'
import type { PriceBook } from '@shared/pricing/priceBook'
import type { WorkOption } from '@shared/pricing/workOptions'
import { billedKeys, unbilledCandidates, jobLines, candidateMonths, monthOf } from './invoiceCandidates'
import { invoiceLabels } from '@shared/billing/invoiceDoc'

const options: WorkOption[] = [{ id: 'metal-bar', nimi: 'Metal bar', lisahind: 300 }]
const book: PriceBook = {
  workTypes: [{ nimi: 'All-on-4', hex: '#000', hind: 2000, hinnaTyyp: 'too' }, { nimi: 'Kroon', hex: '#111', hind: 100, hinnaTyyp: 'hammas' }] as PriceBook['workTypes'],
  materialPrices: {}, hambaHind: 0, kiirtooKordaja: 1.5, designFee: 0, mudeliHind: 0, options,
}
const job = (over: Partial<Job>): Job => ({
  id: 'j1', too: 'All-on-4', hambad: '', hind: 2300, disain_hind: null, extras: [], revisions: [],
  work_items: [{ id: 'w1', too: 'All-on-4', hambad: '', valikud: { bar: ['metal-bar'] } }],
  customer_id: 'c1', customer_ref: 'TF-FO-261127-001', patsient: 'TF-FO-261127-001', patient_id: null,
  kuupaev: '2026-11-03', valmis_kuupaev: '2026-11-20', kiirtoo: false, mudel: false, materjal: null,
  ...over,
} as unknown as Job)
const toClient = { billTo: 'customer' as const, customerId: 'c1', patientId: null, patientName: '' }

describe('unbilled work on an invoice', () => {
  it('a client’s jobs (a Network order’s job too): each work item and each option its own line, the order’s reference first', () => {
    const [c] = unbilledCandidates([job({})], toClient, new Set(), book, options)
    expect(c.lines).toEqual([
      { description: 'TF-FO-261127-001 · All-on-4', unit_price: 2000 },
      { description: 'TF-FO-261127-001 · All-on-4 · Metal bar', unit_price: 300 },
    ])
    expect(c.total).toBe(2300)
  })

  it('several work items, with their teeth; the design fee and extras apart', () => {
    const j = job({
      hind: 2500, disain_hind: 50, extras: [{ id: 'e', nimi: 'Ülesehitus', hind: 60 }] as Job['extras'],
      work_items: [
        { id: 'w1', too: 'All-on-4', hambad: '', valikud: { bar: ['metal-bar'] } },
        { id: 'w2', too: 'Kroon', hambad: '11,21' },
      ] as Job['work_items'],
    })
    const lines = jobLines(j, book, options, 'TF-1')
    expect(lines.map(l => l.unit_price)).toEqual([2000, 300, 200, 50, 60])
    expect(lines[2].description).toBe('TF-1 · Kroon · hambad 11,21')
    expect(lines.reduce((s, l) => s + l.unit_price, 0)).toBe(2610)
  })

  it('a Latvian invoice’s lines in Latvian (sql/148); Estonian as before when not told', () => {
    const j = job({ hind: 2500, work_items: [{ id: 'w1', too: 'All-on-4', hambad: '', valikud: { bar: ['metal-bar'] } }, { id: 'w2', too: 'Kroon', hambad: '11,21' }] as Job['work_items'] })
    expect(jobLines(j, book, options, null, invoiceLabels('lv').line)[2].description).toBe('Kroon · zobi 11,21')
    expect(jobLines(j, book, options, null)[2].description).toBe('Kroon · hambad 11,21')
  })

  it('a price set by hand: one line at the job’s own price, never something else', () => {
    const lines = jobLines(job({ hind: 2100 }), book, options, 'TF-1')
    expect(lines).toEqual([{ description: 'TF-1 · All-on-4 (Metal bar)', unit_price: 2100 }])
  })

  it('billed work is not offered; a remake with a price is its own line; another client’s jobs are not here', () => {
    const j = job({ revisions: [{ id: 'r1', price: 80, reasons: ['Halb passivus'] }] as unknown as Job['revisions'] })
    const billed = billedKeys([{ status: 'saadetud', lines: [{ job_id: 'j1', revision_id: null }] }, { status: 'tuhistatud', lines: [{ job_id: 'j1', revision_id: 'r1' }] }])
    const cands = unbilledCandidates([j, job({ id: 'j2', customer_id: 'c2' })], toClient, billed, book, options)
    expect(cands.map(c => c.key)).toEqual(['j1:r1'])
    expect(cands[0].lines[0].unit_price).toBe(80)
  })

  it('nothing until the client is chosen; a patient’s jobs by patient', () => {
    expect(unbilledCandidates([job({})], { ...toClient, customerId: null }, new Set(), book, options)).toEqual([])
    const p = unbilledCandidates([job({ customer_id: null, patient_id: 'p1', patsient: 'Mari' })],
      { billTo: 'patient', customerId: null, patientId: 'p1', patientName: 'Mari' }, new Set(), book, options)
    expect(p).toHaveLength(1)
    expect(p[0].ref).toBeNull()
  })

  it('a month’s invoice: the months the work falls in', () => {
    const cands = unbilledCandidates([job({}), job({ id: 'j3', valmis_kuupaev: '2026-10-30' })], toClient, new Set(), book, options)
    expect(candidateMonths(cands)).toEqual(['2026-11', '2026-10'])
    expect(monthOf(null)).toBeNull()
  })
})
