/**
 * A work type's kind is its own setting (WorkType.liik, Settings → Prices →
 * "Type", 2.2.2), not something guessed from a name it no longer has.
 *
 * Dentiks renamed the English defaults: "Bridge" became "Crown design" and
 * kept "sild" among its synonyms, so the new job asked a single crown's design
 * for two teeth and showed it as a bridge. Design work is never a bridge by its
 * words; an owner's choice wins over the words either way.
 */
import { describe, expect, it } from 'vitest'
import type { TeethKind, WorkType } from '../pricing/workTypes'
import { DEFAULT_WORK_TYPES, defaultWorkTypesFor, storedTeethKind } from '../pricing/workTypes'
import { createEmptyNewJobState, type NewJobState } from './types'
import { validateStep } from './validation'
import { isDesignWork, teethKindOf, workTypeRules } from './workTypeRules'

/** The English defaults as a clinic renames them: the name changes, the old synonyms stay. */
const renamed = (list: WorkType[], from: string, to: string): WorkType[] =>
  list.map(type => (type.nimi === from ? { ...type, nimi: to } : type))

const en = defaultWorkTypesFor('en')
let dentiks = renamed(en, 'Bridge', 'Crown design')
dentiks = renamed(dentiks, 'Implant bridge', 'smile design')
dentiks = renamed(dentiks, 'Implant crown', 'implant surgical guide')
dentiks = renamed(dentiks, 'Crown', 'Titanium mesh')
// And the Estonian ones, as they are on a list carried over from Tallinn.
const byName = (nimi: string) => DEFAULT_WORK_TYPES.find(type => type.nimi === nimi)!
dentiks = [...dentiks, byName('Kroon'), byName('Sild'), byName('Implantaadisild')]

const state = (over: Partial<NewJobState>): NewJobState => ({
  ...createEmptyNewJobState({ date: '2026-11-26' }),
  ...over,
})
const oneTooth = (nimi: string, types: readonly WorkType[]) =>
  validateStep(2, state({ jobTypes: [nimi], selectedTeeth: { [nimi]: [11] } }), types)

describe("Dentiks's names (2.2.2)", () => {
  it('the stale synonyms are really there: the test is about the real case', () => {
    expect(dentiks.find(type => type.nimi === 'Crown design')!.match).toContain('sild')
    expect(dentiks.find(type => type.nimi === 'smile design')!.match).toContain('implantsild')
  })

  it.each([
    ['Crown design', 'single'],
    ['smile design', 'single'],
    ['implant surgical guide', 'single'],
    ['Titanium mesh', 'single'],
    ['Kroon', 'single'],
    ['Sild', 'bridge'],
    ['Implantaadisild', 'bridge'],
  ] as const)('%s is %s', (nimi, kind) => {
    const type = dentiks.find(x => x.nimi === nimi)!
    expect(workTypeRules(nimi, dentiks).isBridge).toBe(kind === 'bridge')
    expect(teethKindOf(type)).toBe(kind)
  })

  it('one tooth for Crown design is not refused; for Sild it is, with the way out', () => {
    expect(oneTooth('Crown design', dentiks)).toEqual([])
    const [e] = oneTooth('Sild', dentiks)
    expect(e.severity).toBe('error')
    expect(e.changeType).toBe('Sild')
  })

  it('a second Sild on the job (Sild§2) still points at the type itself', () => {
    const out = validateStep(2, state({ jobTypes: ['Sild', 'Sild§2'], selectedTeeth: { Sild: [11, 12], 'Sild§2': [21] } }), dentiks)
    expect(out.map(e => e.changeType)).toEqual(['Sild'])
  })
})

describe('design work is never a bridge by its words', () => {
  it.each(['Crown design', 'Krooni disain', 'Дизайн коронки', 'Bridge design', 'Silla disain', 'Kroņa dizains'])('%s', nimi => {
    const type: WorkType = { nimi, hex: '#000', match: ['sild', 'bridge'] }
    expect(isDesignWork(type)).toBe(true)
    expect(workTypeRules(nimi, [type]).isBridge).toBe(false)
  })

  it('a type from the catalogue\'s digital work, whatever it is called now', () => {
    const type: WorkType = { nimi: 'Sild CAD', hex: '#000', katalog: 'crown-design' }
    expect(workTypeRules('Sild CAD', [type]).isBridge).toBe(false)
  })

  it('only the own name says design, not an old synonym', () => {
    const type: WorkType = { nimi: 'Sild', hex: '#000', match: ['bridge design'] }
    expect(workTypeRules('Sild', [type]).isBridge).toBe(true)
  })
})

describe("the owner's own choice (work_types[].liik)", () => {
  const withKind = (nimi: string, liik: WorkType['liik']) =>
    dentiks.map(type => (type.nimi === nimi ? { ...type, liik } : type))

  it('wins over the words, both ways', () => {
    expect(workTypeRules('Crown design', withKind('Crown design', 'bridge')).isBridge).toBe(true)
    expect(oneTooth('Crown design', withKind('Crown design', 'bridge'))[0].changeType).toBe('Crown design')
    expect(workTypeRules('Sild', withKind('Sild', 'single')).isBridge).toBe(false)
    expect(oneTooth('Sild', withKind('Sild', 'single'))).toEqual([])
  })

  it('full arch and per job set which teeth the form asks for', () => {
    expect(workTypeRules('Kroon', withKind('Kroon', 'arch')).toothMode).toBe('arch')
    const none = workTypeRules('Kroon', withKind('Kroon', 'none'))
    expect(none.toothMode).toBe('none')
    expect(none.requiresTeeth).toBe(false)
    expect(none.isBridge).toBe(false)
  })

  it('wins over the catalogue\'s hambaviis', () => {
    const type: WorkType = { nimi: 'Digital scan', hex: '#000', hambaviis: 'none', liik: 'single' }
    expect(workTypeRules('Digital scan', [type]).toothMode).toBe('tooth')
  })

  it('a type nobody has touched keeps the kind it had', () => {
    for (const type of DEFAULT_WORK_TYPES) {
      const r = workTypeRules(type.nimi, DEFAULT_WORK_TYPES)
      const expected: TeethKind = r.toothMode === 'arch' ? 'arch' : r.toothMode === 'none' ? 'none' : r.isBridge ? 'bridge' : 'single'
      expect(teethKindOf(type), type.nimi).toBe(expected)
      // Storing the shown value changes nothing on the form.
      const stored = DEFAULT_WORK_TYPES.map(x => (x === type ? { ...x, liik: expected } : x))
      const after = workTypeRules(type.nimi, stored)
      expect([after.toothMode, after.isBridge], type.nimi).toEqual([r.toothMode, r.isBridge])
    }
  })

  it('only the four kinds are kept from the stored list', () => {
    for (const v of ['single', 'bridge', 'arch', 'none'] as const) expect(storedTeethKind(v)).toBe(v)
    for (const v of ['', 'Bridge', 'tooth', 1, null, undefined, {}]) expect(storedTeethKind(v)).toBeUndefined()
  })
})
