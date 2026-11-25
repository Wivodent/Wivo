/**
 * Work type options (docs/WORKTYPE-OPTIONS-PLAN.md, first version): the
 * variants a piece of work comes in, such as an All-on-4 on a metal bar or on
 * a titanium mesh.
 *
 * ONE LIBRARY. An option ("Metal bar") is defined once for the clinic, with
 * its extra price and its cost, and any number of work types use it through
 * their option groups ("Framework: Metal bar, Titanium mesh"). Changing the
 * price of the metal bar changes it for every type that offers it.
 *
 * Where it lives, all jsonb, so no migration:
 *   the library     clinic_settings.pricing.tooValikud   (WorkOption[])
 *   a type's groups clinic_settings.work_types[].valikuGrupid
 *   a job's choice  jobs.work_items[].valikud  { [group key]: option ids }
 *
 * Ids, never names, are stored: renaming "Metal bar" to "Metal frame" must not
 * orphan the jobs that chose it. An option a job used is archived, not deleted,
 * so old jobs still read and price.
 *
 * An option's id is English kebab-case and is also its picture's file name:
 * assets/worktypes/3d/options/<id>.webp. Not yet in this version: stages and
 * pay rules that depend on an option (docs/ROADMAP.md).
 */
import type { PriceMode } from './workTypes'
import { toothCount } from './teeth'

export interface WorkOption {
  /** Stable, English kebab-case ('metal-bar'): what a job stores, and the picture's name. */
  id: string
  /** The label, in the clinic's language. */
  nimi: string
  /** Extra on the client's price, per job or per tooth (`yhik`). */
  lisahind?: number
  /** What it costs us, per job or per tooth (`yhik`). */
  kulu?: number
  /** Both amounts are per job ('too', the default) or per tooth ('hammas'). */
  yhik?: PriceMode
  /** No longer offered on new jobs; kept for the jobs that chose it. */
  arhiivis?: boolean
}

export interface WorkOptionGroup {
  /** Stable, never shown ('framework'). What a job's choice is keyed by. */
  key: string
  /** "Framework" */
  nimi: string
  /** false: pick one (or none). true: pick any. */
  mitu: boolean
  /** Option ids from the library, in the order they are offered. */
  valikud: string[]
}

/** A work item's choice: group key → the chosen option ids. */
export type ItemOptions = Record<string, string[]>

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** English kebab-case from a name: "Metal bar" → "metal-bar", "Titaanvõrk" → "titaanvork". */
export function kebab(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * A new, unused id or key from a name. A name with no Latin letters at all
 * (Cyrillic) gets `<fallback>-N`. Made once, when the thing is created; a
 * rename never changes it.
 */
export function newId(name: string, taken: Iterable<string>, fallback = 'option'): string {
  const used = new Set(taken)
  const k = kebab(name)
  if (k && !used.has(k)) return k
  const base = k || fallback
  for (let i = k ? 2 : 1; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`
}

/** The library as stored, cleaned: jsonb can be edited by hand. */
export function normaliseOptions(raw: unknown): WorkOption[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.flatMap((x): WorkOption[] => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    const nimi = typeof o.nimi === 'string' ? o.nimi.trim() : ''
    if (!id || !nimi || seen.has(id)) return []
    seen.add(id)
    return [{
      id,
      nimi,
      lisahind: num(o.lisahind),
      kulu: num(o.kulu),
      yhik: o.yhik === 'hammas' ? 'hammas' : 'too',
      ...(o.arhiivis === true ? { arhiivis: true } : {}),
    }]
  })
}

/** A work type's groups as stored, cleaned. Undefined when it has none. */
export function normaliseGroups(raw: unknown): WorkOptionGroup[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const groups = raw.flatMap((x): WorkOptionGroup[] => {
    if (!x || typeof x !== 'object') return []
    const g = x as Record<string, unknown>
    const key = typeof g.key === 'string' ? g.key.trim() : ''
    if (!key || seen.has(key)) return []
    seen.add(key)
    const ids = Array.isArray(g.valikud) ? g.valikud.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []
    return [{ key, nimi: typeof g.nimi === 'string' ? g.nimi : '', mitu: g.mitu === true, valikud: [...new Set(ids)] }]
  })
  return groups.length > 0 ? groups : undefined
}

/**
 * A choice kept to what the type offers: only its groups, only options in
 * them, and one at most in a pick-one group. What the new-job form writes.
 */
export function cleanChoice(groups: readonly WorkOptionGroup[] | undefined, choice: ItemOptions | undefined): ItemOptions | undefined {
  if (!groups || !choice) return undefined
  const out: ItemOptions = {}
  for (const g of groups) {
    const picked = (choice[g.key] ?? []).filter(id => g.valikud.includes(id))
    const kept = g.mitu ? [...new Set(picked)] : picked.slice(0, 1)
    if (kept.length > 0) out[g.key] = kept
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export interface OptionLine {
  id: string
  nimi: string
  /** Extra on the client's price for this item. */
  price: number
  /** Our cost for this item. */
  cost: number
}

const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * What one work item's chosen options add: each one's extra price and cost,
 * per job or times the item's teeth. An id the library does not have (deleted
 * by hand) adds nothing. Archived options still count: an old job keeps its
 * price.
 */
export function optionLines(
  item: { hambad?: string | null; valikud?: ItemOptions | null },
  library: readonly WorkOption[] | undefined,
): OptionLine[] {
  if (!item.valikud || !library?.length) return []
  const byId = new Map(library.map(o => [o.id, o]))
  const teeth = toothCount(item.hambad ?? '')
  const lines: OptionLine[] = []
  for (const ids of Object.values(item.valikud)) {
    for (const id of ids ?? []) {
      const o = byId.get(id)
      if (!o) continue
      const times = o.yhik === 'hammas' ? teeth : 1
      lines.push({ id, nimi: o.nimi, price: round2((o.lisahind ?? 0) * times), cost: round2((o.kulu ?? 0) * times) })
    }
  }
  return lines
}

/** The extra price and the cost of one item's options. */
export function optionTotals(
  item: { hambad?: string | null; valikud?: ItemOptions | null },
  library: readonly WorkOption[] | undefined,
): { price: number; cost: number } {
  const lines = optionLines(item, library)
  return {
    price: round2(lines.reduce((s, l) => s + l.price, 0)),
    cost: round2(lines.reduce((s, l) => s + l.cost, 0)),
  }
}

/**
 * A job's work for one line of text, such as an invoice line: each type once,
 * in order, with the options chosen for it ("All-on-4 (Metal bar) + Kroon").
 */
export function workWithOptionsLabel(
  items: readonly { too?: string | null; valikud?: ItemOptions | null }[],
  library: readonly WorkOption[] | undefined,
): string {
  const byType = new Map<string, string[]>()
  for (const item of items) {
    const too = item.too?.trim()
    if (!too) continue
    const names = byType.get(too) ?? []
    for (const n of chosenOptionNames(item.valikud, library)) if (!names.includes(n)) names.push(n)
    byType.set(too, names)
  }
  return [...byType].map(([too, names]) => (names.length > 0 ? `${too} (${names.join(', ')})` : too)).join(' + ')
}

/** The names of an item's chosen options, for a card or a list ("Metal bar"). */
export function chosenOptionNames(valikud: ItemOptions | null | undefined, library: readonly WorkOption[] | undefined): string[] {
  if (!valikud || !library?.length) return []
  const byId = new Map(library.map(o => [o.id, o.nimi]))
  return Object.values(valikud).flat().map(id => byId.get(id)).filter((n): n is string => !!n)
}
