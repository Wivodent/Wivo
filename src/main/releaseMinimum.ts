/**
 * The minimum desktop version from the clinic's signed release list
 * (docs/RELEASE.md §6a). Kevin sets it with the release tool
 * (`--min-version`); the update key signs it with the list. A desktop below
 * it shows "Please update Wivo" and saves nothing until it updates; reading
 * goes on (renderer: lib/releaseMinimum, components/PleaseUpdate).
 *
 * Read on the update checks' schedule (updater.ts): soon after start, every
 * 30 minutes, and on "Check now". It counts only from a list this desktop
 * would accept for an update (shared/release checkListMinimum): validly
 * signed, fresh, not rolled back, and for this clinic's build.
 *
 * The last minimum accepted is kept in userData (release-minimum.json), so it
 * holds from the first second after a restart, and while the list can't be
 * reached or has expired. Only a newer valid list changes it: raises it,
 * lowers it, or takes it away. Until the root keys are pinned there is
 * nothing to check against, and there is no minimum.
 */
import { readFileSync, writeFileSync } from 'fs'
import {
  MAX_INDEX_BYTES, checkListMinimum, compareVersions, isVersion, listAddress, parsePublishedList,
  type Channel, type Fetcher, type RootKey, type SerialFloor,
} from '../../shared/release/release'
import type { ReleaseMinimum } from '../types/update'

export interface StoredMinimum {
  /** The minimum, or null: the last accepted list asks none. */
  min_version: string | null
  key_id: string
  serial: number
  checked_at: string
}

/** What the renderer is told (src/types/update.ts). */
export type MinimumStatus = ReleaseMinimum

export interface MinimumDeps {
  pinned: RootKey[]
  sources: string[]
  fetch: Fetcher
  channel: Channel
  build: string
  /** userData/release-minimum.json */
  statePath: string
  /** userData/release-floor.json, shared with the update check (releaseCheck.ts). */
  floorPath: string
  now: () => Date
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

/** The minimum kept from the last accepted list, or null. Anything unreadable counts as none. */
export function storedMinimum(statePath: string): StoredMinimum | null {
  const v = readJson<Partial<StoredMinimum>>(statePath)
  if (!v || typeof v !== 'object' || typeof v.key_id !== 'string' || !Number.isSafeInteger(v.serial)) return null
  return {
    min_version: isVersion(v.min_version) ? v.min_version : null,
    key_id: v.key_id, serial: v.serial as number, checked_at: typeof v.checked_at === 'string' ? v.checked_at : '',
  }
}

/** Is `running` below `minimum`? An unreadable running version is not judged: the app never locks itself on its own bug. */
export function isBelow(running: string, minimum: string | null): boolean {
  return !!minimum && isVersion(running) && compareVersions(running, minimum) < 0
}

export type MinimumCheck =
  | { changed: boolean; minimum: string | null }
  | { refused: string }

/**
 * Reads the published list and keeps what it says. A refusal keeps the
 * minimum already kept: an unreachable or stale list must not unlock an old
 * build, and must not lock a new one either.
 */
export async function checkReleaseMinimum(deps: MinimumDeps): Promise<MinimumCheck> {
  if (deps.pinned.length === 0) return { refused: 'not_pinned' }
  if (deps.sources.length === 0) return { refused: 'no_source' }
  const floor = readJson<SerialFloor>(deps.floorPath) ?? {}
  const reasons: string[] = []
  for (const source of deps.sources) {
    const bytes = await deps.fetch(listAddress(source, deps.channel), MAX_INDEX_BYTES * 2)
    const list = bytes && parsePublishedList(bytes)
    if (!list) { reasons.push(bytes ? 'malformed' : 'unreachable'); continue }
    const r = await checkListMinimum({ list, pinned: deps.pinned, now: deps.now(), channel: deps.channel, floor, build: deps.build })
    if (!r.ok) { reasons.push(r.reason); continue }
    const before = storedMinimum(deps.statePath)
    // A list older than the one the minimum came from (another key's floor) changes nothing.
    if (before && before.key_id === r.key_id && r.serial < before.serial) return { changed: false, minimum: before.min_version }
    try {
      writeFileSync(deps.floorPath, JSON.stringify({ ...floor, [r.key_id]: { serial: r.serial, sha256: r.signedSha256 } }))
    } catch {
      // The floor is a defence in depth; failing to write it must not stop the minimum.
    }
    const next: StoredMinimum = { min_version: r.minimum, key_id: r.key_id, serial: r.serial, checked_at: deps.now().toISOString() }
    try {
      writeFileSync(deps.statePath, JSON.stringify(next))
    } catch {
      // Kept in memory by the caller for this session; the next check writes it again.
    }
    return { changed: (before?.min_version ?? null) !== r.minimum, minimum: r.minimum }
  }
  return { refused: reasons.find(r => r !== 'unreachable') ?? 'unreachable' }
}
