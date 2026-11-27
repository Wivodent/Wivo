import { describe, expect, it } from 'vitest'
import { feedbackRoles } from './feedbackRoles'

const job = { order_doctor: 'doc', assigned_to: 'tech', designed_by: 'des' }
const who = (me: string, extra: Partial<Parameters<typeof feedbackRoles>[1]> = {}) =>
  ({ me, isOwner: false, isDoctor: false, fromOutside: false, orderKnown: true, ...extra })

describe('who gives which feedback (sql/146: only someone on the work)', () => {
  it('our own job: the ordering doctor rates the work, the makers the input; another doctor only says how it fitted', () => {
    expect(feedbackRoles(job, who('doc'))).toEqual({ mayFit: true, rateWork: true, rateInput: false, rateClient: false })
    expect(feedbackRoles(job, who('tech'))).toEqual({ mayFit: false, rateWork: false, rateInput: true, rateClient: false })
    expect(feedbackRoles(job, who('other', { isDoctor: true }))).toEqual({ mayFit: true, rateWork: false, rateInput: false, rateClient: false })
    expect(feedbackRoles(job, who('boss', { isOwner: true }))).toMatchObject({ mayFit: true, rateWork: false })
    // No doctor on it: the owner rates the work.
    expect(feedbackRoles({ ...job, order_doctor: null }, who('boss', { isOwner: true }))).toMatchObject({ rateWork: true })
  })

  it('an order from outside: the client says how it fitted; the makers and the owner rate the client', () => {
    const outside = { order_doctor: null, assigned_to: 'tech', designed_by: null }
    expect(feedbackRoles(outside, who('boss', { isOwner: true, fromOutside: true }))).toEqual({ mayFit: false, rateWork: false, rateInput: false, rateClient: true })
    expect(feedbackRoles(outside, who('tech', { fromOutside: true }))).toEqual({ mayFit: false, rateWork: false, rateInput: false, rateClient: true })
    expect(feedbackRoles(outside, who('stranger', { fromOutside: true, isDoctor: true }))).toEqual({ mayFit: false, rateWork: false, rateInput: false, rateClient: false })
  })

  it('before it is known whether the job came from an order: nothing that differs between the two', () => {
    expect(feedbackRoles(job, who('doc', { orderKnown: false }))).toMatchObject({ mayFit: false, rateWork: false, rateClient: false })
  })
})
