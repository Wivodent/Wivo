/**
 * Two owners' machines on one clinic_settings row (2.2.3), no database: a
 * fake row with an updated_at that refuses a write over an older one, as
 * writeClinicSettingsIf does, and each machine's screen as a plain object.
 */
import { describe, expect, it } from 'vitest'
import { SettingsSync, type Columns, type SettingsRowSnapshot, type UnsentStore } from './settingsSync'

const types = [
  { nimi: 'Crown', hex: '#1', hind: 100 },
  { nimi: 'Bridge', hex: '#2', hind: 200 },
  { nimi: 'Crown design', hex: '#3', hind: 30 },
]

function server(values: Columns) {
  let row: SettingsRowSnapshot = { values: structuredClone(values), updatedAt: 't1' }
  let n = 1
  let online = true
  return {
    get row() { return row },
    setOnline(v: boolean) { online = v },
    io: {
      fetch: async () => {
        if (!online) throw new Error('offline')
        return structuredClone(row)
      },
      write: async (patch: Columns, expected: string | null) => {
        if (!online) throw new Error('offline')
        if (row.updatedAt !== expected) return null
        row = { values: { ...row.values, ...structuredClone(patch) }, updatedAt: `t${++n}` }
        return row.updatedAt
      },
    },
  }
}

/** One machine: its screen, and the engine on it. */
function machine(srv: ReturnType<typeof server>, unsent?: UnsentStore) {
  const screen: Columns = {}
  const conflicts: string[][] = []
  const engine = new SettingsSync(srv.io, {
    get: col => structuredClone(screen[col]),
    apply: values => { Object.assign(screen, structuredClone(values)) },
  }, { onConflict: c => conflicts.push(c.flatMap(x => x.conflicts.map(y => [x.column, ...y.path].join('/')))), unsent })
  return {
    screen, engine, conflicts,
    async open() { engine.start((await srv.io.fetch())!) },
    /** Change a work type's field on this screen and save. */
    async edit(nimi: string, patch: Record<string, unknown>) {
      screen.work_types = (screen.work_types as typeof types).map(x => (x.nimi === nimi ? { ...x, ...patch } : x))
      engine.markDirty(['work_types'])
      return engine.flush()
    },
    /** A change from elsewhere arrives (realtime). */
    async hear() { engine.remote((await srv.io.fetch())!) },
  }
}

const memoryStore = (): UnsentStore & { value: ReturnType<UnsentStore['read']> } => {
  const s = { value: null as ReturnType<UnsentStore['read']>, read: () => s.value, write: (v: ReturnType<UnsentStore['read']>) => { s.value = v ? structuredClone(v) : null } }
  return s
}

