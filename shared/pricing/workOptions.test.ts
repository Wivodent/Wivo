/**
 * Work type options: one library, ids not names on the job, the price and the
 * cost per job or per tooth, archived options still priced on old jobs.
 */
import { describe, it, expect } from 'vitest'
import {
  kebab, newId, normaliseOptions, normaliseGroups, cleanChoice, optionLines, optionTotals, chosenOptionNames,
  normaliseOptionPrices, withOptionPrice, withoutOptionPrice, effectiveOption,
  type WorkOption, type WorkOptionGroup,
} from './workOptions'
import { quoteJob } from './quote'
import type { PriceBook } from './priceBook'

const LIBRARY: WorkOption[] = [
  { id: 'metal-bar', nimi: 'Metal bar', lisahind: 400, kulu: 120, yhik: 'too' },
  { id: 'titanium-mesh', nimi: 'Titanium mesh', lisahind: 600, kulu: 250, yhik: 'too' },
  { id: 'pink-gingiva', nimi: 'Pink gingiva', lisahind: 15, kulu: 4, yhik: 'hammas' },
  { id: 'old-bar', nimi: 'Old bar', lisahind: 300, kulu: 90, arhiivis: true },
]
const FRAMEWORK: WorkOptionGroup = { key: 'framework', nimi: 'Framework', mitu: false, valikud: ['metal-bar', 'titanium-mesh', 'old-bar'] }
const EXTRAS: WorkOptionGroup = { key: 'extras', nimi: 'Extras', mitu: true, valikud: ['pink-gingiva'] }

describe('ids', () => {
  it('English kebab-case from a name, unique, made once', () => {
    expect(kebab('Metal bar')).toBe('metal-bar')
    expect(kebab('Titaanvõrk / Ti')).toBe('titaanvork-ti')
    expect(newId('Metal bar', [])).toBe('metal-bar')
    expect(newId('Metal bar', ['metal-bar'])).toBe('metal-bar-2')
    expect(newId('Металлическая балка', [])).toBe('option-1')
    expect(newId('Каркас', ['option-1'], 'option')).toBe('option-2')
  })
})

describe('reading what is stored', () => {
  it('the library: junk dropped, duplicates once, per job by default', () => {
    expect(normaliseOptions([{ id: 'a', nimi: 'A', lisahind: '12' }, { id: 'a', nimi: 'B' }, { nimi: 'no id' }, 'x', null]))
      .toEqual([{ id: 'a', nimi: 'A', lisahind: 12, kulu: undefined, yhik: 'too' }])
    expect(normaliseOptions(undefined)).toEqual([])
  })

  it('a type\'s groups: junk dropped, none = undefined', () => {
    expect(normaliseGroups([{ key: 'f', nimi: 'F', mitu: 'yes', valikud: ['a', 'a', 3] }]))
      .toEqual([{ key: 'f', nimi: 'F', mitu: false, valikud: ['a'] }])
    expect(normaliseGroups([])).toBeUndefined()
    expect(normaliseGroups('x')).toBeUndefined()
  })
})

describe('the choice on a work item', () => {
  it('kept to what the type offers, one in a pick-one group', () => {
    expect(cleanChoice([FRAMEWORK, EXTRAS], {
      framework: ['metal-bar', 'titanium-mesh'], extras: ['pink-gingiva', 'nope'], gone: ['metal-bar'],
    })).toEqual({ framework: ['metal-bar'], extras: ['pink-gingiva'] })
    expect(cleanChoice([FRAMEWORK], { framework: [] })).toBeUndefined()
    expect(cleanChoice(undefined, { framework: ['metal-bar'] })).toBeUndefined()
  })
})

