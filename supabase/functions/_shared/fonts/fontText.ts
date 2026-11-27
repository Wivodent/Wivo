/**
 * Which font an invoice PDF is set in, and its text made safe for it
 * (invoicePdf.ts). No imports beyond a type, so it is tested directly.
 *
 *  - Helvetica (WinAnsi) for an Estonian invoice with nothing outside
 *    WinAnsi: exactly as before.
 *  - The Noto Sans subset in this folder (invoiceFont.ts) for any other
 *    language, or a letter WinAnsi lacks (Latvian ā ē ī ū ģ ķ ļ ņ č).
 */
/** Whether the document has a letter WinAnsi cannot hold (Latvian, mostly). */
const NOT_WINANSI = /[^\x00-\xff€ŠšŽžŒœŸƒˆ˜‘’‚“”„†‡•…‰‹›™–—]/
export const needsUnicodeFont = (doc: { language: string }): boolean =>
  doc.language !== 'et' || NOT_WINANSI.test(JSON.stringify(doc))

/**
 * What the subset carries (scripts/invoice-font-subset.py UNICODES): Basic
 * Latin, Latin-1, Latin Extended-A and a few punctuation marks. Anything else
 * prints as "?", never as an empty box; odd dashes and the no-break space are
 * tidied first.
 */
const OUTSIDE_SUBSET = /[^\n\x20-\x7e\xa0-ſ–—‘’‚“”„•…€№]/g
export const forNotoSubset = (s: string): string =>
  (s ?? '').replace(/[‐-‒―]/g, '-').replace(/ /g, ' ').replace(OUTSIDE_SUBSET, '?')
