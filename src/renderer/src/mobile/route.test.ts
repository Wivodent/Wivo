import { describe, it, expect } from 'vitest'
import { parseRoute, routePath } from './route'

const id = '0b6f3c1e-2a4d-4e8b-9c1f-5d7a2b3c4d5e'

describe('phone routes', () => {
  it('reads a job, settings, and everything else as home', () => {
    expect(parseRoute(`/job/${id}`)).toEqual({ name: 'job', id })
    expect(parseRoute(`/job/${id.toUpperCase()}/`)).toEqual({ name: 'job', id })
    expect(parseRoute('/settings')).toEqual({ name: 'settings' })
    expect(parseRoute('/new')).toEqual({ name: 'new' })
    for (const p of ['/', '', '/job/', '/job/not-an-id', `/job/${id}/x`, '/board', '/settings/x', '/new/x']) {
      expect(parseRoute(p)).toEqual({ name: 'home' })
    }
  })

  it('round-trips', () => {
    for (const r of [{ name: 'home' }, { name: 'settings' }, { name: 'new' }, { name: 'job', id }] as const) {
      expect(parseRoute(routePath(r))).toEqual(r)
    }
  })
})

describe('the Orders route (Network notices on the phone)', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('an order, who asks to connect, the page', () => {
    expect(parseRoute(`/orders/${id}`)).toEqual({ name: 'orders', orderId: id })
    expect(parseRoute('/orders/requests')).toEqual({ name: 'orders', requests: true })
    expect(parseRoute('/orders')).toEqual({ name: 'orders' })
    for (const r of [{ name: 'orders', orderId: id }, { name: 'orders', requests: true }] as const) expect(parseRoute(routePath(r))).toEqual(r)
  })
})