describe('price and cost', () => {
  const item = { hambad: '13,12,11,21,22,23', valikud: { framework: ['metal-bar'], extras: ['pink-gingiva'] } }

  it('per job once, per tooth times the teeth', () => {
    expect(optionLines(item, LIBRARY)).toEqual([
      { id: 'metal-bar', nimi: 'Metal bar', price: 400, cost: 120 },
      { id: 'pink-gingiva', nimi: 'Pink gingiva', price: 90, cost: 24 },
    ])
    expect(optionTotals(item, LIBRARY)).toEqual({ price: 490, cost: 144 })
  })

  it('an archived option still prices an old job; one deleted by hand adds nothing', () => {
    expect(optionTotals({ hambad: '11', valikud: { framework: ['old-bar'] } }, LIBRARY)).toEqual({ price: 300, cost: 90 })
    expect(optionTotals({ hambad: '11', valikud: { framework: ['gone'] } }, LIBRARY)).toEqual({ price: 0, cost: 0 })
  })

  it('no choice, or no library: nothing', () => {
    expect(optionTotals({ hambad: '11' }, LIBRARY)).toEqual({ price: 0, cost: 0 })
    expect(optionTotals(item, undefined)).toEqual({ price: 0, cost: 0 })
  })

  it('names for a card', () => {
    expect(chosenOptionNames(item.valikud, LIBRARY)).toEqual(['Metal bar', 'Pink gingiva'])
  })
})

describe('in the quote', () => {
  const book: PriceBook = {
    workTypes: [{ nimi: 'All-on-4', hex: '#000', hind: 3000, hinnaTyyp: 'too', valikuGrupid: [FRAMEWORK, EXTRAS] }],
    materialPrices: {}, hambaHind: 0, kiirtooKordaja: 1.5, designFee: 0, mudeliHind: 0, options: LIBRARY,
  }
  const items = [{ too: 'All-on-4', hambad: '13,12,11,21,22,23', valikud: { framework: ['metal-bar'] } }]

  it('each option its own line after the work, in production', () => {
    const q = quoteJob({ items }, book)
    expect(q.production).toBe(3400)
    expect(q.lines.map(l => [l.source, l.label, l.amount])).toEqual([
      ['tüüp', 'All-on-4', 3000],
      ['valik', 'All-on-4 · Metal bar', 400],
    ])
  })

  it('a rush job multiplies the options with the work', () => {
    expect(quoteJob({ items, kiirtoo: true }, book).production).toBe(5100)
  })

  it('a job with no options is quoted exactly as before', () => {
    expect(quoteJob({ items: [{ too: 'All-on-4', hambad: '11' }] }, book).production).toBe(3000)
    expect(quoteJob({ items }, { ...book, options: undefined }).production).toBe(3000)
  })
})

describe("a work type's own price for an option", () => {
  it('stored cleaned: numbers only, an empty entry dropped', () => {
    expect(normaliseOptionPrices({ 'metal-bar': { lisahind: '600', kulu: 'x' }, gone: {}, bad: 3 }))
      .toEqual({ 'metal-bar': { lisahind: 600 } })
    expect(normaliseOptionPrices([])).toBeUndefined()
    expect(normaliseOptionPrices(undefined)).toBeUndefined()
  })

  it('set one amount, keep the other; clearing both leaves nothing (the default again)', () => {
    let p = withOptionPrice(undefined, 'metal-bar', { lisahind: 600 })
    p = withOptionPrice(p, 'metal-bar', { kulu: 200 })
    expect(p).toEqual({ 'metal-bar': { lisahind: 600, kulu: 200 } })
    p = withOptionPrice(p, 'metal-bar', { lisahind: undefined })
    expect(p).toEqual({ 'metal-bar': { kulu: 200 } })
    expect(withOptionPrice(p, 'metal-bar', { kulu: undefined })).toBeUndefined()
  })

  it('"Use default" takes the type\'s own away, the others stay', () => {
    const p = { 'metal-bar': { lisahind: 600 }, 'ti-base': { kulu: 30 } }
    expect(withoutOptionPrice(p, 'metal-bar')).toEqual({ 'ti-base': { kulu: 30 } })
    expect(withoutOptionPrice({ 'metal-bar': { lisahind: 600 } }, 'metal-bar')).toBeUndefined()
  })

  it('own amounts are in the type\'s unit, defaults in the option\'s', () => {
    const pink = LIBRARY[2] // 15 € per tooth by default
    expect(effectiveOption(pink, { hinnaTyyp: 'too', valikuHinnad: { 'pink-gingiva': { lisahind: 90 } } }))
      .toEqual({ price: 90, priceUnit: 'too', cost: 4, costUnit: 'hammas', ownPrice: true, ownCost: false })
    expect(effectiveOption(pink, undefined))
      .toEqual({ price: 15, priceUnit: 'hammas', cost: 4, costUnit: 'hammas', ownPrice: false, ownCost: false })
  })
})
