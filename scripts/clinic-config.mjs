/**
 * A clinic's settings (clinics/<id>.json, clinics/README.md) and the checks
 * behind its installer (scripts/build-clinic.mjs) and its releases
 * (scripts/release.mjs, docs/RELEASE.md). Pure, so scripts/clinicBuild.test.ts
 * can run them; `loadClinic` is the one function that reads a file.
 *
 * The installer carries two public values, the clinic's project URL and its
 * public (anon / publishable) key, and nothing else. This file refuses
 * anything that could be more: a secret key, an access token, a Resend key, a
 * private key, a JWT that is not the public key, a project that is
 * production's or the test copy's, a key that belongs to another project.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Keep in step with src/renderer/src/lib/testCopy.ts: clinicBuild.test.ts compares them. */
export const PRODUCTION_REF = 'wrtucsfmpbwekugzzzxw'
export const TEST_REF = 'jhqyvancrzykxhzwnost'

/** main's own GitHub repository: its CI publishes main's releases there, never a clinic's. */
export const MAIN_REPO = 'SniperInSuit/Wivo'
/** The release in a clinic's repository that holds its installer, latest.yml and updates.json. */
export const RELEASE_TAG = 'stable'

export const CLINIC_FIELDS = ['id', 'name', 'releasesRepo', 'phoneUrl', 'supabaseRef', 'cloudflareProject', 'phoneBranch', 'orgId']

/** A UUID, as make-license.mjs --org takes it. */
export const isUuid = v => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** A clinic id: what shared/release isBuildId accepts, and never main's. */
export const isClinicId = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(v) && v !== 'main'

/**
 * The clinic's own phone address, shown in "What's new" instead of
 * app.wivodent.com (Dentiks: https://wivo.dentiks.lv, its own domain). `https://` and
 * a host only: no path, no Supabase address.
 */
export function phoneUrlProblem(url) {
  if (!url) return 'phoneUrl is missing (the phone address, e.g. https://wivo.dentiks.lv)'
  const m = /^https:\/\/([a-z0-9-]+(\.[a-z0-9-]+)+)\/?$/.exec(url)
  if (!m) return 'phoneUrl must be https:// and a host, with no path (https://wivo.dentiks.lv)'
  if (/\.supabase\.co$/.test(m[1])) return "phoneUrl is a Supabase address, not the phone app's"
  return null
}

/**
 * Check a clinic's settings (clinics/<id>.json). `problems` empty means they
 * may be used.
 * @param {string} text  the file's text
 * @param {string} id    the name the file was asked for by (it must say the same)
 */
export function parseClinic(text, id) {
  const problems = []
  let c
  try { c = JSON.parse(text.replace(/^﻿/, '')) } catch { return { clinic: null, problems: ['it is not JSON'] } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { clinic: null, problems: ['it is not an object'] }
  for (const k of Object.keys(c)) if (!CLINIC_FIELDS.includes(k)) problems.push(`${k}: not a clinic setting (${CLINIC_FIELDS.join(', ')})`)
  const str = k => (typeof c[k] === 'string' ? c[k] : '')

  if (!isClinicId(c.id)) problems.push('id must be lowercase letters, digits and -, not "main"')
  else if (c.id !== id) problems.push(`id is "${c.id}", but the file is clinics/${id}.json`)
  if (!str('name').trim()) problems.push('name is missing')

  const repo = str('releasesRepo')
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) problems.push('releasesRepo must be owner/name, e.g. SniperInSuit/wivo-dentiks-releases')
  else if (repo.toLowerCase() === MAIN_REPO.toLowerCase()) problems.push("releasesRepo is main's repository: a clinic's releases live in a repository of their own (docs/RELEASE.md)")

  const phone = phoneUrlProblem(str('phoneUrl'))
  if (phone) problems.push(phone)

  const ref = str('supabaseRef')
  if (!/^[a-z0-9]{20}$/.test(ref)) problems.push('supabaseRef must be the project ref: 20 lowercase letters and digits')
  else if (ref === PRODUCTION_REF) problems.push("supabaseRef is production's (Tallinn's old project), not a clinic's")
  else if (ref === TEST_REF) problems.push("supabaseRef is the test copy's, not a clinic's")

  if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(str('cloudflareProject'))) problems.push('cloudflareProject must be a Cloudflare Pages project name')

  const branch = str('phoneBranch')
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(branch)) problems.push('phoneBranch must be a branch name (lowercase letters, digits and -)')
  else if (branch === 'main' || branch === 'testing') problems.push(`phoneBranch may not be ${branch}: the clinic's phone app follows a branch of its own`)

  // Optional: the organisation a licence for this clinic names (make-license.mjs --org).
  // A delivered licence must name it (shared/license/published), and
  // make-license.mjs --publish needs it.
  if (c.orgId !== undefined && !isUuid(c.orgId)) problems.push('orgId must be the UUID of the organisation (Settings → Licence → Organisation)')

  if (problems.length) return { clinic: null, problems }
  return {
    clinic: { ...c, phoneUrl: c.phoneUrl.replace(/\/$/, ''), supabaseUrl: `https://${ref}.supabase.co` },
    problems,
  }
}

