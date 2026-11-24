/**
 * A new clinic's default work types in its own language (Kevin, November
 * 2026: an English clinic gets English names). The names change; what the
 * wizard does with each type must not.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORK_TYPES, defaultWorkTypesFor, isUntouchedDefaultList, resolveWorkType, seedMissingTypes,
} from './workTypes'
import { workTypeRules } from '../wizard/workTypeRules'

describe('the default work types in a clinic\'s language', () => {
  it('Estonian (and no language): the list as it was', () => {
    expect(defaultWorkTypesFor('et')).toEqual(DEFAULT_WORK_TYPES)
    expect(defaultWorkTypesFor(null)).toEqual(DEFAULT_WORK_TYPES)
  })

  it('English: English names, the same colours', () => {
    const en = defaultWorkTypesFor('en')
    expect(en.map(t => t.nimi)).toEqual([
      'Implant crown', 'Implant bridge', 'Crown', 'Bridge', 'Veneer', 'Laminate veneer', 'Inlay', 'Onlay',
      'Filling', 'Denture', 'All-on-X', 'Night guard / splint', 'Retainer', 'Indirect bonding tray (IBT)', 'Surgical guide',
    ])
    expect(en.map(t => t.hex)).toEqual(DEFAULT_WORK_TYPES.map(t => t.hex))
  })

  it.each(['en', 'ru'] as const)('%s: each type behaves in the wizard exactly like its Estonian original', lang => {
    const list = defaultWorkTypesFor(lang)
    list.forEach((type, i) => {
      const { too: _a, nimi: _b, hex: _c, ...rules } = workTypeRules(type.nimi, list)
      const { too: _d, nimi: _e, hex: _f, ...original } = workTypeRules(DEFAULT_WORK_TYPES[i].nimi, DEFAULT_WORK_TYPES)
      expect(rules, type.nimi).toEqual(original)
    })
  })

  it.each(['en', 'ru'] as const)('%s: every name resolves to itself, and an Estonian name to its translation', lang => {
    const list = defaultWorkTypesFor(lang)
    list.forEach((type, i) => {
      expect(resolveWorkType(type.nimi, list).nimi).toBe(type.nimi)
      expect(resolveWorkType(DEFAULT_WORK_TYPES[i].nimi, list).nimi, DEFAULT_WORK_TYPES[i].nimi).toBe(type.nimi)
    })
  })

  it.each(['en', 'ru'] as const)('%s: nothing is seeded twice (Implantaadisild, Proteez are there already)', lang => {
    const list = defaultWorkTypesFor(lang)
    expect(seedMissingTypes(list)).toEqual(list)
  })
})

describe('only an untouched default list is translated', () => {
  it('the default: yes; a price, a rename, a picture, a missing type: no', () => {
    const d = () => DEFAULT_WORK_TYPES.map(t => ({ ...t }))
    expect(isUntouchedDefaultList(d())).toBe(true)
    expect(isUntouchedDefaultList(d().map((t, i) => (i === 2 ? { ...t, hind: 120 } : t)))).toBe(false)
    expect(isUntouchedDefaultList(d().map((t, i) => (i === 2 ? { ...t, nimi: 'Zirkoonkroon' } : t)))).toBe(false)
    expect(isUntouchedDefaultList(d().map((t, i) => (i === 0 ? { ...t, pilt: 'x.png' } : t)))).toBe(false)
    expect(isUntouchedDefaultList(d().slice(1))).toBe(false)
    expect(isUntouchedDefaultList(defaultWorkTypesFor('en'))).toBe(false)
  })
})
