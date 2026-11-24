/**
 * The licence published with a clinic's updates (shared/license/published,
 * docs/RELEASE.md §7): fetched, judged with the shared rules, and installed
 * only when every rule holds. No Electron here, so licenceFeed.test.ts runs
 * it as it is; licenceDelivery.ts wires it to the real file and the log.
 */
import { packageAddress, type Fetcher } from '../../shared/release/release'
import {
  LICENCE_FILE, MAX_LICENCE_FILE_BYTES, judgePublishedLicence,
  type LicenceChange, type LicenceRefusal,
} from '../../shared/license/published'
import type { LicencePayload } from '../../shared/license/token'

/** Where a clinic's licence is published: the `stable` release, next to updates.json. */
export const licenceAddress = (source: string): string => packageAddress(source, 'stable', LICENCE_FILE)

export interface LicenceFeedDeps {
  /** The clinic's releases (releaseCheck CLINIC_SOURCE); null for main's build, which has none. */
  source: string | null
  fetch: Fetcher
  /** This app's build id. */
  build: string
  /** The clinic's organisation from the build (clinics/<id>.json orgId), if it has one. */
  buildOrg: string | null
  /** The address the database client talks to (the clinic's project). */
  api: string | null
  /** Whether this build checks licences at all. */
  enforced: boolean
  installed: () => { token: string; payload: LicencePayload } | null
  verify: (token: string) => LicencePayload | null
  /** Store the token; true when it is now the installed, valid licence. */
  install: (token: string) => boolean
  now: () => Date
}

export type LicenceFeedResult =
  | { installed: LicenceChange }
  | { refused: LicenceRefusal | 'no_source' | 'not_enforced' | 'no_api' | 'not_saved' }

export async function checkPublishedLicence(d: LicenceFeedDeps): Promise<LicenceFeedResult> {
  if (!d.enforced) return { refused: 'not_enforced' }
  if (!d.source) return { refused: 'no_source' }
  if (!d.api) return { refused: 'no_api' }
  const file = await d.fetch(licenceAddress(d.source), MAX_LICENCE_FILE_BYTES)
  const current = d.installed()
  const judged = judgePublishedLicence({
    file, build: d.build, api: d.api, current, verify: d.verify,
    // The build's organisation decides; a build without one compares with the
    // licence installed now. One with neither takes no licence by itself.
    org: d.buildOrg || current?.payload.org || null,
  })
  if (!judged.ok) return { refused: judged.reason }
  if (!d.install(judged.token)) return { refused: 'not_saved' }
  return { installed: { at: d.now().toISOString(), from: current?.payload ?? null, to: judged.payload } }
}
