import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { mayFillReference } from './useAutoClientReference'

describe('the new-job form\'s client reference (sql/140)', () => {
  it('fills an empty field, or replaces the one it filled itself', () => {
    expect(mayFillReference('', null)).toBe(true)
    expect(mayFillReference('  ', 'TF-DE-261127-001')).toBe(true)
    expect(mayFillReference('TF-DE-261127-001', 'TF-DE-261127-001')).toBe(true)
  })
  it('never writes over what a person typed', () => {
    expect(mayFillReference('2024-118', null)).toBe(false)
    expect(mayFillReference('TF-DE-261127-001 x', 'TF-DE-261127-001')).toBe(false)
  })
})
