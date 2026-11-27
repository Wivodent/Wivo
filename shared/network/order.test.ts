import { describe, expect, it } from 'vitest'
import { emptyOrder, orderProblems, type CatalogueItem, type WivoOrderV1 } from './order'
import { inviteCodeOf } from '../../src/renderer/src/mobile/network/NetworkApp'
import { isNetworkPath, parseRoute } from '../../src/renderer/src/mobile/route'
import { validApiUrl } from '../../src/renderer/src/lib/network'

const CATALOGUE: CatalogueItem[] = [
  { name: 'Zirconia crown', teeth: 'tooth', groups: [] },
  { name: 'All-on-4', teeth: 'arch', groups: [{ key: 'framework', name: 'Framework', multi: false, options: [{ id: 'metal-bar', name: 'Metal bar' }, { id: 'peek-bar', name: 'PEEK bar' }] }] },
]
const order = (over: Partial<WivoOrderV1> = {}): WivoOrderV1 => ({ ...emptyOrder(), work_type: 'Zirconia crown', teeth: '11,21', patient_ref: 'REF-1', ...over })

describe('Wivo order v1 (docs/WIVO-ORDER-FORMAT.md)', () => {
  it('a good order has no problems', () => {
    expect(orderProblems(order(), CATALOGUE, '2026-11-27')).toEqual([])
    expect(orderProblems(order({ work_type: 'All-on-4', teeth: '', options: { framework: ['metal-bar'] } }), CATALOGUE)).toEqual([])
  })

  it('the patient is a reference only, never a record', () => {
    expect(orderProblems(order({ patient_ref: '' }))).toContain('patient_ref')
    expect(orderProblems(order({ patient_ref: 'x'.repeat(41) }))).toContain('patient_ref')
    expect(orderProblems({ ...order(), patient_name: 'Mari Maasikas' })).toContain('unknown_field')
    expect(orderProblems({ ...order(), birth_date: '1980-01-01' })).toContain('unknown_field')
  })

  it('checks the catalogue: the work type, its options, one where only one is allowed', () => {
    expect(orderProblems(order({ work_type: 'Gold tooth' }), CATALOGUE)).toContain('not_in_catalogue')
    expect(orderProblems(order({ work_type: 'All-on-4', teeth: '', options: { framework: ['titanium'] } }), CATALOGUE)).toContain('option_not_offered')
    expect(orderProblems(order({ work_type: 'All-on-4', teeth: '', options: { framework: ['metal-bar', 'peek-bar'] } }), CATALOGUE)).toContain('one_option_only')
  })

  it('teeth are FDI numbers; a due date is not in the past; the format is named', () => {
    expect(orderProblems(order({ teeth: '11, 21' }))).toContain('teeth')
    expect(orderProblems(order({ teeth: '99' }))).toContain('teeth')
    expect(orderProblems(order({ due: '2026-11-01' }), undefined, '2026-11-27')).toContain('due')
    expect(orderProblems({ ...order(), version: 2 })).toContain('format')
    expect(orderProblems(null)).toEqual(['format'])
  })
})

describe('the Network mode in the phone app', () => {
  it('lives at /network, apart from the clinic\'s own routes', () => {
    expect(isNetworkPath('/network')).toBe(true)
    expect(isNetworkPath('/network/join/abcdef123456')).toBe(true)
    expect(isNetworkPath('/networking')).toBe(false)
    expect(parseRoute('/network')).toEqual({ name: 'home' })
  })

  it('reads an invite code only in its own shape', () => {
    expect(inviteCodeOf('/network/join/abcdef123456abcdef')).toBe('abcdef123456abcdef')
    expect(inviteCodeOf('/network/join/../../x')).toBeNull()
    expect(inviteCodeOf('/network')).toBeNull()
  })

  it('talks only to a Supabase project as a clinic', () => {
    expect(validApiUrl('https://abcdefghijklmnopqrst.supabase.co')).toBe(true)
    expect(validApiUrl('https://evil.example/abcdefghijklmnopqrst.supabase.co')).toBe(false)
    expect(validApiUrl('http://abcdefghijklmnopqrst.supabase.co')).toBe(false)
  })
})
