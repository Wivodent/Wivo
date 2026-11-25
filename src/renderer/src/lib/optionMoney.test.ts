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
import { calculateEarnings, earningsTotal, type WorkerRate } from './earnings'
import type { Job } from '../types/job'
import { priceBookOf, type WivoSettings } from '../stores/useSettings'
import { quoteJob } from '@shared/pricing/quote'
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

// ── A work type's own price for an option ───────────────────────────────────
describe("an option's price per work type (work_types[].valikuHinnad)", () => {
  const FRAME = [{ key: 'framework', nimi: 'Framework', mitu: false, valikud: ['metal-bar'] }]
  const OWN_TYPES: WorkType[] = [
    { nimi: 'All-on-4', hex: '#000', hind: 3000, hinnaTyyp: 'too', valikuGrupid: FRAME,
      valikuHinnad: { 'metal-bar': { lisahind: 400, kulu: 150 } } },
    { nimi: 'All-on-6', hex: '#111', hind: 3500, hinnaTyyp: 'too', valikuGrupid: FRAME,
      valikuHinnad: { 'metal-bar': { lisahind: 600 } } },
    { nimi: 'Hybrid', hex: '#222', hind: 2500, hinnaTyyp: 'too', valikuGrupid: FRAME },
  ]
  // The library's default: 350 € extra, 120 € cost.
  const DEFAULTS: WorkOption[] = [{ id: 'metal-bar', nimi: 'Metal bar', lisahind: 350, kulu: 120, yhik: 'too' }]
  const settings = { ...SETTINGS, tooTuubid: OWN_TYPES, tooValikud: DEFAULTS } as unknown as WivoSettings
  const bar = (too: string) => ({ id: too, too, hambad: '13,12,11,21,22,23', valikud: { framework: ['metal-bar'] } })
  const jobOf = (too: string, hind: number): Job => ({ id: too, too, hambad: '13,12,11,21,22,23', materjal: '', hind, work_items: [bar(too)] } as unknown as Job)
  const quote = (too: string) => quoteJob({ items: [bar(too)] }, priceBookOf(settings))

  it('All-on-4 + Metal bar 400, All-on-6 + Metal bar 600, no own price: the default 350', () => {
    expect(quote('All-on-4').lines.find(l => l.source === 'valik')?.amount).toBe(400)
    expect(quote('All-on-6').lines.find(l => l.source === 'valik')?.amount).toBe(600)
    expect(quote('Hybrid').lines.find(l => l.source === 'valik')?.amount).toBe(350)
    expect([quote('All-on-4'), quote('All-on-6'), quote('Hybrid')].map(q => q.production)).toEqual([3400, 4100, 2850])
  })

  it('each amount falls back on its own: All-on-6 has its own price, the default cost', () => {
    const cost = (too: string) => jobCosts({
      job: { work_items: [bar(too)], too, hambad: bar(too).hambad, materjal: '', masina: '', kiirtoo: false, mudel: false,
        assigned_to: null, designed_by: null, extra_costs: [], kulu_yle: {}, hind: 0, disain_hind: null },
      rates: [], workTypes: OWN_TYPES, materialCosts: {}, materialPrices: {}, workers: [], on: '2026-11-25', options: DEFAULTS,
    } as unknown as JobCostsInput).total
    expect([cost('All-on-4'), cost('All-on-6'), cost('Hybrid')]).toEqual([150, 120, 120])
  })

  it('in the type\'s unit: a per-tooth type\'s own price is per tooth, the default keeps the option\'s unit', () => {
    const perTooth: WorkType[] = [{ nimi: 'Kroon', hex: '#3', hinnaTyyp: 'hammas', hind: 200, valikuGrupid: FRAME,
      valikuHinnad: { 'metal-bar': { lisahind: 20 } } }]
    const q = quoteJob({ items: [{ too: 'Kroon', hambad: '11,12,13', valikud: { framework: ['metal-bar'] } }] },
      priceBookOf({ ...settings, tooTuubid: perTooth } as WivoSettings))
    expect(q.lines.find(l => l.source === 'valik')?.amount).toBe(60)
    const c = jobCosts({
      job: { work_items: [{ id: 'k', too: 'Kroon', hambad: '11,12,13', valikud: { framework: ['metal-bar'] } }], too: 'Kroon',
        hambad: '11,12,13', materjal: '', masina: '', kiirtoo: false, mudel: false, assigned_to: null, designed_by: null,
        extra_costs: [], kulu_yle: {}, hind: 0, disain_hind: null },
      rates: [], workTypes: perTooth, materialCosts: {}, materialPrices: {}, workers: [], on: '2026-11-25', options: DEFAULTS,
    } as unknown as JobCostsInput)
    expect(c.total).toBe(120) // the default cost, per job as the option says
  })

  it('reprice uses them: each job gets its own type\'s price', () => {
    const opts = { includeBilled: false, billedJobIds: new Set<string>(), revisionMode: 'skip' as const }
    const plan = planReprice([jobOf('All-on-4', 3000), jobOf('All-on-6', 3500), jobOf('Hybrid', 2850)], settings, opts)
    expect(plan.changes.map(c => [c.job.too, c.newPrice])).toEqual([['All-on-4', 3400], ['All-on-6', 4100]])
    expect(plan.unchanged).toBe(1)
  })

  it('a percentage pay rule is paid off the job\'s price, which holds the type\'s own option price', () => {
    const lines = calculateEarnings({
      profileId: 'tech',
      rates: [{ id: 'r', clinic_id: 'c', profile_id: 'tech', kind: 'protsent', applies_to: 'too', amount: 10, work_type: null,
        priority: 0, additive: false, label: null, pay_revisions: false, auto_hours: false, hours_per_day: null,
        work_days: '12345', active_from: null, active_to: null, note: null, created_at: '', updated_at: '' }],
      jobs: [{ ...jobOf('All-on-6', quote('All-on-6').production), status: 'valmis', assigned_to: 'tech',
        kuupaev: '2026-11-02', valmis_kuupaev: '2026-11-10', revisions: [] } as unknown as Job],
      hours: [], types: OWN_TYPES, periodStart: '2026-11-01', periodEnd: '2026-11-30', doneStageKey: 'valmis',
    })
    expect(earningsTotal(lines)).toBe(410)
  })
})

