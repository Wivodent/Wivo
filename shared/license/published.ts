/**
 * A licence delivered with the updates (docs/RELEASE.md §7).
 *
 * `make-license.mjs … --publish --clinic <id>` puts the signed token in the
 * clinic's own releases, next to `updates.json`, as `licence.json`. Every
 * desktop of that clinic reads it when it checks for updates (about every 30
 * minutes) and installs it only when ALL of these hold:
 *
 *   - the file names this clinic's build;
 *   - the token is signed by a licence key the app pins (YubiKey C or D);
 *   - it is a v2 token, and its organisation is this clinic's;
 *   - its API addresses include the one this app talks to;
 *   - it was issued later than the licence installed now.
 *
 * Anything else is refused, the reason goes to the log, and the licence the
 * machine has stays. Pasting a key in Settings → Licence keeps working as
 * before: it is the fallback, and the owner's own decision.
 *
 * One function decides, `judgePublishedLicence`, and both sides run it: the
 * app before it installs, and make-license.mjs before it publishes. So the
 * tool cannot publish a licence the app would refuse without saying so.
 *
 * Nothing here is secret: the token is a signed statement, and the clinic's
 * releases are public.
 */
import {
  MODULE_KEYS, licenceApiOrigins, licenceModules, normaliseOrigin, parseToken,
  type LicenceModule, type LicencePayload, type LicencePlan,
} from './token'

/** The file's name in the clinic's `stable` release. */
export const LICENCE_FILE = 'licence.json'

/** A token is a few hundred bytes; anything far larger is not a licence file. */
export const MAX_LICENCE_FILE_BYTES = 16 * 1024

export interface LicenceFile {
  v: 1
  /** The clinic's build id (clinics/<id>.json `id`): a file for another clinic is refused. */
  clinic: string
  token: string
}

/** The file make-license.mjs publishes. */
export function licenceFileText(clinic: string, token: string): string {
  return JSON.stringify({ v: 1, clinic, token: token.trim() } satisfies LicenceFile, null, 2) + '\n'
}

/** The file's shape, or null. What the token says is judged below, not here. */
export function parseLicenceFile(bytes: Uint8Array | string): LicenceFile | null {
  try {
    const text = typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes)
    const v = JSON.parse(text.replace(/^﻿/, '')) as Partial<LicenceFile>
    if (!v || typeof v !== 'object' || v.v !== 1) return null
    if (typeof v.clinic !== 'string' || typeof v.token !== 'string' || !v.token.startsWith('WIVO1.')) return null
    return { v: 1, clinic: v.clinic, token: v.token.trim() }
  } catch {
    return null
  }
}

export type LicenceRefusal =
  /** No file published (or it could not be fetched). Nothing to do. */
  | 'missing'
  /** Not a licence file, or not a token. */
  | 'malformed'
  /** A file for another clinic's build. */
  | 'other_clinic'
  /** The token installed now. Nothing to do. */
  | 'same'
  /** Not signed by a pinned licence key, or edited. */
  | 'bad_signature'
  /** A v1 token names no organisation and no address, so it cannot be matched to a clinic. */
  | 'not_v2'
  /** This app knows no organisation to compare with. */
  | 'no_org'
  /** Another clinic's organisation. */
  | 'other_org'
  /** The token does not name the address this app talks to. */
  | 'other_api'
  /** Issued on the same day as, or before, the licence installed now. */
  | 'not_newer'

export type LicenceJudgement =
  | { ok: true; token: string; payload: LicencePayload }
  | { ok: false; reason: LicenceRefusal }

