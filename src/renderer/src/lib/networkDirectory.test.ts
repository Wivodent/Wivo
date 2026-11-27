import { describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))

import { directoryProblemOf, inviteLink } from './networkDirectory'

describe('the invite link', () => {
  it('opens the clinic in its own phone app\'s Network mode', () => {
    expect(inviteLink('abcdef123456789012', 'https://wivo.dentiks.lv')).toBe('https://wivo.dentiks.lv/network/join/abcdef123456789012')
  })
  it('is no link for a code that is not one', () => {
    expect(inviteLink('../evil', 'https://wivo.dentiks.lv')).toBeNull()
    expect(inviteLink('short', 'https://wivo.dentiks.lv')).toBeNull()
    expect(inviteLink('ABCDEF123456789012', 'https://wivo.dentiks.lv')).toBeNull()
  })
})

describe('what the card says', () => {
  it('by the function\'s answer', () => {
    expect(directoryProblemOf(403, 'not_allowed')).toBe('not_allowed')
    expect(directoryProblemOf(403, 'second_factor')).toBe('not_allowed')
    expect(directoryProblemOf(409, 'orders_off')).toBe('orders_off')
    expect(directoryProblemOf(409, 'try_again')).toBe('try_again')
    expect(directoryProblemOf(502, 'network_unreachable')).toBe('unreachable')
    expect(directoryProblemOf(502, 'network_refused')).toBe('unreachable')
    // Not deployed or not set up: the neutral "not available yet".
    expect(directoryProblemOf(404, null)).toBe('not_available')
    expect(directoryProblemOf(503, 'not_set_up')).toBe('not_available')
    expect(directoryProblemOf(409, 'not_set_up')).toBe('not_available')
    expect(directoryProblemOf(undefined, null)).toBe('not_available')
  })
})
