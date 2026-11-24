/**
 * Showing only one type of a job's files (Riga's trial, 2026-11-24: "the file
 * type filter still shows every file"). The only type control on the job's
 * files was the type for NEW uploads, which never changed the list; this is
 * the filter itself, for everyone who can see the files.
 */
import type { JobFileType } from './fileClean'

export type FileFilter = JobFileType | 'all'

/** The types present, in `order`, with how many files of each. */
export function typeCounts(files: readonly { type: JobFileType }[], order: readonly JobFileType[]): { type: JobFileType; count: number }[] {
  const n = new Map<JobFileType, number>()
  for (const f of files) n.set(f.type, (n.get(f.type) ?? 0) + 1)
  const known = order.filter(t => n.has(t)).map(type => ({ type, count: n.get(type)! }))
  const other = [...n.keys()].filter(t => !order.includes(t)).map(type => ({ type, count: n.get(type)! }))
  return [...known, ...other]
}

/** The filter in force: a type no file has any more (deleted, replaced) shows everything again. */
export function effectiveFilter(filter: FileFilter, files: readonly { type: JobFileType }[]): FileFilter {
  return filter === 'all' || files.some(f => f.type === filter) ? filter : 'all'
}

export function shownFiles<T extends { type: JobFileType }>(files: readonly T[], filter: FileFilter): T[] {
  const f = effectiveFilter(filter, files)
  return f === 'all' ? [...files] : files.filter(x => x.type === f)
}
