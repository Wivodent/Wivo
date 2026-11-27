import { describe, expect, it } from 'vitest'
import {
  orderTab, countByTab, clientStatusOfTab, teethLabel, parseTeeth, formatTeeth, initials, dayPart,
  chosenOptionLabels, fileBadge, stepNumber, orderTouched, networkConfigured, UPPER_TEETH, LOWER_TEETH,
} from './orderView'

const DONE = 'valmis'

describe('an order\'s tab on the Orders page', () => {
  it('new and rejected come from the order itself', () => {
    expect(orderTab({ status: 'received', job_id: null }, undefined, DONE)).toBe('new')
    expect(orderTab({ status: 'rejected', job_id: null }, undefined, DONE)).toBe('rejected')
  })
  it('an accepted order follows its job, as the client is told (sql/138 client_order_status)', () => {
    const o = { status: 'accepted' as const, job_id: 'j1' }
    expect(orderTab(o, { id: 'j1', status: 'disain', delivery_status: 'labor' }, DONE)).toBe('in_progress')
    expect(orderTab(o, { id: 'j1', status: DONE, delivery_status: 'labor' }, DONE)).toBe('ready')
    expect(orderTab(o, { id: 'j1', status: DONE, delivery_status: 'teel' }, DONE)).toBe('sent')
    expect(orderTab(o, { id: 'j1', status: 'disain', delivery_status: 'yle_antud' }, DONE)).toBe('sent')
    // A job that cannot be read (gone, or no right to it) is not guessed at.
    expect(orderTab(o, undefined, DONE)).toBe('in_progress')
  })
  it('counts every tab from the rows, none made up', () => {
    const c = countByTab(['new', 'new', 'sent'] as const, x => x)
    expect(c).toEqual({ new: 2, in_progress: 0, ready: 0, sent: 1, rejected: 0 })
    expect(clientStatusOfTab('new')).toBe('received')
    expect(clientStatusOfTab('ready')).toBe('ready')
  })
})

describe('teeth', () => {
  it('neighbours in an arch run together, across the midline', () => {
    expect(teethLabel('13,12,11,21,22,23')).toBe('13–23')
    expect(teethLabel('36')).toBe('36')
    expect(teethLabel('11,21')).toBe('11, 21')
    expect(teethLabel('11,21,36,46')).toBe('11, 21, 46, 36')
    expect(teethLabel('')).toBe('')
    expect(teethLabel(UPPER_TEETH.join(','))).toBe('18–28')
  })
  it('the upper and lower arches never run into each other', () => {
    expect(teethLabel('28,48,47')).toBe('28, 48, 47')
  })
  it('reads only real FDI numbers, writes them back in mouth order', () => {
    expect(parseTeeth('11, 21,99,abc,11')).toEqual([11, 21])
    expect(formatTeeth([21, 11, 38, 48])).toBe('11,21,48,38')
    expect(parseTeeth(formatTeeth([...LOWER_TEETH]))).toHaveLength(16)
  })
})

describe('small things', () => {
  it('initials', () => {
    expect(initials('Tess Fake')).toBe('TF')
    expect(initials('Mart Kask Junior')).toBe('MJ')
    expect(initials('dentiks')).toBe('D')
    expect(initials('  ')).toBe('?')
  })
  it('the greeting by the hour', () => {
    expect(dayPart(8)).toBe('morning')
    expect(dayPart(12)).toBe('afternoon')
    expect(dayPart(18)).toBe('evening')
    expect(dayPart(2)).toBe('evening')
  })
  it('option names in group order; an id without a name is left out, never shown raw', () => {
    const names: Record<string, string> = { 'metal-bar': 'Metal bar', a2: 'A2' }
    expect(chosenOptionLabels({ framework: ['metal-bar'], other: ['unknown-id'] }, (_g, id) => names[id])).toEqual(['Metal bar'])
    expect(chosenOptionLabels(null, () => 'x')).toEqual([])
  })
  it('a file\'s little tile', () => {
    expect(fileBadge('upper jaw.stl')).toBe('STL')
    expect(fileBadge('photo.JPEG')).toBe('JPEG')
    expect(fileBadge('README')).toBe('')
  })
})

describe('the phone\'s New order steps', () => {
  it('counts only the steps the person sees: the clinic only when it was asked', () => {
    expect(stepNumber('work', false)).toEqual({ number: 1, total: 3 })
    expect(stepNumber('review', false)).toEqual({ number: 3, total: 3 })
    expect(stepNumber('clinic', true)).toEqual({ number: 1, total: 4 })
    expect(stepNumber('work', true)).toEqual({ number: 2, total: 4 })
    expect(stepNumber('review', true)).toEqual({ number: 4, total: 4 })
  })
  it('a form is touched by anything filled in, or a file', () => {
    const empty = { work_type: '', teeth: '', options: {}, shade: null, due: null, patient_ref: '', notes: null }
    expect(orderTouched(empty, 0)).toBe(false)
    expect(orderTouched({ ...empty, options: { framework: [] } }, 0)).toBe(false)
    expect(orderTouched({ ...empty, patient_ref: '   ' }, 0)).toBe(false)
    expect(orderTouched(empty, 1)).toBe(true)
    expect(orderTouched({ ...empty, work_type: 'Crown' }, 0)).toBe(true)
    expect(orderTouched({ ...empty, teeth: '11' }, 0)).toBe(true)
    expect(orderTouched({ ...empty, options: { framework: ['metal-bar'] } }, 0)).toBe(true)
    expect(orderTouched({ ...empty, notes: 'x' }, 0)).toBe(true)
  })
})

describe('the Orders page\'s Network card', () => {
  it('shows the owner switches only once Wivo has connected the clinic (key and number)', () => {
    expect(networkConfigured(null)).toBe(false)
    expect(networkConfigured({ network_public_key: 'A'.repeat(43), network_clinic_id: null })).toBe(false)
    expect(networkConfigured({ network_public_key: null, network_clinic_id: 'x' })).toBe(false)
    expect(networkConfigured({ network_public_key: 'A'.repeat(43), network_clinic_id: 'x' })).toBe(true)
  })
})
