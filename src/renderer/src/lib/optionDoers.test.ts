/**
 * Who makes a job's chosen option (sql/130): listing them and setting one,
 * without touching anything else on the work item.
 */
import { describe, it, expect } from 'vitest'
import { chosenOptions, withOptionDoer } from './optionDoers'
import type { WorkItem } from '../types/job'

const items: WorkItem[] = [
  { id: 'a', too: 'All-on-4', hambad: '11,21', valikud: { framework: ['metal-bar'], extras: ['pink-gingiva'] } },
  { id: 'b', too: 'Kroon', hambad: '36' },
]
const names = new Map([['metal-bar', 'Metal bar']])

describe('chosenOptions', () => {
  it('every chosen option in order, the name from the library, no doer = the technician', () => {
    expect(chosenOptions(items, names)).toEqual([
      { itemId: 'a', too: 'All-on-4', optionId: 'metal-bar', name: 'Metal bar', doer: null },
      { itemId: 'a', too: 'All-on-4', optionId: 'pink-gingiva', name: 'pink-gingiva', doer: null },
    ])
  })
})

describe('withOptionDoer', () => {
  it('sets one doer on one item, the rest untouched', () => {
    const next = withOptionDoer(items, 'a', 'metal-bar', 'tech-b')
    expect(next[0].valikuTegijad).toEqual({ 'metal-bar': 'tech-b' })
    expect(next[0].valikud).toEqual(items[0].valikud)
    expect(next[1]).toBe(items[1])
    expect(chosenOptions(next, names)[0].doer).toBe('tech-b')
  })

  it('back to the technician removes it; nothing left removes the field', () => {
    const set = withOptionDoer(items, 'a', 'metal-bar', 'tech-b')
    const back = withOptionDoer(set, 'a', 'metal-bar', null)
    expect('valikuTegijad' in back[0]).toBe(false)
  })
})