describe('two owners change work types at once', () => {
  it('different work types: both prices are saved, on both screens', async () => {
    const srv = server({ work_types: types, pricing: { designFee: 10 } })
    const anna = machine(srv), bert = machine(srv)
    await anna.open(); await bert.open()

    expect(await anna.edit('Crown', { hind: 110 })).toBe('saved')
    // Bert has not heard of it yet and changes another type.
    expect(await bert.edit('Crown design', { hind: 35 })).toBe('saved')

    const stored = srv.row.values.work_types as typeof types
    expect(stored.map(x => x.hind)).toEqual([110, 200, 35])
    expect((bert.screen.work_types as typeof types).map(x => x.hind)).toEqual([110, 200, 35])
    await anna.hear()
    expect((anna.screen.work_types as typeof types).map(x => x.hind)).toEqual([110, 200, 35])
    expect([...anna.conflicts, ...bert.conflicts]).toEqual([])
  })

  it('the same price: the first save stays, the second owner is told which', async () => {
    const srv = server({ work_types: types })
    const anna = machine(srv), bert = machine(srv)
    await anna.open(); await bert.open()
    await anna.edit('Crown', { hind: 110 })
    await bert.edit('Crown', { hind: 120, hex: '#9' })
    const crown = (srv.row.values.work_types as typeof types)[0]
    expect(crown).toEqual({ nimi: 'Crown', hex: '#9', hind: 110 })   // Bert's colour, Anna's price
    expect(bert.conflicts).toEqual([['work_types/Crown/hind']])
    expect((bert.screen.work_types as typeof types)[0].hind).toBe(110)
  })

  it('a change heard while typing is merged into the screen, not over it', async () => {
    const srv = server({ work_types: types })
    const anna = machine(srv), bert = machine(srv)
    await anna.open(); await bert.open()
    // Anna types (not saved yet: the 400 ms wait).
    anna.screen.work_types = (anna.screen.work_types as typeof types).map(x => x.nimi === 'Bridge' ? { ...x, hind: 210 } : x)
    anna.engine.markDirty(['work_types'])
    await bert.edit('Crown', { hind: 95 })
    await anna.hear()
    expect((anna.screen.work_types as typeof types).map(x => x.hind)).toEqual([95, 210, 30])
    expect(await anna.engine.flush()).toBe('saved')
    expect((srv.row.values.work_types as typeof types).map(x => x.hind)).toEqual([95, 210, 30])
  })

  it('its own save coming back by realtime changes nothing (no two-second blind spot)', async () => {
    const srv = server({ work_types: types })
    const anna = machine(srv)
    await anna.open()
    await anna.edit('Crown', { hind: 111 })
    anna.screen.work_types = (anna.screen.work_types as typeof types).map(x => x.nimi === 'Bridge' ? { ...x, hind: 222 } : x)
    anna.engine.markDirty(['work_types'])
    await anna.hear()   // the echo of the first save
    expect((anna.screen.work_types as typeof types).map(x => x.hind)).toEqual([111, 222, 30])
  })

  it('another column changed elsewhere is taken whole; this one stays', async () => {
    const srv = server({ work_types: types, pricing: { designFee: 10, kmMaar: 24 } })
    const anna = machine(srv), bert = machine(srv)
    await anna.open(); await bert.open()
    bert.screen.pricing = { designFee: 15, kmMaar: 24 }
    bert.engine.markDirty(['pricing'])
    await bert.engine.flush()
    await anna.edit('Crown', { hind: 105 })
    expect(srv.row.values).toEqual({
      work_types: [{ ...types[0], hind: 105 }, types[1], types[2]],
      pricing: { designFee: 15, kmMaar: 24 },
    })
    expect(anna.screen.pricing).toEqual({ designFee: 15, kmMaar: 24 })
  })
})

describe('a save without a connection is not lost', () => {
  it('kept, tried again, and merged with what changed meanwhile', async () => {
    const srv = server({ work_types: types })
    const anna = machine(srv), bert = machine(srv)
    await anna.open(); await bert.open()
    srv.setOnline(false)
    expect(await anna.edit('Bridge', { hind: 205 })).toBe('offline')
    expect(anna.engine.pending).toEqual(['work_types'])
    srv.setOnline(true)
    await bert.edit('Crown', { hind: 99 })
    expect(await anna.engine.flush()).toBe('saved')
    expect((srv.row.values.work_types as typeof types).map(x => x.hind)).toEqual([99, 205, 30])
  })

  it('over a restart: the next start merges it onto the row and sends it', async () => {
    const srv = server({ work_types: types })
    const store = memoryStore()
    const anna = machine(srv, store)
    await anna.open()
    srv.setOnline(false)
    await anna.edit('Bridge', { hind: 205 })
    expect(store.value?.columns).toEqual(['work_types'])
    srv.setOnline(true)

    // Meanwhile Bert changes another type; then Anna's app starts again,
    // with her local copy (the screen) as it was left.
    const bert = machine(srv)
    await bert.open()
    await bert.edit('Crown design', { hind: 40 })
    const again = machine(srv, store)
    again.screen.work_types = structuredClone(anna.screen.work_types)
    await again.open()
    expect(again.engine.pending).toEqual(['work_types'])
    expect(await again.engine.flush()).toBe('saved')
    expect((srv.row.values.work_types as typeof types).map(x => x.hind)).toEqual([100, 205, 40])
    expect(store.value).toBeNull()
  })
})
