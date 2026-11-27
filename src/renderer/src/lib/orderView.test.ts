import { describe, expect, it } from 'vitest'
import {
  orderTab, countByTab, clientStatusOfTab, teethLabel, parseTeeth, formatTeeth, initials, dayPart,
  chosenOptionLabels, fileBadge, stepNumber, orderTouched, networkConfigured, UPPER_TEETH, LOWER_TEETH,
  catalogueRules, withAutoImplants, implantSummary, expectedImplants, wireOrder, sentMessage,
  threadItems, reviewAnswer, latestReview, isImageFile, type ThreadMessage, type ThreadFile,
} from './orderView'
import { orderProblems, type CatalogueItem } from '@shared/network/order'

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
    // A database before sql/145 (no sent_at at all) knows only Sent.
    expect(orderTab(o, { id: 'j1', status: DONE, delivery_status: 'teel' }, DONE)).toBe('sent')
    expect(orderTab(o, { id: 'j1', status: 'disain', delivery_status: 'yle_antud' }, DONE)).toBe('sent')
    // sql/145: Sent → Received, or a delivery problem until the clinic resolves it.
    const sent = { id: 'j1', status: DONE, delivery_status: 'teel', sent_at: '2026-11-20T10:00:00Z', received_at: null }
    expect(orderTab(o, sent, DONE)).toBe('sent')
    expect(orderTab(o, { ...sent, received_at: '2026-11-22T10:00:00Z' }, DONE)).toBe('arrived')
    expect(orderTab(o, { ...sent, problem: true }, DONE)).toBe('problem')
    // Sent before 145 (no sent_at): received.
    expect(orderTab(o, { ...sent, sent_at: null }, DONE)).toBe('arrived')
    // sql/146: its job deleted: Cancelled by clinic, never back to In progress (the job cannot be read then).
    expect(orderTab({ ...o, cancelled_at: '2026-11-27T10:00:00Z' }, undefined, DONE)).toBe('cancelled')
    expect(orderTab({ ...o, cancelled_at: '2026-11-27T10:00:00Z' }, sent, DONE)).toBe('cancelled')
    // A job that cannot be read (gone, or no right to it) is not guessed at.
    expect(orderTab(o, undefined, DONE)).toBe('in_progress')
  })
  it('counts every tab from the rows, none made up', () => {
    const c = countByTab(['new', 'new', 'sent'] as const, x => x)
    expect(c).toEqual({ new: 2, in_progress: 0, ready: 0, sent: 1, arrived: 0, problem: 0, rejected: 0, cancelled: 0 })
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

describe('implants in an order from outside (sql/141)', () => {
  const item = (over: Partial<CatalogueItem>): CatalogueItem => ({ name: 'X', teeth: 'tooth', groups: [], order_version: 2, ...over })

  it('reads the new-job form\'s rules from the catalogue entry', () => {
    expect(catalogueRules(item({ name: 'Implant crown' }))).toMatchObject({ implantBased: true, isBridge: false, toothMode: 'tooth' })
    expect(catalogueRules(item({ name: 'Implant bridge', liik: 'bridge' }))).toMatchObject({ implantBased: true, isBridge: true })
    expect(catalogueRules(item({ name: 'All-on-4', liik: 'arch', teeth: 'arch' }))).toMatchObject({ implantBased: true, toothMode: 'arch' })
    expect(catalogueRules(item({ name: 'Hybrid denture', teeth: 'arch' }))).toMatchObject({ implantBased: true })
    expect(catalogueRules(item({ name: 'Zirconia crown' }))).toMatchObject({ implantBased: false, isBridge: false })
  })

  it('an implant crown: the tooth picked is an implant at once; a tooth let go takes its implant with it', () => {
    expect(withAutoImplants([], [36], [], true)).toEqual([36])
    expect(withAutoImplants([36], [36, 46], [], true)).toEqual([46])  // 36 unmarked by hand stays unmarked
    expect(withAutoImplants([36, 46], [46], [36, 46], true)).toEqual([46])
    expect(withAutoImplants([], [11], [], false)).toEqual([])
  })

  it('the summary: implants and, for a bridge on implants, the pontics', () => {
    expect(implantSummary([14, 13, 12], [14, 12], true, true)).toEqual({ teeth: 3, implants: [14, 12], pontics: [13] })
    expect(implantSummary([14, 13, 12], [14, 12], false, true).pontics).toEqual([])
  })

  it('All-on-N says how many implants it carries', () => {
    expect(expectedImplants('All-on-4')).toBe(4)
    expect(expectedImplants('all on 6 upper')).toBe(6)
    expect(expectedImplants('Allon5')).toBe(5)
    expect(expectedImplants('Implant bridge')).toBeNull()
  })

  it('the order sent: v2 with implants among the teeth and only differing abutments; v1 without them', () => {
    const form = { format: 'wivo-order' as const, version: 1 as const, work_type: 'Implant bridge', teeth: '14,13,12', options: {}, shade: null, due: null, patient_ref: 'R', notes: null }
    const extra = { implants: [12, 14, 21], abutmentAll: ' MIS C1 ', abutmentTeeth: { 12: 'Straumann BL', 14: 'MIS C1' } }
    expect(wireOrder(form, extra, true)).toEqual({ ...form, version: 2, implants: '14,12', abutment: { all: 'MIS C1', teeth: { 12: 'Straumann BL' } } })
    expect(wireOrder(form, { implants: [14], abutmentAll: '', abutmentTeeth: {} }, true)).toMatchObject({ implants: '14', abutment: null })
    expect(wireOrder(form, extra, false)).toEqual({ ...form, version: 1 })
    expect(orderProblems(wireOrder(form, extra, true))).toEqual([])
  })
})

describe('an order conversation: files with their messages, reviews (sql/143)', () => {
  const m = (id: string, at: string, over: Partial<ThreadMessage> = {}): ThreadMessage => ({ id, from_client: false, body: id, created_at: at, ...over })
  const f = (id: string, message_id: string | null, name = `${id}.stl`): ThreadFile => ({ id, file_name: name, size: 1, created_at: '2026-11-27', message_id })
  it('each message gets its files; files sent with the order, or of a message not shown, stand apart', () => {
    const t = threadItems([m('a', '1'), m('b', '2')], [f('x', 'a'), f('y', null), f('z', 'b'), f('w', 'gone')])
    expect(t.messages.map(x => [x.id, x.files.map(y => y.id)])).toEqual([['a', ['x']], ['b', ['z']]])
    expect(t.orderFiles.map(x => x.id)).toEqual(['y', 'w'])
  })
  it('the latest answer to a review, and the latest on the order', () => {
    const msgs = [m('q', '1', { needs_review: true }), m('r1', '2', { from_client: true, review_of: 'q', review_state: 'changes' }), m('r2', '3', { from_client: true, review_of: 'q', review_state: 'approved' }), m('q2', '4', { needs_review: true })]
    expect(reviewAnswer('q', msgs)?.review_state).toBe('approved')
    expect(reviewAnswer('q2', msgs)).toBeNull()
    expect(latestReview(msgs)?.id).toBe('r2')
  })
  it('a picture is shown as a preview; a scan or a PDF is an icon and a name', () => {
    expect(isImageFile({ file_name: 'x.JPG', mime_type: null })).toBe(true)
    expect(isImageFile({ file_name: 'x', mime_type: 'image/png' })).toBe(true)
    expect(isImageFile({ file_name: 'jaw.stl', mime_type: 'model/stl' })).toBe(false)
    expect(isImageFile({ file_name: 'plan.pdf', mime_type: null })).toBe(false)
  })
})
