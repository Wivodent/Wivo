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
    expect(lines[2].description).toBe('TF-1 · Kroon · hambad 11, 21')
    expect(lines.reduce((s, l) => s + l.unit_price, 0)).toBe(2610)
  })

  it('a Latvian invoice’s lines in Latvian (sql/148); Estonian as before when not told', () => {
    const j = job({ hind: 2500, work_items: [{ id: 'w1', too: 'All-on-4', hambad: '', valikud: { bar: ['metal-bar'] } }, { id: 'w2', too: 'Kroon', hambad: '11,21' }] as Job['work_items'] })
    expect(jobLines(j, book, options, null, invoiceLabels('lv').line)[2].description).toBe('Kroon · zobi 11, 21')
    expect(jobLines(j, book, options, null)[2].description).toBe('Kroon · hambad 11, 21')
  })

  it('many teeth as ranges, as on the Orders page: 17–27, not every number', () => {
    const upper = '17,16,15,14,13,12,11,21,22,23,24,25,26,27'
    const j = job({ hind: 1400, work_items: [{ id: 'w', too: 'Kroon', hambad: upper }] as Job['work_items'] })
    expect(jobLines(j, book, options, null)[0].description).toBe('Kroon · hambad 17–27')
    expect(jobLines(job({ hind: 999, hambad: `${upper},36,35,34` }), book, options, null)[0].description).toBe('All-on-4 (Metal bar) · hambad 17–27, 34–36')
  })

  it('a Latvian or English invoice’s lines carry no Estonian: teeth, rush, model, design in its own words', () => {
    const j = job({ hind: 2150, disain_hind: 40, kiirtoo: true, mudel: true,
      work_items: [{ id: 'w', too: 'Kroon', hambad: '17,16,15,14,13,12,11,21,22,23,24,25,26,27' }] as Job['work_items'] })
    const priced = { ...book, mudeliHind: 50 }
    const lv = jobLines(j, priced, options, 'TF-1', invoiceLabels('lv').line).map(l => l.description)
    expect(lv).toEqual(['TF-1 · Kroon · zobi 17–27', 'TF-1 · Steidzams darbs ×1.5', 'TF-1 · Modelis', 'TF-1 · Dizains'])
    const en = jobLines(j, priced, options, null, invoiceLabels('en').line).map(l => l.description)
    expect(en).toEqual(['Kroon · teeth 17–27', 'Rush ×1.5', 'Model', 'Design'])
    for (const d of [...lv, ...en]) expect(d).not.toMatch(/hambad|Kiirtöö|Mudel\b|Disain\b/)
    // Estonian, as always.
    expect(jobLines(j, priced, options, null).map(l => l.description)).toEqual(['Kroon · hambad 17–27', 'Kiirtöö ×1.5', 'Mudel', 'Disain'])
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
