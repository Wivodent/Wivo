/**
 * Implants through the WIZARD's path.
 *
 * The wizard keeps teeth as numbers per work type and derives `WorkItem`s on
 * read; the job form edits `WorkItem`s directly. Two data paths to the same
 * field, and only one of them was wired the first time — the chart in the
 * wizard had no way to mark anything at all. These pin the derivation.
 */
import { describe, it, expect } from 'vitest'
import { wizardWorkItems } from './workItems'
import { createEmptyNewJobState } from '@shared/wizard'
import { DEFAULT_WORK_TYPES } from '@shared/pricing/workTypes'
import type { NewJobState } from '@shared/wizard'

const T = DEFAULT_WORK_TYPES

const state = (over: Partial<NewJobState> = {}): NewJobState => ({
  ...createEmptyNewJobState(),
  jobTypes: ['Implantaadisild'],
  selectedTeeth: { Implantaadisild: [14, 15, 16, 17, 18] },
  ...over,
})

const item = (s: NewJobState) => wizardWorkItems(s, T)[0]

describe('wizardWorkItems — implants', () => {
  // Anatomical order, the same order `hambad` is in — sortTeeth puts 18 before
  // 14 in the upper right. Asserted against the item's own teeth rather than a
  // literal, so the two can never drift apart without this failing.
  it('carries the marked teeth onto the work item, in the same order as hambad', () => {
    const i = item(state({ implantsByType: { Implantaadisild: [14, 18] } }))
    const order = i.hambad.split(',')
    expect(i.implantaadid!.split(',')).toEqual(order.filter(t => t === '18' || t === '14'))
    expect(i.implantaadid).toBe('18,14')
  })

  // Absent, not empty: an empty string in the row would read as a deliberate
  // "no implants" and stop the cost falling back to counting teeth.
  it('leaves the field off when nothing is marked', () => {
    expect(item(state()).implantaadid).toBeUndefined()
    expect(item(state({ implantsByType: { Implantaadisild: [] } })).implantaadid).toBeUndefined()
  })

  // Unticking a tooth on step 2 must take its implant with it, or the job is
  // created with a screw charged against a unit that is not being made.
  it('drops an implant on a tooth that is no longer selected', () => {
    const i = item(state({
      selectedTeeth: { Implantaadisild: [14, 15] },
      implantsByType: { Implantaadisild: [14, 18] },
    }))
    expect(i.implantaadid).toBe('14')
  })

  // 2.2.0: every picked tooth has a "+ Implant", so a bridge the lab calls
  // just "Sild" can sit on implants too. Only work with no teeth cannot.
  it('carries marks on any tooth-level work, a plain bridge included', () => {
    const i = item(state({
      jobTypes: ['Sild'],
      selectedTeeth: { Sild: [14, 15, 16] },
      implantsByType: { Sild: [14, 16] },
    }))
    expect(i.too).toBe('Sild')
    expect(i.implantaadid).toBe('16,14')
  })

  it('ignores marks on work that owns no teeth (an appliance)', () => {
    const i = item(state({
      jobTypes: ['Retainer'],
      selectedTeeth: { Retainer: [14] },
      implantsByType: { Retainer: [14] },
    }))
    expect(i.implantaadid).toBeUndefined()
  })

  it('a jaw (All-on-X) keeps the implants marked on its own teeth', () => {
    const items = wizardWorkItems(state({
      jobTypes: ['All-on-X'],
      selectedTeeth: {},
      selectedArch: 'upper',
      implantsByType: { 'All-on-X': [12, 22, 15, 25, 36] },
    }), T)
    expect(items).toHaveLength(1)
    expect(items[0].implantaadid!.split(',').sort()).toEqual(['12', '15', '22', '25'])
  })

  it('still marks the item as a bridge', () => {
    expect(item(state({ implantsByType: { Implantaadisild: [14] } })).bridge).toBe(true)
  })
})

describe('wizardWorkItems — design split', () => {
  it('stores the subset the designer actually did', () => {
    const i = item(state({
      selectedTeeth: { Implantaadisild: [14, 15, 16] },
      designByType: { Implantaadisild: [16] },
    }))
    expect(i.disain_hambad).toBe('16')
  })

  // "All of them" has to stay UNSAID, or a tooth added to the item later would
  // arrive already assigned to the technician.
  it('stores nothing when the designer did everything', () => {
    const i = item(state({
      selectedTeeth: { Implantaadisild: [14, 15] },
      designByType: { Implantaadisild: [14, 15] },
    }))
    expect(i.disain_hambad).toBeUndefined()
  })

  it('stores nothing when nobody said', () => {
    expect(item(state()).disain_hambad).toBeUndefined()
    expect(item(state({ designByType: { Implantaadisild: [] } })).disain_hambad).toBeUndefined()
  })

  // A mark left on a tooth that was unticked on step 2 would otherwise reach
  // the payslip for a tooth that is not being made.
  it('drops a mark on a tooth that is no longer selected', () => {
    const i = item(state({
      selectedTeeth: { Implantaadisild: [14, 15] },
      designByType: { Implantaadisild: [14, 18] },
    }))
    expect(i.disain_hambad).toBe('14')
  })
})

describe('wizardWorkItems — screw / abutment only with an implant', () => {
  it('no implant marked: no abutment stored, even if one was typed', () => {
    const i = item(state({ abutmentByType: { Implantaadisild: 'MIS C1' } }))
    expect(i.kruvi).toBeUndefined()
    expect(i.kruvid).toBeUndefined()
  })

  it('the type-wide code, and per tooth only the implants that differ', () => {
    const i = item(state({
      implantsByType: { Implantaadisild: [14, 18] },
      abutmentByType: { Implantaadisild: 'MIS C1' },
      abutmentByTooth: { '18': 'Nobel', '15': 'ignored: not an implant' },
    }))
    expect(i.kruvi).toBe('MIS C1')
    expect(i.kruvid).toEqual({ '18': 'Nobel' })
  })
})
