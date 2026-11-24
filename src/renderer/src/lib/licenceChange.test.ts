import { describe, expect, it } from 'vitest'
import type { LicencePayload } from '@shared/license/token'
import { licenceChangeLines } from './licenceChange'

const old: LicencePayload = {
  v: 2, name: 'Dentiks', plan: 'labor', seats: 5, iat: '2026-01-10', exp: '2027-01-10',
  org: '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f', api: ['https://fwsrnsdrlrlmjfkkkhvp.supabase.co'], modules: ['jobs', 'payroll'],
}

describe('the owner\'s "Licence updated" notice', () => {
  it('names what changed: modules, users, expiry', () => {
    const lines = licenceChangeLines({ at: '2026-11-24T10:00:00Z', from: old, to: { ...old, iat: '2026-11-24', exp: '2027-11-24', seats: null, modules: ['jobs', 'stock'] } })
    expect(lines).toEqual([
      'Lisandus: Ladu',
      'Eemaldati: Töötasud',
      'Kasutajaid: 5 → piiramatu',
      'Kehtib kuni: 2027-01-10 → 2027-11-24',
    ])
  })

  it('the same terms re-issued: says so', () => {
    expect(licenceChangeLines({ at: 'x', from: old, to: { ...old, iat: '2026-11-24' } })).toEqual(['Samad moodulid, kasutajad ja kuupäevad, uuesti väljastatud.'])
  })

  it('from no licence: "puudus" where there was nothing', () => {
    expect(licenceChangeLines({ at: 'x', from: null, to: old })).toContain('Kehtib kuni: puudus → 2027-01-10')
  })
})
