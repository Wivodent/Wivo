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
import type { WorkKind } from '../components/NewJobWizard/jobtype/workKindShapes'
import { KIND_3D_FILES, VARIANT_3D_FILES } from './workType3dMap'

const modules = import.meta.glob(
  '../assets/worktypes/3d/*.{png,jpg,jpeg,webp,svg,PNG,JPG,JPEG,WEBP,SVG}',
  { eager: true, query: '?url', import: 'default' }
) as Record<string, string>

/** Lowercase file name → bundled URL. */
const urlByFile = new Map<string, string>(
  Object.entries(modules).map(([path, url]) => [(path.split('/').pop() ?? '').toLowerCase(), url])
)

type TypeLike = Pick<WorkType, 'nimi' | 'match'>

/** A type's own name and synonyms, lowercase: the words the matching reads. */
export const workTypeTokens = (type: TypeLike): string[] =>
  [type.nimi, ...(type.match ?? [])].map(w => w.toLowerCase())

/**
 * The file for a type, given which files exist. Pure, so the mapping is
 * tested without any picture in the folder.
 */
export function workType3dFileIn(type: TypeLike, has: (file: string) => boolean): string | null {
  const tokens = workTypeTokens(type)
  const variant = VARIANT_3D_FILES.find(v =>
    has(v.file) && v.words.some(w => tokens.some(tok => tok.includes(w))))
  if (variant) return variant.file
  return kind3dFileIn(workKindFor(tokens), has)
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

/** The bundled 3D picture of a kind (empty pages pick a kind, not a type). */
export function kind3dImage(kind: WorkKind): string | null {
  const file = kind3dFileIn(kind, hasFile)
  return file ? urlByFile.get(file.toLowerCase()) ?? null : null
}
