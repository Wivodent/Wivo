/**
 * Wivo Network's legal pages and terms version (lib/legal, docs/legal/,
 * network/sql/005).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DRAFT_LINE, LEGAL_PUBLISHED, LEGAL_SOURCES, PLACEHOLDER, TERMS_VERSION, TERMS_VERSION_FORM,
  acceptedAtSignUp, legalDocOf, legalPage, needsTermsAcceptance, signUpTermsMetadata, type LegalDoc,
} from './legal'

const ROOT = join(__dirname, '../../../..')
const DOCS: LegalDoc[] = ['terms', 'privacy']

describe('the terms version', () => {
  it('has the form the database accepts, and the same rule as network/sql/005', () => {
    expect(TERMS_VERSION).toMatch(TERMS_VERSION_FORM)
    expect(TERMS_VERSION.length).toBeLessThanOrEqual(40)
    const sql = readFileSync(join(ROOT, 'network/sql/005_terms_acceptance.sql'), 'utf8')
    expect(sql).toContain(`'${TERMS_VERSION_FORM.source}'`)
  })

  it('is the version both texts name, so a bump goes with the new text', () => {
    for (const d of DOCS) expect(LEGAL_SOURCES[d], d).toContain(`Version ${TERMS_VERSION}.`)
  })
})

describe('publishing', () => {
  it('a draft carries its draft line; published texts have no draft line and no placeholder left', () => {
    for (const d of DOCS) {
      const text = LEGAL_SOURCES[d]
      if (LEGAL_PUBLISHED) {
        expect(text.match(DRAFT_LINE), `${d}: draft line`).toBeNull()
        expect(text.match(PLACEHOLDER)?.[0] ?? null, `${d}: placeholder`).toBeNull()
        expect(TERMS_VERSION, 'a published version is not a draft').not.toMatch(/draft/)
      } else {
        expect(text.match(DRAFT_LINE), `${d}: draft line`).not.toBeNull()
      }
    }
  })

  it('the page has a title and sections, and never shows the draft line itself', () => {
    for (const d of DOCS) {
      const page = legalPage(d)
      expect(page.title.length).toBeGreaterThan(5)
      expect(page.blocks.filter(b => b.kind === 'heading').length).toBeGreaterThan(5)
      expect(JSON.stringify(page.blocks)).not.toMatch(/DRAFT/)
    }
  })

  it('the placeholder rule finds the placeholders the drafts use', () => {
    expect('[COMPANY NAME]').toMatch(PLACEHOLDER)
    expect('[REG CODE], [CONTACT EMAIL]').toMatch(PLACEHOLDER)
    expect('a [link](https://x.ee)').not.toMatch(PLACEHOLDER)
  })
})

describe('the pages and the acceptance', () => {
  it('/network/terms and /network/privacy, nothing else', () => {
    expect(legalDocOf('/network/terms')).toBe('terms')
    expect(legalDocOf('/network/privacy/')).toBe('privacy')
    expect(legalDocOf('/network')).toBeNull()
    expect(legalDocOf('/network/join/abcdefabcdef')).toBeNull()
    expect(legalDocOf('/terms')).toBeNull()
  })

  it('asks an account that accepted nothing or an older version; not a Network without 005', () => {
    expect(needsTermsAcceptance({ accepted_terms_version: null })).toBe(true)
    expect(needsTermsAcceptance({ accepted_terms_version: '2020-01' })).toBe(true)
    expect(needsTermsAcceptance({ accepted_terms_version: TERMS_VERSION })).toBe(false)
    expect(needsTermsAcceptance({})).toBe(false)
    expect(needsTermsAcceptance(null)).toBe(false)
  })

  it('sign-up keeps the current version in the metadata, and only that counts', () => {
    const m = signUpTermsMetadata(new Date('2026-11-28T10:00:00Z'))
    expect(m).toEqual({ terms_version: TERMS_VERSION, terms_accepted_at: '2026-11-28T10:00:00.000Z' })
    expect(acceptedAtSignUp(m)).toBe(true)
    expect(acceptedAtSignUp({ terms_version: '2020-01' })).toBe(false)
    expect(acceptedAtSignUp(null)).toBe(false)
  })
})
