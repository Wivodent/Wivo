/**
 * The options chosen on a job and who makes each (sql/130): pure helpers for
 * components/JobDetail/OptionDoers.tsx.
 */
import type { WorkItem } from '../types/job'

export interface ChosenOption {
  itemId: string
  too: string
  optionId: string
  name: string
  doer: string | null
}

/** Every option chosen on a job's work items, in order, with its doer (null: the technician). */
export function chosenOptions(items: readonly WorkItem[], names: ReadonlyMap<string, string>): ChosenOption[] {
  return items.flatMap(i => Object.values(i.valikud ?? {}).flat().map(optionId => ({
    itemId: i.id,
    too: i.too,
    optionId,
    name: names.get(optionId) ?? optionId,
    doer: i.valikuTegijad?.[optionId] || null,
  })))
}

/** A job's work items with one option's doer set (null: back to the technician). */
export function withOptionDoer(items: readonly WorkItem[], itemId: string, optionId: string, doer: string | null): WorkItem[] {
  return items.map(i => {
    if (i.id !== itemId) return i
    const next = { ...(i.valikuTegijad ?? {}) }
    if (doer) next[optionId] = doer
    else delete next[optionId]
    const { valikuTegijad: _old, ...rest } = i
    return Object.keys(next).length > 0 ? { ...rest, valikuTegijad: next } : rest
  })
}
