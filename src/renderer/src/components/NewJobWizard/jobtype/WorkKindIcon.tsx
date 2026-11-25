/**
 * The work-type icons of the new-job form: 15 kinds of dental work drawn as one
 * even line with round ends, no fill, in a cyan gradient (#22D3EE → #0891B2).
 * The drawings are in workKindShapes.ts; which kind a lab's type is, in
 * workKindFor below.
 *
 * The lab's list is its own (Settings → Options), so the kind is read from the
 * type's name and its synonyms, never from a fixed list of names. A type
 * nothing matches gets the plain tooth.
 */
import { useId, type SVGProps } from 'react'
import { WORK_KINDS, shapesOf, type WorkKind } from './workKindShapes'

export { WORK_KINDS, type WorkKind }

export const WORK_KIND_GRADIENT = ['#22D3EE', '#0891B2'] as const

export interface WorkKindIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  kind: WorkKind
  /** Pixel size of the square box. */
  size?: number
}

export function WorkKindIcon({ kind, size = 40, ...rest }: WorkKindIconProps): JSX.Element {
  // One gradient per icon: an id shared by two icons on a page would make the
  // second depend on the first still being there.
  const id = `wk-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      stroke={`url(#${id})`}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-kind={kind}
      {...rest}
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="10" y1="4" x2="38" y2="44">
          <stop offset="0" stopColor={WORK_KIND_GRADIENT[0]} />
          <stop offset="1" stopColor={WORK_KIND_GRADIENT[1]} />
        </linearGradient>
      </defs>
      {shapesOf(kind).map((s, i) =>
        'd' in s ? <path key={i} d={s.d} /> : <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />
      )}
    </svg>
  )
}

// ── Which kind for which type ────────────────────────────────────────────────
// The specific families before the general ones: "Implantaadisild" is an
// implant bridge, not a bridge; "Laminate veneer" is a laminate, not a veneer.
// Words in Estonian, English and Russian, as the lab may name its types in
// any of them (shared/pricing/workTypes.ts defaultWorkTypesFor).
// A surgical guide comes first: it is made for implants, so its name often
// says "implant" too ("Implant surgical guide"), and it is still a guide.
const FAMILIES: { kind: WorkKind; all?: string[][]; any?: string[] }[] = [
  { kind: 'surgicalGuide', any: ['kirurg', 'surgic', 'guide', 'juhik', 'шаблон', 'хирург'] },
  { kind: 'implantBridge', all: [['implant', 'имплант'], ['sild', 'bridge', 'мост']] },
  { kind: 'allOnX',        any: ['all-on', 'allon', 'all on', 'hübriid', 'hybrid'] },
  { kind: 'implantCrown',  any: ['implant', 'abutment', 'abutmendile', 'имплант'] },
  { kind: 'ibt',           any: ['ibt', 'bonding', 'брекет'] },
  { kind: 'retainer',      any: ['retainer', 'ретейнер', 'traat'] },
  { kind: 'nightGuard',    any: ['splint', 'kaitse', 'nightguard', 'night guard', 'öökaitse', 'ookaitse', 'lahas', 'splaad', 'guard', 'kapp', 'сплинт', 'капп'] },
  { kind: 'denture',       any: ['proteez', 'protees', 'denture', 'terve lõualuu', 'протез'] },
  { kind: 'bridge',        any: ['sild', 'bridge', 'мост'] },
  { kind: 'laminate',      any: ['laminaat', 'laminate', 'ламинат'] },
  { kind: 'veneer',        any: ['viniir', 'veneer', 'винир'] },
  { kind: 'onlay',         any: ['onlay', 'накладк'] },
  { kind: 'inlay',         any: ['inlay', 'вкладк'] },
  { kind: 'filling',       any: ['täidis', 'taidis', 'filling', 'пломб'] },
  { kind: 'crown',         any: ['kroon', 'crown', 'коронк'] },
]

/** The kind of a type, from its own name and synonyms. Anything unrecognised: the plain tooth. */
export function workKindFor(tokens: readonly string[]): WorkKind {
  const lower = tokens.map(t => t.toLowerCase())
  const has = (words: string[]) => words.some(w => lower.some(t => t.includes(w)))
  const hit = FAMILIES.find(f => (f.all ? f.all.every(has) : false) || (f.any ? has(f.any) : false))
  return hit?.kind ?? 'tooth'
}
