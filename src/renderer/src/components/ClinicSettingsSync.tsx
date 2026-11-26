/**
 * Keeps the clinic-owned half of Seaded in step with the database.
 *
 * Renders nothing. Mounted once, inside the authenticated tree, where the
 * clinic id is known.
 *
 * Order of events on start-up:
 *   1. read the clinic's row
 *   2. no row yet → seed it from whatever THIS machine has configured, so an
 *      existing lab's prices and work types move up to the server instead of
 *      being replaced by defaults
 *   3. row exists → it wins over the local copy, and localStorage becomes a
 *      cache for the next cold start
 *   4. subscribe to realtime so a price changed on the owner's machine reaches
 *      the other workstations without a restart
 *
 * Since 2.2.3 the reading and writing go through lib/settingsSync: a save
 * writes only the columns changed here, and only over the row as last known;
 * changes from elsewhere are merged into what is being edited, item by item;
 * a save that fails stays to be sent, again by itself and after a restart.
 *
 * If any of this fails — table not migrated yet, offline, no clinic — the app
 * keeps running on the local copy. That is the whole reason the store still
 * writes to localStorage first and treats the push as a side effect.
 */
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  applyClinicRow, clinicSliceOf, setClinicPusher, getSettingsSnapshot
} from '../stores/useSettings'
import { applyRemoteStages, getStages, setStagePusher } from '../context/PipelineContext'
import {
  fetchClinicLanguage, fetchClinicSettings, seedClinicSettings, writeClinicSettingsIf,
  subscribeClinicSettings, CLINIC_COLUMNS, type ClinicPatch, type ClinicSettingsRow
} from '../lib/clinicSettings'
import { SettingsSync, type ColumnConflict, type Columns, type SettingsRowSnapshot, type UnsentStore } from '../lib/settingsSync'
import { defaultWorkTypesFor, isUntouchedDefaultList } from '@shared/pricing/workTypes'
import { t } from '@/lib/i18n'

export type SyncState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'synced'; at: string | null }
  | { status: 'local'; reason: string }

const listeners = new Set<(s: SyncState) => void>()
let current: SyncState = { status: 'idle' }

function emit(next: SyncState) {
  current = next
  listeners.forEach(fn => fn(next))
}

/** Lets Seaded show whether it is editing shared settings or just this machine. */
export function useClinicSyncState(): SyncState {
  const [state, setState] = useState<SyncState>(current)
  useEffect(() => {
    listeners.add(setState)
    setState(current)
    return () => { listeners.delete(setState) }
  }, [])
  return state
}

// ── What both people changed at once (2.2.3), for Settings' banner ───────────
const conflictListeners = new Set<(c: ColumnConflict[]) => void>()
let lastConflicts: ColumnConflict[] = []
function emitConflicts(c: ColumnConflict[]) {
  lastConflicts = c
  conflictListeners.forEach(fn => fn(c))
}
let refreshNow: (() => void) | null = null

/** The settings this person and somebody else changed at once, until Reload. */
export function useSettingsConflicts(): { conflicts: ColumnConflict[]; reload: () => void } {
  const [c, setC] = useState<ColumnConflict[]>(lastConflicts)
  useEffect(() => {
    conflictListeners.add(setC)
    setC(lastConflicts)
    return () => { conflictListeners.delete(setC) }
  }, [])
  return { conflicts: c, reload: () => { emitConflicts([]); refreshNow?.() } }
}

/** The columns synced here (pipeline_stages included); the rest of the row is written elsewhere. */
const SYNCED: readonly string[] = [...CLINIC_COLUMNS]

const snapshotOf = (row: ClinicSettingsRow): SettingsRowSnapshot => ({
  values: Object.fromEntries(SYNCED.filter(c => c in row).map(c => [c, (row as unknown as Columns)[c]])),
  updatedAt: row.updated_at ?? null,
})

/** Unsent settings over a restart, per clinic. */
function unsentStore(clinicId: string): UnsentStore {
  const key = `wivo_clinic_unsent_v1:${clinicId}`
  return {
    read: () => {
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? 'null')
        return v && Array.isArray(v.columns) && v.known && typeof v.known === 'object' ? v : null
      } catch { return null }
    },
    write: v => {
      try {
        if (v) localStorage.setItem(key, JSON.stringify(v))
        else localStorage.removeItem(key)
      } catch { /* full storage: the change is still in memory and on screen */ }
    },
  }
}

