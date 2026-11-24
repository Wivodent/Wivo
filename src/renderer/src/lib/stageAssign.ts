/** Small pure helpers for the people on a stage (the stage bar, quick assign). */

/**
 * Two letters for a person's circle: first name's and last name's first
 * letter; from a single name its first two letters.
 */
export function initials(fullName: string | null | undefined): string {
  const words = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const chars = (w: string) => Array.from(w)
  const out = words.length >= 2
    ? chars(words[0])[0] + chars(words[words.length - 1])[0]
    : chars(words[0]).slice(0, 2).join('')
  return out.toLocaleUpperCase()
}

/** `people` with `person` added or taken away. Order kept, no duplicates. */
export function withPerson(people: readonly string[], person: string, on: boolean): string[] {
  const rest = people.filter(p => p !== person)
  return on ? [...rest, person] : rest
}

/** A person's name for the stage bar: the full name, else the username, else none (an icon, never letters). */
export function personName(p: { full_name?: string | null; username?: string | null }): string | null {
  return p.full_name?.trim() || p.username?.trim() || null
}

/** A person the stage bar can offer: `named` false draws an icon, not "UN" of "Unnamed". */
export interface StagePerson { id: string; name: string; named?: boolean }

/** Everyone in the team, for the stage bar and its picker. `unnamed` is the label of a person without a name. */
export function stagePeopleOf(
  profiles: readonly { id: string; full_name?: string | null; username?: string | null }[], unnamed: string,
): StagePerson[] {
  return profiles.map(p => {
    const name = personName(p)
    return { id: p.id, name: name ?? unnamed, named: name !== null }
  })
}

/**
 * The people a stage shows: those still in the team. Someone removed from the
 * team (or an id the team list does not have) is nobody on the stage, so a
 * stage holding only them shows "+ person", as an empty one. While the team
 * is not loaded yet (empty), every id is kept.
 */
export function stageFaces(people: readonly string[], everyone: readonly { id: string }[]): string[] {
  if (everyone.length === 0) return [...people]
  return people.filter(id => everyone.some(p => p.id === id))
}

/** Circles to draw: at most two, and how many more there are ("+N"). */
export function visiblePeople<T>(people: readonly T[]): { shown: T[]; more: number } {
  return { shown: people.slice(0, 2), more: Math.max(0, people.length - 2) }
}
