/**
 * The 3D illustration of a work type, or null: see workType3dMap.ts for which
 * file belongs to which type.
 *
 * Bundled at build time through import.meta.glob, like the photos in
 * workTypeImages.ts: the app works offline and from a packaged .asar. A new
 * picture needs a rebuild (a save in dev).
 */
import type { WorkType } from '@shared/pricing/workTypes'
import { workKindFor } from '../components/NewJobWizard/jobtype/WorkKindIcon'
import { WORK_KINDS, type WorkKind } from '../components/NewJobWizard/jobtype/workKindShapes'
import { KIND_3D_FILES, VARIANT_3D_FILES, variantMatches } from './workType3dMap'
import { CATALOGUE, entryWords } from '@shared/pricing/workTypeCatalogue'

const modules = import.meta.glob(
  '../assets/worktypes/3d/*.{png,jpg,jpeg,webp,svg,PNG,JPG,JPEG,WEBP,SVG}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

/** Lowercase file name → bundled URL. */
const urlByFile = new Map<string, string>(
  Object.entries(modules).map(([path, url]) => [(path.split('/').pop() ?? '').toLowerCase(), url])
)

type TypeLike = Pick<WorkType, 'nimi' | 'match'> & Partial<Pick<WorkType, 'katalog' | 'pildiValik'>>

/** A type's own name and synonyms, lowercase: the words the matching reads. */
export const workTypeTokens = (type: TypeLike): string[] =>
  [type.nimi, ...(type.match ?? [])].map(w => w.toLowerCase())

// ── The owner's own choice (Settings → Prices, work_types[].pildiValik) ──────

/** A line icon chosen in place of a picture is stored as `icon:<kind>`. */
export const ICON_CHOICE = 'icon:'

/** What the owner chose: a 3D picture (its file), or a line icon (its kind). Anything else: automatic. */
export type PictureChoice = { file: string } | { kind: WorkKind }

export function pictureChoice(value: unknown): PictureChoice | null {
  if (typeof value !== 'string') return null
  if (value.startsWith(ICON_CHOICE)) {
    const kind = value.slice(ICON_CHOICE.length) as WorkKind
    return WORK_KINDS.includes(kind) ? { kind } : null
  }
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) ? { file: `${value}.webp` } : null
}

/** The stored value for a choice: a 3D picture's id (its file without .webp), or `icon:<kind>`. */
export const choiceValue = (c: PictureChoice): string =>
  'kind' in c ? `${ICON_CHOICE}${c.kind}` : c.file.replace(/\.webp$/, '')

// ── Phrases: several words, before any single word ───────────────────────────

/**
 * Every name of several words that means one picture: the catalogue's names in
 * all four languages ("Surgical guide", "Дизайн улыбки"; "Crown design (CAD)"
 * also as "crown design"; "Inlay / onlay" as each half) and the variants'
 * phrases ("titanium mesh", "post and core"). Longest first, so the most
 * precise wins: "implant surgical guide" is a surgical guide, not an implant;
 * "smile design" a smile design, not a design.
 */
export const PHRASES: readonly { phrase: string; file: string }[] = (() => {
  const out = new Map<string, string>()
  const add = (phrase: string, file: string) => {
    const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim()
    if (/[\s-]/.test(p) && p.length >= 5 && !out.has(p)) out.set(p, file)
  }
  for (const e of CATALOGUE) {
    for (const name of entryWords(e)) {
      for (const part of name.split(' / ')) {
        add(part, `${e.id}.webp`)
        add(part.replace(/\s*\([^)]*\)\s*/g, ' '), `${e.id}.webp`)
      }
    }
  }
  for (const v of VARIANT_3D_FILES) if (!v.not) for (const w of v.any ?? []) add(w, v.file)
  return [...out].map(([phrase, file]) => ({ phrase, file })).sort((a, b) => b.phrase.length - a.phrase.length)
})()

const LETTER = /[\p{L}\p{N}]/u

