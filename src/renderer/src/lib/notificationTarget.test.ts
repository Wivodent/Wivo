import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { notificationTarget } from './notificationTarget'

const ORDER = '11111111-1111-4111-8111-111111111111'
const JOB = '22222222-2222-4222-8222-222222222222'
const own = { isOwnJob: (id: string) => id === JOB, partnersOn: true }
const n = (kind: string, job_id: string | null = null, detail: Record<string, unknown> = {}) => ({ kind, job_id, detail }) as never

describe('where a bell notice goes', () => {
  it('a Network order opens Orders at that order; once accepted, the job it became', () => {
    expect(notificationTarget(n('client_order', null, { order: ORDER }), own)).toEqual({ to: 'order', orderId: ORDER })
    expect(notificationTarget(n('client_message', JOB, { order: ORDER }), own)).toEqual({ to: 'job', jobId: JOB })
    expect(notificationTarget(n('client_review', null, { order: ORDER }), own)).toEqual({ to: 'order', orderId: ORDER })
  })
  it('a request to connect opens Orders at "Asking to connect"', () => {
    expect(notificationTarget(n('client_request', null, { client: 'x' }), own)).toEqual({ to: 'requests' })
  })
  it('never "Shared with us" for a Network notice, nor without the partners module', () => {
    expect(notificationTarget(n('client_order', 'not-ours', { order: ORDER }), own)).toEqual({ to: 'order', orderId: ORDER })
    expect(notificationTarget(n('stage_reached', 'not-ours'), own)).toBeNull()
    expect(notificationTarget(n('job_shared', 'not-ours'), own)).toEqual({ to: 'partner' })
    expect(notificationTarget(n('job_shared', 'not-ours'), { ...own, partnersOn: false })).toBeNull()
  })
  it('our own job, security and update notices as before; the mail limit nowhere', () => {
    expect(notificationTarget(n('stage_reached', JOB), own)).toEqual({ to: 'job', jobId: JOB })
    expect(notificationTarget(n('mfa_reset'), own)).toEqual({ to: 'settings', group: 'turvalisus' })
    expect(notificationTarget(n('update_installed'), own)).toEqual({ to: 'settings' })
    expect(notificationTarget(n('mail_quota'), own)).toBeNull()
  })
})
