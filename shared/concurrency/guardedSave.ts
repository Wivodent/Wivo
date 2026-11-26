/**
 * Saving a row only if nobody changed it in between (2.2.3).
 *
 * The form sends only the fields this person changed, and only on condition
 * that the row's `updated_at` is still what it was when they started. When
 * somebody else saved first, the row is read again and compared with the
 * version this person started from:
 *
 *   - a field only they changed: theirs stays (it is not sent);
 *   - a field only I changed: mine is sent;
 *   - a field we both changed: a list merges item by item (merge3), when
 *     both touched different items; otherwise it is a conflict.
 *
 * With no conflict the save is tried again on the new `updated_at`. With one,
 * nothing is written and the caller shows "Someone else changed this while
 * you were editing" with the fields and a Reload.
 *
 * The database work is behind `io`, so the rule is tested with two people and
 * no database (guardedSave.test.ts).
 */
import { jsonEqual, merge3, type MergeConflict } from './merge'

export type Row = Record<string, unknown> & { updated_at?: string | null }

export interface GuardedIo<R extends Row> {
  /** Update the row with `patch` only where its updated_at is `expected`; the row written, or null when none matched. */
  write(patch: Record<string, unknown>, expected: string | null): Promise<R | null>
  /** The row as it is stored now; null when it cannot be seen (deleted, or not allowed). */
  read(): Promise<R | null>
}

export interface FieldConflict {
  field: string
  base: unknown
  mine: unknown
  theirs: unknown
  /** Inside a list or object: where both changed the same thing. */
  inside: MergeConflict[]
}

export type GuardedResult<R extends Row> =
  | { kind: 'saved'; row: R; /** Fields somebody else changed meanwhile, kept as they saved them. */ theirs: string[] }
  | { kind: 'unchanged' }
  | { kind: 'conflict'; conflicts: FieldConflict[]; current: R }

/** The fields of `next` that differ from `base` (the form's own start), as a patch. */
export function changedFields<T extends Record<string, unknown>>(base: T, next: T): Partial<T> {
  const out: Partial<T> = {}
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (!jsonEqual(base[k], next[k])) out[k] = next[k]
  }
  return out
}

/** Thrown where a caller cannot show the conflict itself (an instant save). */
export class ConflictError extends Error {
  readonly conflicts: FieldConflict[]
  readonly current: Row | null
  constructor(conflicts: FieldConflict[], current: Row | null) {
    super('conflict')
    this.name = 'ConflictError'
    this.conflicts = conflicts
    this.current = current
  }
}

export const isConflict = (e: unknown): e is ConflictError =>
  e instanceof ConflictError || (e instanceof Error && e.name === 'ConflictError')

/** The row is as it was, yet the write changed nothing: refused (42501, as describeError reads it). */
export class NotWrittenError extends Error {
  readonly code = '42501'
  constructor() { super('not written'); this.name = 'NotWrittenError' }
}

/** The row disappeared or cannot be seen any more. */
export class RowGoneError extends Error {
  constructor() { super('row gone'); this.name = 'RowGoneError' }
}

/**
 * Save `changes` over the row `base` (the row as this person last saw it, with
 * its updated_at). `mergeable` names the fields whose value is a list or an
 * object that may be merged with another person's change.
 */
export async function guardedSave<R extends Row>(
  io: GuardedIo<R>,
  base: Row,
  changes: Record<string, unknown>,
  options: { mergeable?: readonly string[]; attempts?: number } = {},
): Promise<GuardedResult<R>> {
  if (Object.keys(changes).length === 0) return { kind: 'unchanged' }
  const mergeable = new Set(options.mergeable ?? [])
  let expected = base.updated_at ?? null
  let patch = { ...changes }
  const theirs = new Set<string>()

  for (let attempt = 0; attempt < (options.attempts ?? 4); attempt++) {
    const written = await io.write(patch, expected)
    if (written) return { kind: 'saved', row: written, theirs: [...theirs] }

    const current = await io.read()
    if (!current) throw new RowGoneError()
    // Not written although nobody saved in between: the database refused it
    // (its rules, e.g. without the permission). Not somebody else's change.
    if ((current.updated_at ?? null) === expected) throw new NotWrittenError()

    for (const k of Object.keys(current)) {
      if (k !== 'updated_at' && !jsonEqual(current[k], base[k])) theirs.add(k)
    }
    const conflicts: FieldConflict[] = []
    const next: Record<string, unknown> = {}
    for (const [field, mine] of Object.entries(changes)) {
      const now = current[field]
      if (jsonEqual(now, base[field]) || jsonEqual(now, mine)) { next[field] = mine; continue }
      if (mergeable.has(field)) {
        const m = merge3(base[field], mine, now)
        if (m.conflicts.length === 0) { next[field] = m.value; continue }
        conflicts.push({ field, base: base[field], mine, theirs: now, inside: m.conflicts })
        continue
      }
      conflicts.push({ field, base: base[field], mine, theirs: now, inside: [] })
    }
    if (conflicts.length > 0) return { kind: 'conflict', conflicts, current }
    // Their save is the new start: what they changed stays, mine goes on top.
    patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => !jsonEqual(current[k], v)))
    if (Object.keys(patch).length === 0) return { kind: 'saved', row: current, theirs: [...theirs] }
    expected = current.updated_at ?? null
  }
  // Somebody keeps saving faster than this one can: say so rather than loop.
  const current = await io.read()
  if (!current) throw new RowGoneError()
  return { kind: 'conflict', conflicts: [], current }
}
