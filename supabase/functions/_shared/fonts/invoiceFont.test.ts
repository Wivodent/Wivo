/**
 * The invoice PDF's font travels with the functions (send-invoice,
 * send-invoices): Noto Sans cut to Latin, Latin-1 and Latin Extended-A.
 * Nothing is fetched while sending; the module the functions import is the
 * same bytes as the .ttf files beside it; every Estonian, Latvian and
 * Lithuanian letter is in both weights; it stays small.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NOTO_SANS_REGULAR_B64, NOTO_SANS_BOLD_B64 } from './invoiceFont'
import { needsUnicodeFont, forNotoSubset } from './fontText'

const here = __dirname
const ttf = (name: string) => new Uint8Array(readFileSync(join(here, name)))
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

/** The code points a TrueType font's cmap maps (formats 4 and 12, Windows Unicode). */
function cmapCodePoints(font: Uint8Array): Set<number> {
  const v = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const tables = v.getUint16(4)
  let cmap = -1
  for (let i = 0; i < tables; i++) {
    const rec = 12 + i * 16
    if (String.fromCharCode(...font.subarray(rec, rec + 4)) === 'cmap') cmap = v.getUint32(rec + 8)
  }
  if (cmap < 0) throw new Error('no cmap')
  const out = new Set<number>()
  const n = v.getUint16(cmap + 2)
  for (let i = 0; i < n; i++) {
    const platform = v.getUint16(cmap + 4 + i * 8)
    const off = cmap + v.getUint32(cmap + 4 + i * 8 + 4)
    if (platform !== 3 && platform !== 0) continue
    const format = v.getUint16(off)
    if (format === 4) {
      const segX2 = v.getUint16(off + 6)
      const ends = off + 14, starts = ends + segX2 + 2
      for (let s = 0; s < segX2 / 2; s++) {
        const end = v.getUint16(ends + s * 2), start = v.getUint16(starts + s * 2)
        for (let c = start; c <= end && c !== 0xffff; c++) out.add(c)
      }
    } else if (format === 12) {
      const groups = v.getUint32(off + 12)
      for (let g = 0; g < groups; g++) {
        const start = v.getUint32(off + 16 + g * 12), end = v.getUint32(off + 20 + g * 12)
        for (let c = start; c <= end; c++) out.add(c)
      }
    }
  }
  return out
}

const LETTERS = 'AaZz09€–—„“”‘’…•õäöüÕÄÖÜšžŠŽāčēģīķļņūĀČĒĢĪĶĻŅŪąęėįųĄĘĖĮŲ'

describe('the invoice PDF’s font, carried with the functions', () => {
  it('the module the functions import is exactly the .ttf files beside it', () => {
    expect(b64(NOTO_SANS_REGULAR_B64)).toEqual(ttf('NotoSans-Regular-invoice.ttf'))
    expect(b64(NOTO_SANS_BOLD_B64)).toEqual(ttf('NotoSans-Bold-invoice.ttf'))
  })

  it('every Estonian, Latvian and Lithuanian letter (and €) is in both weights', () => {
    for (const name of ['NotoSans-Regular-invoice.ttf', 'NotoSans-Bold-invoice.ttf']) {
      const have = cmapCodePoints(ttf(name))
      const missing = [...LETTERS].filter(c => !have.has(c.codePointAt(0)!))
      expect(missing, name).toEqual([])
    }
  })

  it('small: a subset, not the whole font, and the licence goes with it', () => {
    for (const name of ['NotoSans-Regular-invoice.ttf', 'NotoSans-Bold-invoice.ttf']) expect(ttf(name).length).toBeLessThan(40_000)
    expect(readFileSync(join(here, 'invoiceFont.ts'), 'utf8').length).toBeLessThan(100_000)
    expect(readFileSync(join(here, 'OFL.txt'), 'utf8')).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it('nothing is fetched while sending: no font address anywhere in the PDF code', () => {
    const pdf = readFileSync(join(here, '..', 'invoicePdf.ts'), 'utf8')
    expect(pdf).not.toMatch(/jsdelivr|fonts\.g|fetch\(/)
    expect(pdf).toContain("from './fonts/invoiceFont.ts'")
  })

  it('the PDF’s header and totals hold longer labels (Latvian) without overlapping', () => {
    const pdf = readFileSync(join(here, '..', 'invoicePdf.ts'), 'utf8')
    // A value after its label: where it always stood, further right only for a longer label.
    expect(pdf).toContain('const after = (label: string, at: number) => M + Math.max(at, font.widthOfTextAtSize(prep(label), 10) + 8)')
    expect(pdf).toContain('text(doc.dueDate, after(L.dueDate, 75), 10, bold)')
    expect(pdf).toContain('if (doc.serviceDate) {')
    // The rule above the total sits under the VAT row, not through it.
    expect(pdf).toContain('start: { x: tl, y: y + 7 }, end: { x: M + W, y: y + 7 },')
  })

  it('which font, and the text made safe for the subset', () => {
    expect(needsUnicodeFont({ language: 'et', number: '2026-0001', note: 'Tänan' })).toBe(false)
    expect(needsUnicodeFont({ language: 'et', note: 'Rīga' })).toBe(true)
    expect(needsUnicodeFont({ language: 'lv' })).toBe(true)
    expect(forNotoSubset('Rēķins Nr. 1 — Brīvības iela')).toBe('Rēķins Nr. 1 — Brīvības iela')
    expect(forNotoSubset('Иван Petrov‑x')).toBe('???? Petrov-x')
  })
})
