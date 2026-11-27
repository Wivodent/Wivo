/**
 * Wivo Network's Terms of Use and Privacy Notice (docs/legal/): their
 * version, whether they are published, and the pages /network/terms and
 * /network/privacy.
 *
 *   TERMS_VERSION   what an account accepts (network/sql/005 accept_terms).
 *                   Changing it asks every account to accept again at its
 *                   next sign-in. The form is the database's:
 *                   YYYY-MM[-word…], at most 40 characters (legal.test.ts).
 *   LEGAL_PUBLISHED false while the texts wait for the lawyer: the pages show
 *                   a "Draft" banner. Turning it on needs texts without
 *                   placeholders and without the draft line (legal.test.ts).
 *
 * The texts are English only for now (the lawyer reviews that version).
 */
import { parseNotes, type Block } from './releaseNotes'
import termsMd from '../../../../docs/legal/network-terms.md?raw'
import privacyMd from '../../../../docs/legal/network-privacy.md?raw'

export const TERMS_VERSION = '2026-11-draft'
export const LEGAL_PUBLISHED = false

/** The database's rule for a version (network/sql/005). */
export const TERMS_VERSION_FORM = /^[0-9]{4}-[0-9]{2}(-[a-z0-9]+)*$/

export type LegalDoc = 'terms' | 'privacy'

export const LEGAL_PATHS: Record<LegalDoc, string> = { terms: '/network/terms', privacy: '/network/privacy' }

export const LEGAL_SOURCES: Record<LegalDoc, string> = { terms: termsMd, privacy: privacyMd }

/** Which legal page this address is, if any. */
export function legalDocOf(pathname: string): LegalDoc | null {
  const p = pathname.replace(/\/+$/, '')
  return p === LEGAL_PATHS.terms ? 'terms' : p === LEGAL_PATHS.privacy ? 'privacy' : null
}

/** The draft line at the top of each file ("> **DRAFT – pending legal review.** …"): the page shows its own banner instead. */
export const DRAFT_LINE = /^>\s*\*\*DRAFT\b.*$/gm

/** A placeholder still to be filled in: [COMPANY NAME], [REG CODE] … */
export const PLACEHOLDER = /\[[A-Z][A-Z0-9 ,.'’()-]*\]/

/** The page's title and blocks, without the draft line. */
export function legalPage(doc: LegalDoc): { title: string; blocks: Block[] } {
  return parseNotes(LEGAL_SOURCES[doc].replace(DRAFT_LINE, ''))
}

/**
 * Whether this account still has to accept the current terms. An account read
 * from a Network without migration 005 has no such field (undefined): nothing
 * is asked until the Network has it.
 */
export function needsTermsAcceptance(account: { accepted_terms_version?: string | null } | null | undefined): boolean {
  if (!account || account.accepted_terms_version === undefined) return false
  return account.accepted_terms_version !== TERMS_VERSION
}

/** What sign-up writes into the user's metadata, before the account exists. */
export function signUpTermsMetadata(now: Date = new Date()): { terms_version: string; terms_accepted_at: string } {
  return { terms_version: TERMS_VERSION, terms_accepted_at: now.toISOString() }
}

/** Whether the sign-up already accepted the current version (the metadata above). */
export function acceptedAtSignUp(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.terms_version === TERMS_VERSION
}
