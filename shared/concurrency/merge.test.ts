import { describe, expect, it } from 'vitest'
import { jsonEqual, merge3 } from './merge'

const crown = { nimi: 'Crown', hex: '#1', hind: 100 }
const bridge = { nimi: 'Bridge', hex: '#2', hind: 200 }
const design = { nimi: 'Crown design', hex: '#3', hind: 30 }

describe('jsonEqual', () => {
  it('ignores key order and undefined keys, and reads "12.50" as 12.5', () => {
    expect(jsonEqual({ a: 1, b: undefined, c: [1, { d: 2 }] }, { c: [1, { d: 2 }], a: 1 })).toBe(true)
    expect(jsonEqual({ a: 1 }, { a: 2 })).toBe(false)
    expect(jsonEqual([1, 2], [2, 1])).toBe(false)
    expect(jsonEqual(12.5, '12.50')).toBe(true)
    expect(jsonEqual(null, undefined)).toBe(false)
  })
})

describe('merge3: two owners, one list of work types', () => {
  const base = [crown, bridge, design]

  it('different work types changed: both changes stay', () => {
    const mine = [{ ...crown, hind: 110 }, bridge, design]
    const theirs = [crown, bridge, { ...design, hind: 35 }]
    const r = merge3(base, mine, theirs)
    expect(r.conflicts).toEqual([])
    expect(r.value).toEqual([{ ...crown, hind: 110 }, bridge, { ...design, hind: 35 }])
  })

  it('different fields of the same work type: both stay', () => {
    const mine = [{ ...crown, hind: 110 }, bridge, design]
    const theirs = [{ ...crown, hex: '#9' }, bridge, design]
    expect(merge3(base, mine, theirs)).toEqual({ value: [{ ...crown, hind: 110, hex: '#9' }, bridge, design], conflicts: [] })
  })

  it('the same price changed by both: theirs stays, and it is named', () => {
    const mine = [{ ...crown, hind: 110 }, bridge, design]
    const theirs = [{ ...crown, hind: 120 }, bridge, design]
    const r = merge3(base, mine, theirs)
    expect(r.value[0].hind).toBe(120)
    expect(r.conflicts).toEqual([{ path: ['Crown', 'hind'], base: 100, mine: 110, theirs: 120 }])
  })

  it('one adds a type, the other removes another: both happen', () => {
    const added = { nimi: 'Veneer', hex: '#4' }
    const mine = [crown, bridge, design, added]
    const theirs = [crown, design]
    expect(merge3(base, mine, theirs)).toEqual({ value: [crown, design, added], conflicts: [] })
  })

  it('both add a different type at once: both are kept', () => {
    const a = { nimi: 'Veneer', hex: '#4' }, b = { nimi: 'Inlay', hex: '#5' }
    const r = merge3(base, [...base, a], [...base, b])
    expect(r.conflicts).toEqual([])
    expect(r.value.map(x => x.nimi).sort()).toEqual(['Bridge', 'Crown', 'Crown design', 'Inlay', 'Veneer'])
  })

  it('removed by me, changed by them: theirs is kept, and it is named', () => {
    const r = merge3(base, [crown, bridge], [crown, bridge, { ...design, hind: 40 }])
    expect(r.value).toEqual([crown, bridge, { ...design, hind: 40 }])
    expect(r.conflicts[0].path).toEqual(['Crown design'])
  })

  it('I reorder, they change a price: my order, their price', () => {
    const r = merge3(base, [design, crown, bridge], [crown, { ...bridge, hind: 250 }, design])
    expect(r.conflicts).toEqual([])
    expect(r.value).toEqual([design, crown, { ...bridge, hind: 250 }])
  })
})

describe('merge3: other shapes', () => {
  it('an object of settings: different keys both stay', () => {
    const base = { designFee: 10, kmMaar: 24, tooValikud: [{ id: 'a', nimi: 'A' }] }
    const r = merge3(base, { ...base, designFee: 12 }, { ...base, tooValikud: [{ id: 'a', nimi: 'A' }, { id: 'b', nimi: 'B' }] })
    expect(r).toEqual({ value: { designFee: 12, kmMaar: 24, tooValikud: [{ id: 'a', nimi: 'A' }, { id: 'b', nimi: 'B' }] }, conflicts: [] })
  })

  it('a list of names is a set: one adds a machine, the other removes one', () => {
    expect(merge3(['A', 'B'], ['A', 'B', 'C'], ['B'])).toEqual({ value: ['B', 'C'], conflicts: [] })
  })

  it('a list without identities is one value', () => {
    const base = [{ nimi: 'x', summa: 1 }, { nimi: 'x', summa: 2 }]
    const r = merge3(base, [{ nimi: 'x', summa: 1 }], [{ nimi: 'x', summa: 3 }])
    expect(r.conflicts.length).toBe(1)
    expect(r.value).toEqual([{ nimi: 'x', summa: 3 }])
  })

  it('a value only one side changed is that side\'s', () => {
    expect(merge3(1, 2, 1).value).toBe(2)
    expect(merge3(1, 1, 3).value).toBe(3)
    expect(merge3(1, 4, 4)).toEqual({ value: 4, conflicts: [] })
  })
})

describe('merge3: online booking hours (clinic_settings.broneering, 2.2.4)', () => {
  const base = {
    tooajad: { '1': [{ algus: '09:00', lopp: '17:00' }], '2': [{ algus: '09:00', lopp: '17:00' }] },
    visiiditasu: 20, valuuta: 'EUR',
  }
  it('two owners change different days: both stay, the payment settings too', () => {
    const anna = { ...base, tooajad: { ...base.tooajad, '1': [{ algus: '08:00', lopp: '16:00' }] } }
    const bert = { ...base, tooajad: { ...base.tooajad, '2': [] }, visiiditasu: 25 }
    expect(merge3(base, anna, bert)).toEqual({
      value: { tooajad: { '1': [{ algus: '08:00', lopp: '16:00' }], '2': [] }, visiiditasu: 25, valuuta: 'EUR' },
      conflicts: [],
    })
  })
  it('the same day changed by both: a conflict on that day', () => {
    const anna = { ...base, tooajad: { ...base.tooajad, '1': [{ algus: '08:00', lopp: '16:00' }] } }
    const bert = { ...base, tooajad: { ...base.tooajad, '1': [{ algus: '10:00', lopp: '18:00' }] } }
    expect(merge3(base, anna, bert).conflicts.map(c => c.path)).toEqual([['tooajad', '1']])
  })
})
