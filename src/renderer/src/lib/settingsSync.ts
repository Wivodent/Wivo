/**
 * The clinic's shared settings (clinic_settings) when two people, or one
 * person on two machines, change them at once (2.2.3).
 *
 * Each column (work_types, pricing, …) is one JSON value. Before 2.2.3 a save
 * wrote the whole column from this machine's copy, and the newest save won:
 * a price changed on another machine a minute earlier was put back. And
 * every change from elsewhere was ignored for two seconds after any save of
 * one's own.
 *
 * Now the engine remembers, per column, the value it last knew the server to
 * hold (`known`) and the row's `updated_at`:
 *
 *   - a save writes only the columns changed here, and only while the row's
 *     updated_at is the one known (the lock);
 *   - when somebody else saved first, the row is read and both changes are
 *     merged item by item (shared/concurrency/merge3): another work type, or
 *     another price, both stay. Where both changed the same thing the stored
 *     value stays, and `onConflict` says what;
 *   - a change from elsewhere (realtime, waking up, the connection back) is
 *     merged the same way into what is being edited here, never replacing it;
 *   - a save that cannot reach the server stays to be sent: tried again by
 *     itself, and kept over a restart (`storage`), so it is not lost.
 *
 * No React and no Supabase in here: `io` and `local` are given, and
 * settingsSync.test.ts runs two machines against one fake row.
 */
import { jsonEqual, merge3, type MergeConflict } from '@shared/concurrency/merge'

export type Columns = Record<string, unknown>

export interface SettingsRowSnapshot {
  values: Columns
  updatedAt: string | null
}

export interface SettingsSyncIo {
  /** The row as stored now, or null when there is none. */
  fetch(): Promise<SettingsRowSnapshot | null>
  /** Write `patch` only where updated_at is `expected`: the new updated_at, or null when it did not match. */
  write(patch: Columns, expected: string | null): Promise<string | null>
}

export interface SettingsLocal {
  /** This machine's current value of a column (what the screen shows). */
  get(column: string): unknown
  /** Put these columns' values on this machine, without sending them anywhere. */
  apply(values: Columns): void
}

export interface ColumnConflict {
  column: string
  conflicts: MergeConflict[]
}

/** Where unsent changes wait over a restart (localStorage in the app). */
export interface UnsentStore {
  read(): { known: Columns; knownAt: string | null; columns: string[] } | null
  write(v: { known: Columns; knownAt: string | null; columns: string[] } | null): void
}

export type FlushOutcome = 'saved' | 'nothing' | 'offline' | 'busy'

export class SettingsSync {
  private known: Columns = {}
  private knownAt: string | null = null
  private loaded = false
  private dirty = new Set<string>()
  private inFlight: Promise<FlushOutcome> | null = null

  constructor(
    private readonly io: SettingsSyncIo,
    private readonly local: SettingsLocal,
    private readonly hooks: {
      onConflict?: (c: ColumnConflict[]) => void
      unsent?: UnsentStore
    } = {},
  ) {}

  /** Unsaved columns, for the screen ("not saved to the clinic yet"). */
  get pending(): string[] { return [...this.dirty] }

  /**
   * The row as first read. Columns left unsent by the last session (offline,
   * then closed) are merged onto it, not lost, and stay to be sent.
   */
  start(row: SettingsRowSnapshot): void {
    const unsent = this.hooks.unsent?.read() ?? null
    this.known = { ...row.values }
    this.knownAt = row.updatedAt
    this.loaded = true
    const apply: Columns = {}
    const conflicts: ColumnConflict[] = []
    for (const [col, value] of Object.entries(row.values)) {
      if (unsent?.columns.includes(col) && col in unsent.known) {
        const m = merge3(unsent.known[col], this.local.get(col), value)
        apply[col] = m.value
        if (!jsonEqual(m.value, value)) this.dirty.add(col)
        if (m.conflicts.length) conflicts.push({ column: col, conflicts: m.conflicts })
      } else {
        apply[col] = value
      }
    }
    this.local.apply(apply)
    this.saveUnsent()
    if (conflicts.length) this.hooks.onConflict?.(conflicts)
  }

  /** This machine changed these columns: they are sent on the next flush. */
  markDirty(columns: readonly string[]): void {
    for (const c of columns) this.dirty.add(c)
    this.saveUnsent()
  }

  /**
   * The row as somebody else left it (realtime, waking up, connection back).
   * What changed there is merged into what is being edited here.
   */
  remote(row: SettingsRowSnapshot): ColumnConflict[] {
    if (!this.loaded) { this.start(row); return [] }
    const apply: Columns = {}
    const conflicts: ColumnConflict[] = []
    for (const [col, value] of Object.entries(row.values)) {
      if (jsonEqual(value, this.known[col])) continue
      if (this.dirty.has(col)) {
        const m = merge3(this.known[col], this.local.get(col), value)
        apply[col] = m.value
        if (m.conflicts.length) conflicts.push({ column: col, conflicts: m.conflicts })
        if (jsonEqual(m.value, value)) this.dirty.delete(col)
      } else {
        apply[col] = value
      }
      this.known[col] = value
    }
    this.knownAt = row.updatedAt
    if (Object.keys(apply).length) this.local.apply(apply)
    this.saveUnsent()
    if (conflicts.length) this.hooks.onConflict?.(conflicts)
    return conflicts
  }

  /** Send what changed here. One at a time; a change made meanwhile is sent after. */
  async flush(): Promise<FlushOutcome> {
    if (this.inFlight) {
      await this.inFlight
      return this.dirty.size ? this.flush() : 'nothing'
    }
    this.inFlight = this.flushOnce().finally(() => { this.inFlight = null })
    return this.inFlight
  }

  private async flushOnce(): Promise<FlushOutcome> {
    if (!this.loaded) return 'busy'
    for (let attempt = 0; attempt < 4; attempt++) {
      const patch: Columns = {}
      for (const col of this.dirty) {
        const v = this.local.get(col)
        if (jsonEqual(v, this.known[col])) this.dirty.delete(col)
        else patch[col] = v
      }
      this.saveUnsent()
      if (Object.keys(patch).length === 0) return 'nothing'
      let at: string | null
      try {
        at = await this.io.write(patch, this.knownAt)
      } catch {
        return 'offline'
      }
      if (at !== null) {
        for (const [col, v] of Object.entries(patch)) {
          this.known[col] = v
          // Changed again while the save was on its way: still to be sent.
          if (jsonEqual(this.local.get(col), v)) this.dirty.delete(col)
        }
        this.knownAt = at
        this.saveUnsent()
        if (this.dirty.size === 0) return 'saved'
        continue
      }
      // Somebody else saved first: take their row, merge, try again on it.
      let row: SettingsRowSnapshot | null
      try {
        row = await this.io.fetch()
      } catch {
        return 'offline'
      }
      if (!row) return 'offline'
      this.remote(row)
    }
    return this.dirty.size ? 'busy' : 'saved'
  }

  private saveUnsent(): void {
    const store = this.hooks.unsent
    if (!store) return
    if (this.dirty.size === 0) { store.write(null); return }
    const columns = [...this.dirty]
    store.write({ known: Object.fromEntries(columns.map(c => [c, this.known[c]])), knownAt: this.knownAt, columns })
  }
}