export interface LicenceOffer {
  /** The published file's bytes, or null when there is none. */
  file: Uint8Array | string | null
  /** This app's build id (the clinic's id). */
  build: string
  /** The clinic's organisation: the build's, else the installed licence's. Null: none known. */
  org: string | null
  /** The address this app's database client talks to. */
  api: string
  /** The installed licence, verified, and its token; null when there is none (or it is not valid). */
  current: { token: string; payload: LicencePayload } | null
  /** The app's own signature check: the payload, or null. */
  verify: (token: string) => LicencePayload | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Whether a published licence may replace the installed one, and if not, why. */
export function judgePublishedLicence(o: LicenceOffer): LicenceJudgement {
  if (o.file === null) return { ok: false, reason: 'missing' }
  const file = parseLicenceFile(o.file)
  if (!file || !parseToken(file.token)) return { ok: false, reason: 'malformed' }
  if (file.clinic !== o.build) return { ok: false, reason: 'other_clinic' }
  if (o.current && o.current.token.trim() === file.token) return { ok: false, reason: 'same' }

  const payload = o.verify(file.token)
  if (!payload) return { ok: false, reason: 'bad_signature' }
  if (payload.v !== 2 || !payload.org) return { ok: false, reason: 'not_v2' }
  if (!DATE.test(payload.iat ?? '')) return { ok: false, reason: 'malformed' }

  if (!o.org) return { ok: false, reason: 'no_org' }
  if (payload.org.toLowerCase() !== o.org.toLowerCase()) return { ok: false, reason: 'other_org' }

  // Named explicitly: an empty list means "any address" to a pasted key, but
  // a delivered one has to say it is for this clinic's database.
  const asked = normaliseOrigin(o.api)
  if (!asked || !licenceApiOrigins(payload).includes(asked)) return { ok: false, reason: 'other_api' }

  // A later issue date, not a later expiry: a renewal moves both, and an
  // older token re-published by mistake must not undo a newer one.
  const before = o.current?.payload.iat
  if (before && !(payload.iat > before)) return { ok: false, reason: 'not_newer' }

  return { ok: true, token: file.token, payload }
}

/** What a refusal means, for the log and the tool. English: neither is shown in the app. */
export const REFUSAL_TEXT: Record<LicenceRefusal, string> = {
  missing: 'no licence is published',
  malformed: 'the published licence file is not a licence',
  other_clinic: "the published licence file is another clinic's",
  same: 'the published licence is the one installed',
  bad_signature: 'the published licence is not signed by a Wivo licence key',
  not_v2: 'the published licence is a v1 key, which names no organisation',
  no_org: 'this app knows no organisation to compare the licence with',
  other_org: "the published licence is for another organisation",
  other_api: 'the published licence does not name the address this app uses',
  not_newer: 'the published licence was not issued later than the one installed',
}

// ─── What changed, for the owner's notice ─────────────────────────────────────

export interface LicenceChange {
  /** When the app installed it. */
  at: string
  /** The licence before, or null when there was none. */
  from: LicencePayload | null
  to: LicencePayload
}

export interface LicenceDifference {
  modulesAdded: LicenceModule[]
  modulesRemoved: LicenceModule[]
  seats: { from: number | null; to: number | null } | null
  exp: { from: string | null; to: string } | null
  plan: { from: LicencePlan | null; to: LicencePlan } | null
}

/** The differences between two licences, modules in the app's order. */
export function licenceDifference(from: LicencePayload | null, to: LicencePayload): LicenceDifference {
  const before = from ? licenceModules(from) : new Set<LicenceModule>()
  const after = licenceModules(to)
  return {
    modulesAdded: MODULE_KEYS.filter(m => after.has(m) && !before.has(m)),
    modulesRemoved: MODULE_KEYS.filter(m => before.has(m) && !after.has(m)),
    seats: !from || from.seats !== to.seats ? { from: from ? from.seats : null, to: to.seats } : null,
    exp: !from || from.exp !== to.exp ? { from: from?.exp ?? null, to: to.exp } : null,
    plan: !from || from.plan !== to.plan ? { from: from?.plan ?? null, to: to.plan } : null,
  }
}

/** A stored change, or null when it is not one (a hand-edited or older file). */
export function parseLicenceChange(v: unknown): LicenceChange | null {
  if (!v || typeof v !== 'object') return null
  const c = v as Partial<LicenceChange>
  const isPayload = (p: unknown): p is LicencePayload =>
    !!p && typeof p === 'object' && typeof (p as LicencePayload).exp === 'string' && typeof (p as LicencePayload).plan === 'string'
  if (typeof c.at !== 'string' || !isPayload(c.to)) return null
  if (c.from !== null && !isPayload(c.from)) return null
  return { at: c.at, from: c.from ?? null, to: c.to }
}
