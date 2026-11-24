/** The generated copies under _shared/generated/ match their source in shared/. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { COPIES, header } from '../../../scripts/copy-shared-to-functions.mjs'

const root = join(__dirname, '..', '..', '..')
// A Windows checkout (core.autocrlf) may give either file CRLF; git stores both with LF.
const read = (p: string) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n')

describe('generated copies', () => {
  for (const [from, to] of COPIES as [string, string][]) {
    it(`${to} is ${from} — if not: node scripts/copy-shared-to-functions.mjs`, () => {
      expect(read(to)).toBe(header(from) + read(from))
    })
  }
})
