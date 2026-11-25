/**
 * The work type catalogue: no prices or costs anywhere in it, names in four
 * languages, groups that point at real options, and adding an entry makes an
 * ordinary work type without touching anything already there.
 */
import { describe, it, expect } from 'vitest'
import { CATALOGUE, OPTIONS, catalogueEntry, catalogueLang, workTypeFromCatalogue } from './workTypeCatalogue'
import { DEFAULT_WORK_TYPES, type WorkType } from './workTypes'
import { workTypeRules } from '../wizard/workTypeRules'

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MONEY = ['hind', 'soodushind', 'astmed', 'kulud', 'lisahind', 'kulu', 'price', 'cost']

describe('the catalogue', () => {
  it('ids are unique English kebab-case; every name is there in en, et, ru and lv', () => {
    expect(new Set(CATALOGUE.map(e => e.id)).size).toBe(CATALOGUE.length)
    for (const e of CATALOGUE) {
      expect(e.id).toMatch(KEBAB)
      for (const lang of ['en', 'et', 'ru', 'lv'] as const) expect(e.names[lang].trim(), `${e.id} ${lang}`).not.toBe('')
    }
    for (const o of OPTIONS) {
      expect(o.id).toMatch(KEBAB)
      for (const lang of ['en', 'et', 'ru', 'lv'] as const) expect(o.names[lang].trim(), `${o.id} ${lang}`).not.toBe('')
    }
  })

  it('has no price and no cost anywhere: those are always the clinic\'s own', () => {
    const json = JSON.stringify({ CATALOGUE, OPTIONS })
    for (const key of MONEY) expect(json, key).not.toContain(`"${key}"`)
  })

  it('every suggested option is one the catalogue defines', () => {
    const ids = new Set(OPTIONS.map(o => o.id))
    for (const e of CATALOGUE) for (const g of e.groups ?? []) for (const id of g.options) expect(ids.has(id), `${e.id} → ${id}`).toBe(true)
  })

  it('All-on-4 suggests the frameworks and the attachments', () => {
    const groups = catalogueEntry('all-on-4')!.groups!
    expect(groups.find(g => g.key === 'framework')!.options).toEqual(['metal-bar', 'zirconia-framework', 'cocr-framework', 'peek-bar'])
    expect(groups.find(g => g.key === 'attachments')!.options).toEqual(['multi-unit', 'ti-base'])
  })

  it('built on implants: the implant crown and bridge, abutments, All-on-4/5/6, hybrid and overdenture', () => {
    expect(CATALOGUE.filter(e => e.implantBased).map(e => e.id).sort()).toEqual([
      'all-on-4', 'all-on-4-bar', 'all-on-5', 'all-on-6', 'crown-implant', 'custom-abutment',
      'hybrid-denture', 'implant-abutment', 'implant-bridge', 'overdenture',
    ])
  })

  it('a clinic language picks the names; anything else is English', () => {
    expect(catalogueLang('et')).toBe('et')
    expect(catalogueLang('lv')).toBe('lv')
    expect(catalogueLang(null)).toBe('en')
  })
})

describe('adding an entry', () => {
  const library = [{ id: 'metal-bar', nimi: 'Metallraam', lisahind: 400, yhik: 'too' as const }]

  it('an ordinary type in the clinic\'s language: no price, the entry\'s unit and options', () => {
    const { type, newOptions } = workTypeFromCatalogue(catalogueEntry('all-on-4')!, 'et', DEFAULT_WORK_TYPES, library)
    expect(type).toMatchObject({ nimi: 'All-on-4', hinnaTyyp: 'too', katalog: 'all-on-4' })
    expect(type.hind).toBeUndefined()
    expect(type.kulud).toBeUndefined()
    expect(type.valikuGrupid!.map(g => g.nimi)).toEqual(['Raam', 'Kinnitused', 'Lisad'])
    // The metal bar is already in the library (with its price): only the rest is added, unpriced.
    expect(newOptions.map(o => o.id)).toEqual(['zirconia-framework', 'cocr-framework', 'peek-bar', 'multi-unit', 'ti-base', 'pink-gingiva', 'temporary-pmma'])
    expect(newOptions.every(o => o.lisahind === undefined && o.kulu === undefined)).toBe(true)
    expect(newOptions[0].nimi).toBe('Tsirkooniumraam')
  })

  it('a name already on the list gets a number; the list itself is not touched', () => {
    const list: WorkType[] = [{ nimi: 'Zirconia crown', hex: '#000', hind: 300 }]
    const before = JSON.stringify(list)
    const { type } = workTypeFromCatalogue(catalogueEntry('crown-zirconia')!, 'en', list, [])
    expect(type.nimi).toBe('Zirconia crown 2')
    expect(JSON.stringify(list)).toBe(before)
  })

  it('its other names are synonyms, so the form\'s rules work in any language', () => {
    const { type } = workTypeFromCatalogue(catalogueEntry('bridge')!, 'lv', [], [])
    expect(type.nimi).toBe('Tilts')
    expect(type.match).toEqual(expect.arrayContaining(['bridge', 'sild', 'мост']))
    expect(workTypeRules('Tilts', [type]).isBridge).toBe(true)
  })

  it('implant-based by the entry, whatever the type is called later', () => {
    const { type } = workTypeFromCatalogue(catalogueEntry('crown-implant')!, 'en', [], [])
    const renamed = { ...type, nimi: 'Our special', match: [] }
    expect(workTypeRules('Our special', [renamed]).implantBased).toBe(true)
  })

  it('work whose words cannot tell which teeth it wants says so (a digital scan: none)', () => {
    const { type } = workTypeFromCatalogue(catalogueEntry('digital-scan')!, 'en', [], [])
    expect(type.hambaviis).toBe('none')
    expect(workTypeRules(type.nimi, [type]).toothMode).toBe('none')
  })
})
