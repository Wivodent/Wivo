/**
 * Which 3D illustration belongs to which work type.
 *
 * The pictures are in src/renderer/src/assets/worktypes/3d/, named in English
 * kebab-case (crown-zirconia.webp, all-on-4.webp, titanium-mesh.webp). A clinic names its
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

/**
 * One picture per kind, from the files that exist (assets/worktypes/3d). Two
 * kinds may share one (a laminate is a veneer; inlay and onlay are one
 * picture). No picture: the line icon.
 */
export const KIND_3D_FILES: Readonly<Record<WorkKind, string | null>> = {
  implantCrown:  'crown-implant.webp',
  implantBridge: 'implant-bridge.webp',
  crown:         'crown-zirconia.webp',
  bridge:        'bridge.webp',
  veneer:        'veneer.webp',
  laminate:      'veneer.webp',
  inlay:         'inlay-onlay.webp',
  onlay:         'inlay-onlay.webp',
  filling:       'filling.webp',
  denture:       'denture-full.webp',
  allOnX:        'all-on-4.webp',
  nightGuard:    'night-guard.webp',
  retainer:      'retainer-fixed.webp',
  ibt:           null,
  surgicalGuide: 'surgical-guide.webp',
  tooth:         null,
}

/**
 * A narrower kind of work with its own picture, recognised by words among the
 * type's name and synonyms (lowercase, as substrings), in Estonian, English
 * and Russian (and the Latvian of the catalogue):
 *   any  one of these words;
 *   all  one word from each list ("individuaalne" and "abutment");
 *   not  none of these words ("Implantkroon abutmendile" is a crown, not an
 *        abutment; "Несъёмный" is fixed, not removable).
 */
export interface Variant3d {
  file: string
  any?: readonly string[]
  all?: readonly (readonly string[])[]
  not?: readonly string[]
}

const CROWN = ['kroon', 'crown', 'коронк', 'kroni', 'kroņ']
const DENTURE = ['protees', 'proteez', 'denture', 'протез', 'protēz']
const ABUTMENT = ['abutment', 'абатмент', 'abatment']
const ALL_ON_4 = ['all-on-4', 'allon4', 'all on 4', 'all-on 4']
const BAR = ['bar', 'raam', 'балк', 'sija']
const RETAINER = ['retainer', 'ретейнер', 'ретайнер']

/**
 * Narrower kinds of work, checked before the kind (KIND_3D_FILES). The first
 * whose words match and whose file exists wins, so the most specific come
 * first: "Proteesi parandus" is a repair before it is a denture, "Spordikaitse"
 * a sports guard before it is a guard. One per catalogue entry the kind alone
 * would get wrong; the rest (sild, kroon, täidis, laminaat, splint, retainer…)
 * are found by their kind.
 */