/** The clinics there are (clinics/*.json). */
export const clinicIds = root => (existsSync(join(root, 'clinics'))
  ? readdirSync(join(root, 'clinics')).filter(n => n.endsWith('.json')).map(n => n.slice(0, -5)).sort()
  : [])

/**
 * Read and check clinics/<id>.json.
 * @returns {{ clinic: object | null, problem: string | null }}
 */
export function loadClinic(root, id) {
  const known = clinicIds(root)
  const list = known.length ? known.join(', ') : 'none yet'
  if (!id) return { clinic: null, problem: `name the clinic: --clinic <id> (clinics: ${list})` }
  if (!isClinicId(id) || !known.includes(id)) return { clinic: null, problem: `no clinic "${id}" (clinics: ${list}; clinics/README.md)` }
  const { clinic, problems } = parseClinic(readFileSync(join(root, 'clinics', `${id}.json`), 'utf8'), id)
  return clinic ? { clinic, problem: null } : { clinic: null, problem: `clinics/${id}.json:\n  ${problems.join('\n  ')}` }
}

/**
 * A command-line option, or the same option as npm hands it on: PowerShell
 * drops the `--` of `npm run release -- --clinic dentiks`, and npm then keeps
 * `--clinic dentiks` for itself as npm_config_clinic. Either way works.
 */
export function cliOptions(argv, env) {
  const fromNpm = name => env[`npm_config_${name.replace(/^--/, '').replace(/-/g, '_')}`]
  return {
    has: name => argv.includes(name) || fromNpm(name) === 'true',
    flag: name => {
      const i = argv.indexOf(name)
      if (i >= 0) return argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined
      const v = fromNpm(name)
      return v && v !== 'true' ? v : undefined
    },
  }
}

const JWT = /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g

/** Secrets that may not appear anywhere: in the clinic's .env (comments included) or in the built app. */
export const SECRETS = [
  [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a secret key (sb_secret_)'],
  [/sbp_[A-Za-z0-9]{8,}/, 'a Supabase access token (sbp_)'],
  [/\bre_[A-Za-z0-9_]{8,}/, 'a Resend key (re_)'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
]

export function jwtPayload(token) {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[0].startsWith('eyJ')) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  }
}

/** The project ref of `https://<ref>.supabase.co`, or null. */
export function refOf(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(url.trim())
  return m ? m[1] : null
}

/**
 * The clinic's local env file (clinics/<id>.env, not tracked): the public
 * key. VITE_SUPABASE_URL and VITE_PHONE_URL may be there too (an older env
 * file), but only saying what clinics/<id>.json says. `problems` empty means
 * the build may go ahead.
 * @returns {{ key: string, problems: string[] }}
 */
