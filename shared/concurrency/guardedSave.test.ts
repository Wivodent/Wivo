/**
 * Two people, one row, no database: a fake row that keeps an updated_at and
 * refuses a write made over an older one, the way the app's update does
 * (`.eq('updated_at', expected)`).
 */
import { describe, expect, it } from 'vitest'
import { changedFields, guardedSave, NotWrittenError, RowGoneError, type GuardedIo, type Row } from './guardedSave'

function fakeRow(initial: Row) {
  let row: Row | null = { ...initial, updated_at: 't1' }
  let n = 1
  const writes: Record<string, unknown>[] = []
  const io: GuardedIo<Row> = {
    async write(patch, expected) {
      if (!row || row.updated_at !== expected) return null
      writes.push(patch)
      row = { ...row, ...patch, updated_at: `t${++n}` }
      return { ...row }
    },
    async read() { return row ? { ...row } : null },
  }
  return {
    io,
    writes,
    get row() { return row },
    /** Somebody else's save: a plain update of these fields. */
    otherSaves(patch: Record<string, unknown>) { row = { ...row!, ...patch, updated_at: `t${++n}` } },
    remove() { row = null },
    snapshot: () => ({ ...row! }),
  }
}

const job = {
  id: 'j1', status: 'disain', valmis_aeg: '2026-12-01T10:00:00+02:00', assigned_to: 'tech-a', hind: 300,
  work_items: [
    { id: 'w1', too: 'Crown', hambad: '11', valikud: { framework: { doer: null } } },
    { id: 'w2', too: 'Bridge', hambad: '21,22', materjal: 'Zirconia' },
  ],
  markused: [{ id: 'n1', tekst: 'first' }],
}
const MERGE = ['work_items', 'markused', 'revisions', 'extras', 'kulu_yle']

describe('the job form: Anna edits, Bert saves first', () => {
  it('Bert moves the stage; Anna changes the deadline: the stage is not put back', async () => {
    const db = fakeRow(job)
    const annaStart = db.snapshot()
    db.otherSaves({ status: 'valmis' })                       // Bert, on the board
    const r = await guardedSave(db.io, annaStart, { valmis_aeg: '2026-12-03T10:00:00+02:00' }, { mergeable: MERGE })
    expect(r.kind).toBe('saved')
    expect(db.row).toMatchObject({ status: 'valmis', valmis_aeg: '2026-12-03T10:00:00+02:00', assigned_to: 'tech-a' })
    if (r.kind === 'saved') expect(r.theirs).toEqual(['status'])
  })

  it('both choose a different technician: nothing is written, the field is named', async () => {
    const db = fakeRow(job)
    const annaStart = db.snapshot()
    db.otherSaves({ assigned_to: 'tech-b' })
    const r = await guardedSave(db.io, annaStart, { assigned_to: 'tech-c', hind: 320 }, { mergeable: MERGE })
    expect(r.kind).toBe('conflict')
    if (r.kind === 'conflict') {
      expect(r.conflicts.map(c => c.field)).toEqual(['assigned_to'])
      expect(r.conflicts[0]).toMatchObject({ base: 'tech-a', mine: 'tech-c', theirs: 'tech-b' })
      expect(r.current.assigned_to).toBe('tech-b')
    }
    // Not even the price: a half-saved form is worse than an unsaved one.
    expect(db.row).toMatchObject({ assigned_to: 'tech-b', hind: 300 })
  })

  it('both set the same value: no conflict', async () => {
    const db = fakeRow(job)
    const annaStart = db.snapshot()
    db.otherSaves({ hind: 350 })
    const r = await guardedSave(db.io, annaStart, { hind: 350 }, { mergeable: MERGE })
    expect(r.kind).toBe('saved')
    expect(db.row?.hind).toBe(350)
  })

  it('a doer chosen on one work item and a material changed on another: both stay', async () => {
    const db = fakeRow(job)
    const start = db.snapshot()
    const items = start.work_items as typeof job.work_items
    // Bert, in the form: the bridge's material.
    db.otherSaves({ work_items: [items[0], { ...items[1], materjal: 'E.max' }] })
    // Anna, on the read view: the crown's framework doer.
    const mine = [{ ...items[0], valikud: { framework: { doer: 'tech-d' } } }, items[1]]
    const r = await guardedSave(db.io, start, { work_items: mine }, { mergeable: MERGE })
    expect(r.kind).toBe('saved')
    expect(db.row?.work_items).toEqual([
      { ...items[0], valikud: { framework: { doer: 'tech-d' } } },
      { ...items[1], materjal: 'E.max' },
    ])
  })

  it('two notes added at the same moment: both are kept', async () => {
    const db = fakeRow(job)
    const start = db.snapshot()
    db.otherSaves({ markused: [...job.markused, { id: 'n2', tekst: 'Bert' }] })
    const r = await guardedSave(db.io, start, { markused: [...job.markused, { id: 'n3', tekst: 'Anna' }] }, { mergeable: MERGE })
    expect(r.kind).toBe('saved')
    expect((db.row?.markused as { id: string }[]).map(n => n.id)).toEqual(['n1', 'n2', 'n3'])
  })

  it('the same work item changed by both in the same field: a conflict, inside the list', async () => {
    const db = fakeRow(job)
    const start = db.snapshot()
    const items = start.work_items as typeof job.work_items
    db.otherSaves({ work_items: [{ ...items[0], hambad: '12' }, items[1]] })
    const r = await guardedSave(db.io, start, { work_items: [{ ...items[0], hambad: '13' }, items[1]] }, { mergeable: MERGE })
    expect(r.kind).toBe('conflict')
    if (r.kind === 'conflict') expect(r.conflicts[0].inside[0].path).toEqual(['w1', 'hambad'])
  })

  it('a third save lands while the second is retried: still merged, nothing lost', async () => {
    const db = fakeRow(job)
    const start = db.snapshot()
    db.otherSaves({ status: 'valmis' })
    const io: GuardedIo<Row> = {
      read: db.io.read,
      async write(patch, expected) {
        if (expected === 't2') db.otherSaves({ hind: 999 })   // Cecilia, just in between
        return db.io.write(patch, expected)
      },
    }
    const r = await guardedSave(io, start, { kirjeldus: 'Anna' })
    expect(r.kind).toBe('saved')
    expect(db.row).toMatchObject({ status: 'valmis', hind: 999, kirjeldus: 'Anna' })
  })

  it('nothing changed: nothing is written', async () => {
    const db = fakeRow(job)
    expect(await guardedSave(db.io, db.snapshot(), {})).toEqual({ kind: 'unchanged' })
    expect(db.writes).toEqual([])
  })

  it('the job was deleted meanwhile: said so, not saved', async () => {
    const db = fakeRow(job)
    const start = db.snapshot()
    db.remove()
    await expect(guardedSave(db.io, start, { hind: 1 })).rejects.toBeInstanceOf(RowGoneError)
  })
})

