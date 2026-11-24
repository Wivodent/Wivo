/**
 * Takes a clinic's licence from its releases, on the update checks' schedule
 * (updater.ts: 30 seconds after start, then every 30 minutes). The rules are
 * in shared/license/published; this is only the wiring: the real licence
 * file, the network, the log, and the owner's notice.
 *
 * A refusal changes nothing: the machine keeps the licence it has, and the
 * log (userData/updater.log) says why, once per reason rather than every half
 * hour. Pasting a key in Settings → Licence stays the fallback.
 */
import { limitedFetcher } from '../../shared/release/release'
import { REFUSAL_TEXT, type LicenceChange } from '../../shared/license/published'
import { BUILD, CLINIC_SOURCE } from './releaseCheck'
import {
  installLicence, installedLicence, licensingEnforced, recordLicenceChange, verifyLicenceToken,
} from './license'
import { checkPublishedLicence } from './licenceFeed'

/** The clinic's organisation and database, built in by scripts/build-clinic.mjs (clinics/<id>.json). */
const BUILD_ORG = import.meta.env.MAIN_VITE_WIVO_ORG || null
const BUILD_API = import.meta.env.MAIN_VITE_WIVO_API || null

let lastLogged = ''

export async function checkDeliveredLicence(
  log: (level: string, ...args: unknown[]) => void,
  notify: (change: LicenceChange) => void,
): Promise<void> {
  const r = await checkPublishedLicence({
    source: CLINIC_SOURCE, fetch: limitedFetcher(fetch), build: BUILD, buildOrg: BUILD_ORG, api: BUILD_API,
    enforced: licensingEnforced(), installed: installedLicence, verify: verifyLicenceToken,
    install: token => {
      const s = installLicence(token)
      return s.state !== 'invalid' && s.state !== 'missing'
    },
    now: () => new Date(),
  })
  if ('installed' in r) {
    const { from, to } = r.installed
    log('INFO', `licence: installed the published licence for ${to.name}, issued ${to.iat}, valid until ${to.exp}`
      + (from ? ` (was issued ${from.iat}, until ${from.exp})` : ''))
    lastLogged = ''
    recordLicenceChange(r.installed)
    notify(r.installed)
    return
  }
  // Nothing to say for a build that has no clinic releases or no keys, or
  // when the published licence is the installed one.
  if (r.refused === 'no_source' || r.refused === 'not_enforced' || r.refused === 'same') return
  if (r.refused === lastLogged) return
  lastLogged = r.refused
  const text = r.refused === 'no_api' ? 'this build names no database address'
    : r.refused === 'not_saved' ? 'the licence file could not be written'
    : REFUSAL_TEXT[r.refused]
  log(r.refused === 'missing' ? 'INFO' : 'WARN', `licence: not taken, ${text} (${r.refused})`)
}