export function parseClinicEnv(text, clinic) {
  const values = new Map()
  const problems = []
  const allowed = ['VITE_SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_PHONE_URL']
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/^﻿/, '').trim() // Notepad and PowerShell 5.1 may write a BOM
    if (line === '' || line.startsWith('#')) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) { problems.push(`line ${i + 1} is not NAME=value`); continue }
    const [, name, value] = m
    if (!allowed.includes(name)) problems.push(`${name}: only VITE_SUPABASE_ANON_KEY belongs here (the rest is in clinics/${clinic.id}.json)`)
    else if (values.has(name)) problems.push(`${name} is set twice`)
    else values.set(name, value.replace(/^(['"])(.*)\1$/, '$2').trim())
  }
  const url = values.get('VITE_SUPABASE_URL')
  if (url !== undefined && refOf(url) !== clinic.supabaseRef) problems.push(`VITE_SUPABASE_URL is not ${clinic.supabaseUrl} (clinics/${clinic.id}.json): remove the line`)
  const phone = values.get('VITE_PHONE_URL')
  if (phone !== undefined && phone.replace(/\/$/, '') !== clinic.phoneUrl) problems.push(`VITE_PHONE_URL is not ${clinic.phoneUrl} (clinics/${clinic.id}.json): remove the line`)

  const key = values.get('VITE_SUPABASE_ANON_KEY') ?? ''
  if (!key) problems.push('VITE_SUPABASE_ANON_KEY is missing')
  else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    const payload = jwtPayload(key)
    if (!payload) problems.push('VITE_SUPABASE_ANON_KEY is not a public key (the anon JWT, or sb_publishable_…)')
    else if (payload.role !== 'anon') problems.push(`VITE_SUPABASE_ANON_KEY is a ${String(payload.role ?? 'role-less')} key, not the anon key`)
    else if (typeof payload.ref === 'string' && payload.ref !== clinic.supabaseRef) problems.push(`VITE_SUPABASE_ANON_KEY belongs to another project than ${clinic.supabaseRef}`)
  }

  for (const [shape, what] of SECRETS) if (shape.test(text)) problems.push(`it holds ${what}`)
  if ((text.match(JWT) ?? []).some(token => token !== key)) problems.push('it holds a token outside VITE_SUPABASE_ANON_KEY')
  return { key, problems }
}

/**
 * What a built app (out/, or the unpacked app) may not hold: a secret of the
 * shapes above, or any JWT that is not the public key. (A project ref is not
 * searched for: lib/testCopy.ts carries production's and the test copy's on
 * purpose, to refuse them.)
 * @param {string} text  one file's text (latin1 is fine; an asar is scanned the same way)
 * @param {string} key   the public key the build was given
 */
export function forbiddenIn(text, key) {
  const found = []
  for (const [shape, what] of SECRETS) if (shape.test(text)) found.push(what)
  for (const token of new Set(text.match(JWT) ?? [])) {
    if (token === key) continue
    const role = jwtPayload(token)?.role
    found.push(`a token that is not the public key (role: ${String(role ?? 'none')})`)
  }
  return found
}

/**
 * The command that moves the clinic's phone branch (its Cloudflare Pages
 * project builds the phone app from it) to the installer's commit, so the
 * phone and the installer are the same version. Never forced: git refuses it
 * unless the commit is ahead of where the branch is, so it only ever follows
 * `testing`. The first run creates the branch.
 * @param {string} sha     the installer's full commit
 * @param {string} branch  the clinic's phoneBranch
 */
export function phoneBranchCommand(sha, branch) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full commit: ${sha}`)
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(branch) || branch === 'main' || branch === 'testing') throw new Error(`not a phone branch: ${branch}`)
  return `git push origin ${sha}:refs/heads/${branch}`
}

/** Where a clinic's releases are downloaded from: the `<source>` of shared/release listAddress. */
export const releaseSource = clinic => `https://github.com/${clinic.releasesRepo}/releases/download`

/** The clinic's installer reads its updates here and nowhere else (docs/RELEASE.md). */
export const clinicFeed = clinic => `${releaseSource(clinic)}/${RELEASE_TAG}`

/**
 * The packaged app-update.yml (electron-builder writes it from the publish
 * setting): a generic feed at the clinic's own release, never main's GitHub
 * releases. Null when it is right.
 * @param {string} text
 * @param {string} feed  clinicFeed(clinic)
 */
export function appUpdateYmlProblem(text, feed) {
  if (!text.trim()) return 'missing: the installer would have no update feed'
  if (/provider:\s*github/.test(text)) return "it points at GitHub's release feed (main's), which must never reach a clinic's installer"
  if (!/provider:\s*generic/.test(text)) return 'it is not a generic feed'
  const url = /url:\s*['"]?([^'"\s]+)/.exec(text)?.[1]
  if (url !== feed) return `it reads ${url ?? 'no address'}, not ${feed}`
  return null
}
