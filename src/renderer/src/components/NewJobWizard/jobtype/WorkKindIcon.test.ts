/**
 * The work-type icons: every default type finds its own drawing, in every
 * language a clinic's list may be in, and every drawing stays inside its box.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORK_TYPES, defaultWorkTypesFor } from '@shared/pricing/workTypes'
import { WORK_KINDS, shapesOf, place } from './workKindShapes'
import { workKindFor } from './WorkKindIcon'

const tokensOf = (t: { nimi: string; match?: string[] }) => [t.nimi, ...(t.match ?? [])]

describe('which drawing for which type', () => {
  it.each(['et', 'en', 'ru'] as const)('the 15 default types (%s) get the 15 drawings, in order', lang => {
    const kinds = defaultWorkTypesFor(lang).map(t => workKindFor(tokensOf(t)))
    expect(kinds).toEqual(WORK_KINDS.slice(0, 15))
  })

  it('by name alone too, as a lab types it', () => {
    expect(workKindFor(['Implantaadi kroon'])).toBe('implantCrown')
    expect(workKindFor(['Zirkoonsild'])).toBe('bridge')
    expect(workKindFor(['Öökaitse'])).toBe('nightGuard')
    expect(workKindFor(['Laminate veneer'])).toBe('laminate')
    expect(workKindFor(['Kirurgiline juhik'])).toBe('surgicalGuide')
    expect(workKindFor(['All-on-4'])).toBe('allOnX')
  })

  it('anything else: the plain tooth, never a shape', () => {
    expect(workKindFor(['Disain'])).toBe('tooth')
    expect(workKindFor(['Mudel'])).toBe('tooth')
    expect(workKindFor([])).toBe('tooth')
  })
})

describe('the drawings', () => {
  const numbersOf = (d: string) => (d.match(/-?\d*\.?\d+/g) ?? []).map(Number)

  it.each([...WORK_KINDS])('%s: lines only, every point inside the 48×48 box', kind => {
    const strokes = shapesOf(kind)
    expect(strokes.length).toBeGreaterThan(0)
    for (const s of strokes) {
      if ('d' in s) {
        expect(s.d).toMatch(/^M/)
        expect(s.d).not.toMatch(/NaN|undefined/)
        for (const n of numbersOf(s.d)) expect(n >= 0 && n <= 48, `${kind}: ${n}`).toBe(true)
      } else {
        expect(s.cx - s.r).toBeGreaterThanOrEqual(0)
        expect(s.cy + s.r).toBeLessThanOrEqual(48)
      }
    }
  })

  it('place maps a 100×100 drawing into its box', () => {
    expect(place('M0 0 L100 100 C50 50 -10 20 0 0 Z', 10, 20, 20, 10)).toBe('M10 20 L30 30 C20 25 8 22 10 20 Z')
  })

  it('the default list and the drawings are the same 15, in the same order', () => {
    expect(DEFAULT_WORK_TYPES).toHaveLength(15)
    expect(WORK_KINDS).toHaveLength(16)
  })
})
