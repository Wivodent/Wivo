/**
 * Two people changing the same thing at once (2.2.3).
 *
 * A save knows three versions of a value: what it was when this person
 * started (`base`), what this person made of it (`mine`) and what is stored
 * now (`theirs`, another person's save in between). `merge3` keeps both
 * people's changes wherever they touch different parts: a different key of an
 * object, a different item of a list. Only where both changed the SAME part to
 * different values is there a conflict, and there the stored value is kept:
 * nothing anyone saved is overwritten by a copy older than it.
 *
 * Lists of objects are merged item by item when every item has an identity
 * (`id`, `key` or `nimi`, the first one all items carry, unique): work types by
 * name, options and notes by id, stages by key. Lists of plain values (machine
 * names) are merged as sets. Any other list is one value.
 *
 * Pure, JSON only. A key whose value is `undefined` counts as absent, the way
 * JSON.stringify writes it.
 */

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json }

/** One place where both people changed the same thing: the path to it, and the three values. */
export interface MergeConflict {
  /** Keys and item identities from the top, e.g. ['Crown design', 'hind']. */
  path: string[]
  base: unknown
  mine: unknown
  theirs: unknown
}

export interface MergeResult<T> {
  value: T
  conflicts: MergeConflict[]
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Structural equality of JSON values; `undefined` keys are absent, key order does not matter. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => jsonEqual(x, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a).filter(k => a[k] !== undefined)
    const kb = Object.keys(b).filter(k => b[k] !== undefined)
    if (ka.length !== kb.length) return false
    return ka.every(k => b[k] !== undefined && jsonEqual(a[k], b[k]))
  }
  // A number read back from a numeric column may come as a string ("12.50").
  if ((typeof a === 'number' && typeof b === 'string') || (typeof a === 'string' && typeof b === 'number')) {
    return a !== '' && b !== '' && Number(a) === Number(b)
  }
  return false
}

const IDENTITY_KEYS = ['id', 'key', 'nimi'] as const

/** The identity every item of all three lists carries, unique in each; null when there is none. */
function identityOf(lists: readonly unknown[][]): string | null {
  for (const k of IDENTITY_KEYS) {
    const ok = lists.every(list => {
      const seen = new Set<string>()
      return list.every(item => {
        if (!isObject(item) || typeof item[k] !== 'string' && typeof item[k] !== 'number') return false
        const v = String(item[k])
        if (seen.has(v)) return false
        seen.add(v)
        return true
      })
    })
    if (ok) return k
  }
  return null
}

const isPlain = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

function setMerge(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] {
  const has = (list: unknown[], v: unknown) => list.some(x => x === v)
  const removedByMe = base.filter(v => !has(mine, v))
  const addedByMe = mine.filter(v => !has(base, v))
  const out = theirs.filter(v => !has(removedByMe, v))
  for (const v of addedByMe) if (!has(out, v)) out.push(v)
  return out
}

function listMerge(
  base: unknown[], mine: unknown[], theirs: unknown[], key: string, path: string[], conflicts: MergeConflict[],
): unknown[] {
  const id = (item: unknown) => String((item as Record<string, unknown>)[key])
  const byId = (list: unknown[]) => new Map(list.map(item => [id(item), item]))
  const b = byId(base), m = byId(mine), th = byId(theirs)

  const merged = new Map<string, unknown>()
  const all = new Set([...b.keys(), ...m.keys(), ...th.keys()])
  for (const k of all) {
    const inB = b.has(k), inM = m.has(k), inT = th.has(k)
    if (inM && inT) {
      const r = merge3Inner(inB ? b.get(k) : undefined, m.get(k), th.get(k), [...path, k], conflicts)
      merged.set(k, r)
    } else if (inM && !inT) {
      if (!inB) merged.set(k, m.get(k))                      // added by me
      else if (!jsonEqual(m.get(k), b.get(k))) {             // I changed it, they removed it
        conflicts.push({ path: [...path, k], base: b.get(k), mine: m.get(k), theirs: undefined })
      }                                                      // else: they removed it, I did not touch it
    } else if (!inM && inT) {
      if (!inB) merged.set(k, th.get(k))                     // added by them
      else if (!jsonEqual(th.get(k), b.get(k))) {            // they changed it, I removed it: theirs kept
        conflicts.push({ path: [...path, k], base: b.get(k), mine: undefined, theirs: th.get(k) })
        merged.set(k, th.get(k))
      }                                                      // else: I removed it, they did not touch it
    }
  }

  // The order: mine where I reordered what we both have, theirs otherwise;
  // what only one side has keeps its place before its next neighbour on that
  // side, or goes last (a note added at the same moment as another: after it).
  const common = (list: unknown[]) => list.map(id).filter(k => b.has(k) && m.has(k) && th.has(k))
  const iReordered = !jsonEqual(common(mine), common(base))
  const primary = iReordered ? mine : theirs
  const secondary = iReordered ? theirs : mine
  const order = primary.map(id).filter(k => merged.has(k))
  const secIds = secondary.map(id)
  for (let i = secIds.length - 1; i >= 0; i--) {
    const k = secIds[i]
    if (!merged.has(k) || order.includes(k)) continue
    let at = order.length
    for (let j = i + 1; j < secIds.length; j++) {
      const p = order.indexOf(secIds[j])
      if (p >= 0) { at = p; break }
    }
    order.splice(at, 0, k)
  }
  return order.map(k => merged.get(k))
}

function merge3Inner(base: unknown, mine: unknown, theirs: unknown, path: string[], conflicts: MergeConflict[]): unknown {
  if (jsonEqual(mine, theirs)) return theirs
  if (jsonEqual(mine, base)) return theirs
  if (jsonEqual(theirs, base)) return mine

  if (isObject(mine) && isObject(theirs) && (base === undefined || isObject(base))) {
    const b = (base ?? {}) as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const keys = new Set([...Object.keys(theirs), ...Object.keys(mine)])
    for (const k of keys) {
      const v = merge3Inner(b[k], mine[k], theirs[k], [...path, k], conflicts)
      if (v !== undefined) out[k] = v
    }
    return out
  }

  if (Array.isArray(mine) && Array.isArray(theirs) && Array.isArray(base)) {
    if ([base, mine, theirs].every(list => list.every(isPlain))) return setMerge(base, mine, theirs)
    const key = identityOf([base, mine, theirs])
    if (key) return listMerge(base, mine, theirs, key, path, conflicts)
  }

  // Both changed the same value differently: the stored one stays.
  conflicts.push({ path, base, mine, theirs })
  return theirs
}

/** Both people's changes, item by item; where both changed the same thing, the stored value. */
export function merge3<T>(base: T, mine: T, theirs: T): MergeResult<T> {
  const conflicts: MergeConflict[] = []
  const value = merge3Inner(base, mine, theirs, [], conflicts) as T
  return { value, conflicts }
}
