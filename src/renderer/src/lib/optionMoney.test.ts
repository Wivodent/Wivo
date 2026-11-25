/**
 * A work type option's extra price and cost reach every place the work type's
 * own price does: the job's price (quoteJob, tested in workOptions.test), the
 * repricer, the invoice line, the job's cost table and its margin, and the
 * finance view (finance.test).
 */
import './_domStub'
import { describe, it, expect } from 'vitest'
import { planReprice } from './repriceJobs'
import { jobCosts, type JobCostsInput } from './jobCosts'
import type { WorkerRate } from './earnings'
import type { Job } from '../types/job'
import type { WivoSettings } from '../stores/useSettings'
import type { WorkType } from '@shared/pricing/workTypes'
import { workWithOptionsLabel, type WorkOption } from '@shared/pricing/workOptions'

const LIBRARY: WorkOption[] = [
  { id: 'metal-bar', nimi: 'Metal bar', lisahind: 400, kulu: 120, yhik: 'too' },
  { id: 'pink-gingiva', nimi: 'Pink gingiva', lisahind: 15, kulu: 4, yhik: 'hammas' },
]
const TYPES: WorkType[] = [
  { nimi: 'All-on-4', hex: '#000', hind: 3000, hinnaTyyp: 'too', valikuGrupid: [
    { key: 'framework', nimi: 'Framework', mitu: false, valikud: ['metal-bar'] },
    { key: 'extras', nimi: 'Extras', mitu: true, valikud: ['pink-gingiva'] },
  ] },
  { nimi: 'Kroon', hex: '#111', hind: 200, hinnaTyyp: 'hammas' },
]
const SETTINGS = {
  tooTuubid: TYPES, tooValikud: LIBRARY, materialPrices: {}, hambaHind: 0,
  kiirtooKordaja: 1.5, designFee: 0, mudeliHind: 0, muudatusHambaHind: 0,
} as unknown as WivoSettings

const ITEM = { id: 'a', too: 'All-on-4', hambad: '13,12,11,21,22,23', valikud: { framework: ['metal-bar'], extras: ['pink-gingiva'] } }
const job = (hind: number): Job => ({
  id: 'j1', too: 'All-on-4', hambad: ITEM.hambad, materjal: '', hind, work_items: [ITEM],
} as unknown as Job)

describe('reprice', () => {
  const opts = { includeBilled: false, billedJobIds: new Set<string>(), revisionMode: 'skip' as const }

  it('keeps the options: 3000 + 400 + 6 × 15 is the price, and it is the type\'s', () => {
    const plan = planReprice([job(3000)], SETTINGS, opts)
    expect(plan.changes.map(c => [c.oldPrice, c.newPrice, c.source])).toEqual([[3000, 3490, 'tüüp']])
  })

  it('a job already priced with its options is left alone', () => {
    expect(planReprice([job(3490)], SETTINGS, opts)).toMatchObject({ changes: [], unchanged: 1 })
  })
})

describe('the job\'s cost table and margin', () => {
  const input = (options?: WorkOption[]): JobCostsInput => ({
    job: {
      work_items: [ITEM], too: 'All-on-4', hambad: ITEM.hambad, materjal: '', masina: '',
      kiirtoo: false, mudel: false, assigned_to: null, designed_by: null, extra_costs: [],
      kulu_yle: {}, hind: 3490, disain_hind: null,
    },
    rates: [], workTypes: TYPES, materialCosts: {}, materialPrices: {}, workers: [], on: '2026-11-25',
    options,
  } as unknown as JobCostsInput)

  it('each chosen option\'s cost is a consumables line, per job or per tooth', () => {
    const r = jobCosts(input(LIBRARY))
    const cons = r.categories.find(c => c.key === 'tarvikud')!
    expect(cons.lines).toEqual([
      { label: 'All-on-4 · Metal bar', amount: 120 },
      { label: 'All-on-4 · Pink gingiva', amount: 24 },
    ])
    expect(r.total).toBe(144)
    expect(r.revenue).toBe(3490)
    expect(r.margin).toBe(3346)
  })

  it('without the library, nothing is added (as before options)', () => {
    expect(jobCosts(input()).total).toBe(0)
  })

  it('the technician\'s cost follows a pay rule that names an option (sql/129)', () => {
    const rule = (over: Partial<WorkerRate>): WorkerRate => ({
      id: crypto.randomUUID(), clinic_id: 'c', profile_id: 'tech', kind: 'too', applies_to: 'too', amount: 0,
      work_type: 'All-on-4', priority: 0, additive: false, label: null, pay_revisions: false, auto_hours: false,
      hours_per_day: null, work_days: '12345', active_from: null, active_to: null, note: null,
      created_at: '', updated_at: '', ...over,
    })
    const base = input(LIBRARY)
    const withTech = (rates: WorkerRate[], valikud: typeof ITEM.valikud | undefined) => jobCosts({
      ...base,
      job: { ...base.job, assigned_to: 'tech', work_items: [{ ...ITEM, valikud }] },
      rates,
      workers: [{ id: 'tech' }],
    })
    const rates = [
      rule({ amount: 200 }),
      rule({ amount: 50, additive: true, label: 'Metal bar', option_key: 'metal-bar' }),
    ]
    expect(withTech(rates, ITEM.valikud).categories.find(c => c.key === 'tehnik')!.computed).toBe(250)
    expect(withTech(rates, undefined).categories.find(c => c.key === 'tehnik')!.computed).toBe(200)
  })
})

describe('the invoice line', () => {
  it('names each type once, with the options chosen for it', () => {
    expect(workWithOptionsLabel([ITEM, { too: 'Kroon', valikud: null }], LIBRARY))
      .toBe('All-on-4 (Metal bar, Pink gingiva) + Kroon')
    expect(workWithOptionsLabel([{ too: 'Kroon' }, { too: 'Kroon' }], LIBRARY)).toBe('Kroon')
    expect(workWithOptionsLabel([ITEM], [])).toBe('All-on-4')
  })
})