export function ClinicSettingsSync(): null {
  // Keyed on the PROFILE's clinic_id, not on the fetched clinic object: if the
  // clinic row fails to load (RLS, network, a deleted row) the id is still
  // valid, and settings must keep syncing rather than silently falling back to
  // this machine's local copy.
  const { clinicId, role, status } = useAuth()
  // Writes are gathered and flushed together: dragging a price spinner fires a
  // setter per keystroke, and one round-trip per keystroke would both hammer
  // the table and let responses land out of order.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || !clinicId) {
      setClinicPusher(null)
      setStagePusher(null)
      emit({ status: 'idle' })
      return
    }

    let cancelled = false
    emit({ status: 'loading' })

    const engine = new SettingsSync(
      {
        fetch: async () => {
          const row = await fetchClinicSettings(clinicId)
          return row ? snapshotOf(row) : null
        },
        write: (patch, expected) => writeClinicSettingsIf(clinicId, patch as ClinicPatch, expected),
      },
      {
        get: col => (col === 'pipeline_stages'
          ? getStages()
          : (clinicSliceOf(getSettingsSnapshot()) as unknown as Columns)[col]),
        apply: values => {
          const { pipeline_stages: stages, ...rest } = values
          if (Object.keys(rest).length) applyClinicRow(rest as Partial<ClinicSettingsRow>)
          if (Array.isArray(stages) && stages.length) applyRemoteStages(stages as ClinicSettingsRow['pipeline_stages'])
        },
      },
      { onConflict: emitConflicts, unsent: unsentStore(clinicId) },
    )

    // A failed save is tried again by itself: soon, and whenever the
    // connection comes back or the window is used again.
    let retry: ReturnType<typeof setTimeout> | null = null
    const flush = async (): Promise<void> => {
      timer.current = null
      if (cancelled) return
      const outcome = await engine.flush()
      if (cancelled) return
      if (outcome === 'offline' || outcome === 'busy') {
        emit({ status: 'local', reason: t('conflict.notSavedYet') })
        if (retry) clearTimeout(retry)
        retry = setTimeout(() => { retry = null; void flush() }, 30_000)
      } else if (outcome === 'saved') {
        emit({ status: 'synced', at: new Date().toISOString() })
      }
    }

    const queue = (patch: ClinicPatch) => {
      engine.markDirty(Object.keys(patch))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => { void flush() }, 400)
    }

    // Workers never write clinic settings — the RLS policy would reject it, and
    // queuing a doomed request just to show an error is worse than not offering
    // it. The UI gates the same way (settings.read / owner).
    const canWrite = role === 'owner'

    // Read again: after sleep, a lost connection, or on "Reload". Merged into
    // what is being edited here, never replacing it.
    let lastRead = 0
    const reread = async (force = false): Promise<void> => {
      if (cancelled || (!force && Date.now() - lastRead < 30_000)) return
      lastRead = Date.now()
      try {
        const row = await fetchClinicSettings(clinicId)
        if (cancelled || !row) return
        engine.remote(snapshotOf(row))
        if (engine.pending.length) {
          emit({ status: 'local', reason: t('conflict.notSavedYet') })
          if (canWrite) void flush()
        } else {
          emit({ status: 'synced', at: row.updated_at ?? null })
        }
      } catch { /* still offline: the next trigger tries again */ }
    }
    refreshNow = () => { void reread(true) }
    const onOnline = () => { void reread(true) }
    const onVisible = () => { if (document.visibilityState === 'visible') void reread() }
    window.addEventListener('online', onOnline)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    ;(async () => {
      try {
        let row = await fetchClinicSettings(clinicId)
        if (cancelled) return

        if (!row) {
          if (!canWrite) {
            // A worker on a clinic whose owner has not opened the app since the
            // migration. Keep the local copy rather than seeding a row the
            // policy will not accept.
            emit({ status: 'local', reason: t('clinicSettingsSync.clinicSettingsHaveNotBeenSaved') })
          } else {
            const slice = clinicSliceOf(getSettingsSnapshot())
            // A new clinic's own list in its own language (an English clinic
            // gets English names) — but only when this machine still has the
            // untouched default: a lab's own list moves up as it is.
            if (isUntouchedDefaultList(slice.work_types)) {
              slice.work_types = defaultWorkTypesFor(await fetchClinicLanguage(clinicId))
            }
            if (cancelled) return
            row = await seedClinicSettings(clinicId, { ...slice, pipeline_stages: getStages() })
          }
        }
        if (cancelled) return

        if (row) {
          // The row wins over the local copy, except for changes this machine
          // could not send last time: those are merged onto it and sent now.
          engine.start(snapshotOf(row))
          lastRead = Date.now()
          emit({ status: 'synced', at: row.updated_at ?? null })
        }

        if (canWrite) {
          setClinicPusher(queue)
          setStagePusher(stages => queue({ pipeline_stages: stages }))
          if (engine.pending.length) void flush()
        }
      } catch (err) {
        if (!cancelled) {
          emit({ status: 'local', reason: (err as Error)?.message ?? t('clinicSettingsSync.noConnection') })
        }
      }
    })()

    // Every change elsewhere, our own save's echo included: an echo equals
    // what is known and changes nothing, so nothing has to be ignored.
    const unsubscribe = subscribeClinicSettings(clinicId, (row: ClinicSettingsRow) => {
      if (cancelled) return
      engine.remote(snapshotOf(row))
      if (!engine.pending.length) emit({ status: 'synced', at: row.updated_at ?? null })
    })

    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
      if (retry) clearTimeout(retry)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      refreshNow = null
      setClinicPusher(null)
      setStagePusher(null)
      unsubscribe()
    }
  }, [clinicId, role, status])

  return null
}
