import { describe, it, expect } from 'vitest'
import { effectiveFilter, shownFiles, typeCounts } from './fileTypeFilter'
import type { JobFileType } from './fileClean'

const files = (types: JobFileType[]) => types.map((type, i) => ({ id: String(i), type }))
const ORDER: JobFileType[] = ['scan', 'photo', 'xray', 'print', 'design', 'other', 'ct', 'project']

describe("a job's files by type", () => {
  it('a type shows only that type', () => {
    const all = files(['scan', 'design', 'scan', 'photo'])
    expect(shownFiles(all, 'scan').map(f => f.id)).toEqual(['0', '2'])
    expect(shownFiles(all, 'design').map(f => f.id)).toEqual(['1'])
  })

  it('"all" shows everything', () => {
    expect(shownFiles(files(['scan', 'design']), 'all')).toHaveLength(2)
  })

  it('a type no file has any more shows everything again, rather than an empty list', () => {
    const all = files(['scan', 'design'])
    expect(effectiveFilter('photo', all)).toBe('all')
    expect(shownFiles(all, 'photo')).toHaveLength(2)
  })

  it('counts only the types present, in the usual order', () => {
    expect(typeCounts(files(['design', 'scan', 'design', 'ct']), ORDER)).toEqual([
      { type: 'scan', count: 1 }, { type: 'design', count: 2 }, { type: 'ct', count: 1 },
    ])
    expect(typeCounts([], ORDER)).toEqual([])
  })
})