describe('refused, not raced', () => {
  it('the database writes nothing and nobody saved in between: no permission, not "someone else"', async () => {
    const db = fakeRow(job)
    const refusing: GuardedIo<Row> = { read: db.io.read, write: async () => null }
    const err = await guardedSave(refusing, db.snapshot(), { hind: 1 }).catch(e => e)
    expect(err).toBeInstanceOf(NotWrittenError)
    expect(err.code).toBe('42501')
  })
})

describe('a pay rule: Anna changes the amount, Bert changed the work type', () => {
  it('only the amount is sent; the work type stays Bert\'s', async () => {
    const db = fakeRow({ id: 'r1', kind: 'per_unit', amount: 20, work_type: 'Crown', option_key: null })
    const start = db.snapshot()
    db.otherSaves({ work_type: 'Crown design' })
    const r = await guardedSave(db.io, start, { amount: 25 })
    expect(r.kind).toBe('saved')
    expect(db.row).toMatchObject({ amount: 25, work_type: 'Crown design' })
    expect(db.writes.at(-1)).toEqual({ amount: 25 })
  })

  it('both change the amount: Bert\'s stays, Anna is told', async () => {
    const db = fakeRow({ id: 'r1', amount: 20 })
    const start = db.snapshot()
    db.otherSaves({ amount: 22 })
    expect((await guardedSave(db.io, start, { amount: 25 })).kind).toBe('conflict')
    expect(db.row?.amount).toBe(22)
  })
})

describe('changedFields', () => {
  it('only what differs from where the form started', () => {
    expect(changedFields(
      { a: 1, b: [1, 2], c: { d: 1 }, e: null },
      { a: 1, b: [1, 2, 3], c: { d: 1 }, e: null },
    )).toEqual({ b: [1, 2, 3] })
  })
})
