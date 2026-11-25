/**
 * Which 3D illustration belongs to which work type.
 *
 * The pictures are in src/renderer/src/assets/worktypes/3d/, named in English
 * kebab-case (crown.png, all-on-4.png, titanium-mesh.png). A clinic names its
 * types in its own language and renames them at will, so the picture is never
 * found from the name the way the old photos were (workTypeImages.ts). It is
 * found from what the type IS:
 *
 *  1. a VARIANT: a narrower kind of work that can have its own picture
 *     (All-on-4 inside All-on-X, a titanium mesh), recognised by words in
 *     Estonian, English and Russian among the type's name and synonyms;
 *  2. otherwise its KIND, the same one the line icon is drawn for
 *     (workKindFor in WorkKindIcon.tsx), which already reads all three
 *     languages.
 *
 * A file that is not in the folder is skipped, so a variant without its own
 * picture falls back to its kind's, and a kind without one to the line icon.
 * Adding a picture is dropping the file in; adding a variant is one line here.
 */
import type { WorkKind } from '../components/NewJobWizard/jobtype/workKindShapes'

/** One picture per kind. The plain tooth (anything unrecognised) has none. */
export const KIND_3D_FILES: Readonly<Record<WorkKind, string | null>> = {
  implantCrown:  'implant-crown.png',
  implantBridge: 'implant-bridge.png',
  crown:         'crown.png',
  bridge:        'bridge.png',
  veneer:        'veneer.png',
  laminate:      'laminate.png',
  inlay:         'inlay.png',
  onlay:         'onlay.png',
  filling:       'filling.png',
  denture:       'denture.png',
  allOnX:        'all-on-x.png',
  nightGuard:    'night-guard.png',
  retainer:      'retainer.png',
  ibt:           'ibt.png',
  surgicalGuide: 'surgical-guide.png',
  tooth:         null,
}

/**
 * Narrower kinds of work, checked before the kind. The first whose words
 * appear in the type's name or synonyms (lowercase, as a substring) and whose
 * file exists wins. Most specific first.
 */
export const VARIANT_3D_FILES: readonly { file: string; words: readonly string[] }[] = [
  { file: 'all-on-4.png', words: ['all-on-4', 'allon4', 'all on 4', 'all-on 4'] },
  { file: 'all-on-6.png', words: ['all-on-6', 'allon6', 'all on 6', 'all-on 6'] },
  { file: 'titanium-mesh.png', words: ['titanium mesh', 'titanium-mesh', 'ti-mesh', 'titaanvõrk', 'titaanvork', 'титановая сетка', 'титановой сетк'] },
]