describe("the job's cost table: an option's doer (sql/130)", () => {
  const rule = (over: Partial<WorkerRate>): WorkerRate => ({
    id: crypto.randomUUID(), clinic_id: 'c', profile_id: 'tech-a', kind: 'too', applies_to: 'too', amount: 0,
    work_type: null, priority: 0, additive: false, label: null, pay_revisions: false, auto_hours: false,
    hours_per_day: null, work_days: '12345', active_from: null, active_to: null, note: null,
    created_at: '', updated_at: '', ...over,
  })
  const rates = [
    rule({ amount: 200, work_type: 'All-on-4' }),
    rule({ amount: 50, additive: true, label: 'Metal bar', option_key: 'metal-bar' }),
    rule({ amount: 50, additive: true, label: 'Metal bar', option_key: 'metal-bar', profile_id: 'tech-b' }),
  ]
  const costsWith = (valikuTegijad?: Record<string, string>) => jobCosts({
    job: {
      work_items: [{ ...ITEM, valikuTegijad }], too: 'All-on-4', hambad: ITEM.hambad, materjal: '', masina: '',
      kiirtoo: false, mudel: false, assigned_to: 'tech-a', designed_by: null, extra_costs: [], kulu_yle: {},
      hind: 3490, disain_hind: null,
    },
    rates, workTypes: TYPES, materialCosts: {}, materialPrices: {}, on: '2026-11-25',
    workers: [{ id: 'tech-a', full_name: 'Anna A' }, { id: 'tech-b', full_name: 'Bruno B' }],
  } as unknown as JobCostsInput).categories.find(c => c.key === 'tehnik')!

  it('B makes the metal bar: A 200, B 50, a line naming B', () => {
    const tech = costsWith({ 'metal-bar': 'tech-b' })
    expect(tech.computed).toBe(250)
    expect(tech.lines.map(l => l.amount)).toEqual([200, 50])
    expect(tech.lines[1].label).toContain('(Bruno)')
  })

  it('no doer: A makes both, as before', () => {
    const tech = costsWith()
    expect(tech.computed).toBe(250)
    expect(tech.lines.some(l => l.label.includes('Bruno'))).toBe(false)
  })
})