/** Does `phrase` start a word in `text`? ("Несъёмный ретейнер" does not hold "съёмный ретейнер".) */
function startsWordIn(text: string, phrase: string): boolean {
  for (let at = text.indexOf(phrase); at >= 0; at = text.indexOf(phrase, at + 1)) {
    if (at === 0 || !LETTER.test(text[at - 1])) return true
  }
  return false
}

/** The picture the words name precisely, or null: a catalogue name, a phrase, a narrower kind. Never a kind. */
function preciseFileIn(tokens: readonly string[], has: (file: string) => boolean): string | null {
  // Named exactly as a catalogue entry is, in any of its languages ("Metallkeraamiline kroon").
  const named = CATALOGUE.find(e => has(`${e.id}.webp`) && entryWords(e).some(w => tokens.includes(w)))
  if (named) return `${named.id}.webp`
  // A phrase of several words inside the name ("implant surgical guide").
  const phrase = PHRASES.find(p => has(p.file) && tokens.some(tok => startsWordIn(tok, p.phrase)))
  if (phrase) return phrase.file
  // A narrower kind by its words ("Proteesi parandus", "Spordikaitse").
  return VARIANT_3D_FILES.find(v => has(v.file) && variantMatches(v, tokens))?.file ?? null
}

/** The kind a type is: the owner's line icon if chosen, else read from its name first, then its synonyms. */
export function workTypeKind(type: TypeLike): WorkKind {
  const choice = pictureChoice(type.pildiValik)
  if (choice && 'kind' in choice) return choice.kind
  const name = [type.nimi.toLowerCase()]
  const own = workKindFor(name)
  // A name that says precisely what it is ("smile design") is not read from
  // synonyms it kept from before a rename ("implant bridge").
  if (own !== 'tooth' || preciseFileIn(name, () => true)) return own
  return workKindFor(workTypeTokens(type))
}

/**
 * The file for a type, given which files exist. Pure, so the mapping is
 * tested without any picture in the folder.
 *
 * The type's OWN NAME is read before its synonyms: a type renamed from
 * "Implantaadisild" to "smile design" keeps "implant bridge" among its
 * synonyms, and that must not decide its picture.
 */
export function workType3dFileIn(type: TypeLike, has: (file: string) => boolean): string | null {
  // 0. The owner's own choice: that picture, or no picture (a line icon).
  const choice = pictureChoice(type.pildiValik)
  if (choice && 'kind' in choice) return null
  if (choice && has(choice.file)) return choice.file
  // 1. Added from the catalogue: that entry's picture, whatever the name.
  if (type.katalog && has(`${type.katalog}.webp`)) return `${type.katalog}.webp`
  // 2. What the name says precisely, then what the synonyms do.
  const name = [type.nimi.toLowerCase()]
  const precise = preciseFileIn(name, has) ?? preciseFileIn(workTypeTokens(type), has)
  if (precise) return precise
  // 3. Its kind, the same one the line icon is drawn for.
  return kind3dFileIn(workTypeKind(type), has)
}

export function kind3dFileIn(kind: WorkKind, has: (file: string) => boolean): string | null {
  const file = KIND_3D_FILES[kind]
  return file && has(file) ? file : null
}

const hasFile = (file: string): boolean => urlByFile.has(file.toLowerCase())

/** The bundled 3D picture of a work type, or null when there is none. */
export function workType3dImage(type: TypeLike): string | null {
  const file = workType3dFileIn(type, hasFile)
  return file ? urlByFile.get(file.toLowerCase()) ?? null : null
}

/** Every 3D picture of a work type there is, for the owner to choose from: its id (file name without .webp) and URL. */
export function all3dPictures(): { id: string; url: string }[] {
  return [...urlByFile].filter(([file]) => file.endsWith('.webp')).map(([file, url]) => ({ id: file.replace(/\.webp$/, ''), url }))
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** The bundled 3D picture of a kind (empty pages pick a kind, not a type). */
export function kind3dImage(kind: WorkKind): string | null {
  const file = kind3dFileIn(kind, hasFile)
  return file ? urlByFile.get(file.toLowerCase()) ?? null : null
}