export const VARIANT_3D_FILES: readonly Variant3d[] = [
  // Full arches on implants: the number, then the bar.
  { file: 'all-on-4-bar.webp', all: [ALL_ON_4, BAR] },
  { file: 'all-on-4.webp', any: ALL_ON_4 },
  { file: 'all-on-5.webp', any: ['all-on-5', 'allon5', 'all on 5', 'all-on 5'] },
  { file: 'all-on-6.webp', any: ['all-on-6', 'allon6', 'all on 6', 'all-on 6'] },
  { file: 'hybrid-denture.webp', any: ['hübriid', 'hybriid', 'hybrid', 'гибрид', 'hibrīd'] },
  { file: 'overdenture.webp', any: ['overdenture', 'katteprot', 'покрывн', 'pārklājoš'] },
  { file: 'titanium-mesh.webp', any: ['titanium mesh', 'titanium-mesh', 'ti-mesh', 'titaanvõrk', 'titaanvork', 'титановая сетка', 'титановой сетк', 'titāna siet'] },
  // Abutments: not when the type is the crown that sits on one.
  { file: 'custom-abutment.webp', all: [ABUTMENT, ['individ', 'custom', 'индивидуальн']], not: CROWN },
  { file: 'implant-abutment.webp', any: ABUTMENT, not: CROWN },

  // Crowns and single units.
  { file: 'crown-design.webp', all: [CROWN, ['disain', 'design', 'дизайн', 'cad', 'dizain']] },
  { file: 'telescopic-crown.webp', any: ['telesk', 'telescop', 'телескоп'] },
  { file: 'post-core.webp', any: ['tihvt', 'post and core', 'post & core', 'post-core', 'культ', 'штифт', 'kultes'] },
  { file: 'crown-temporary.webp', all: [CROWN, ['ajutin', 'tempor', 'времен', 'provisor', 'pagaidu']] },
  { file: 'crown-metal-ceramic.webp', any: ['metallkeraam', 'metal-ceramic', 'metal ceramic', 'metalceramic', 'металлокерам', 'pfm', 'metālkeram'] },
  { file: 'maryland-bridge.webp', any: ['maryland', 'мэриленд', 'мериленд', 'adhesiivsild', 'adhesive bridge', 'адгезивн', 'merilend'] },

  // Dentures: repair, reline, immediate and partial before the full one.
  { file: 'denture-repair.webp', all: [DENTURE, ['parand', 'repair', 'ремонт', 'починк', 'remont']] },
  { file: 'denture-reline.webp', any: ['reline', 'rebas', 'ümbervooder', 'umbervooder', 'vooderd', 'перебаз', 'pārbāz'] },
  { file: 'denture-immediate.webp', any: ['immediaat', 'immediate', 'иммедиат', 'kohene prot', 'tūlītēj'] },
  { file: 'denture-partial.webp', any: ['osaprot', 'partial', 'частичн', 'bügel', 'bygel', 'бюгел', 'daļēj'] },
  { file: 'bite-rim.webp', any: ['hammustusvall', 'vahavall', 'bite rim', 'bite-rim', 'валик', 'veltn'] },
  { file: 'gingival-mask.webp', any: ['igemmask', 'igememask', 'igeme mask', 'gingival mask', 'gingiva mask', 'gum mask', 'десневая маска', 'smaganu mask'] },

  // Guards and appliances before the night guard.
  { file: 'sports-guard.webp', any: ['spordi', 'sport', 'спорт'] },
  { file: 'sleep-apnea.webp', any: ['apnoe', 'apnea', 'апноэ', 'norska', 'snor', 'храп', 'apnoj'] },
  { file: 'whitening-tray.webp', any: ['valgend', 'whiten', 'bleach', 'отбел', 'balinā'] },
  { file: 'aligner.webp', any: ['aligner', 'alainer', 'элайнер', 'elainer'] },
  { file: 'retainer-removable.webp', all: [RETAINER, ['eemaldat', 'removab', 'съёмн', 'съемн', 'izņem']], not: ['несъ'] },
  { file: 'retainer-fixed.webp', any: ['ретайнер'] },
  { file: 'space-maintainer.webp', any: ['ruumihoid', 'space maint', 'space-maint', 'сохранени', 'vietas uztur'] },
  { file: 'night-guard.webp', any: ['капа', 'шина', 'šina'] },

  // Models and trays: the wax-up before the model ("Vahamodelleering").
  { file: 'wax-up.webp', any: ['wax', 'vahamodel', 'vahamudel', 'восков', 'vaska model'] },
  { file: 'impression-tray.webp', any: ['lusik', 'impression', 'ложк', 'karot'] },
  { file: 'model.webp', any: ['mudel', 'model', 'модел', 'modeli'] },

  // Digital and the rest.
  { file: 'smile-design.webp', any: ['naeratus', 'smile', 'улыбк', 'smaid', 'dsd'] },
  { file: 'digital-scan.webp', any: ['skaneer', 'skann', 'scan', 'скан', 'skenē'] },
  { file: 'remake.webp', any: ['ümbertege', 'umbertege', 'remake', 'передел', 'pārtais'] },
]

/** Whether a variant's words are among a type's (lowercase) words. */
export function variantMatches(v: Variant3d, tokens: readonly string[]): boolean {
  const has = (words: readonly string[]) => words.some(w => tokens.some(tok => tok.includes(w)))
  if (v.not && has(v.not)) return false
  return (v.any ? has(v.any) : false) || (v.all ? v.all.every(has) : false)
}
