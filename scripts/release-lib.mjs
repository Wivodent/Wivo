/**
 * The pure parts of the clinics' release tool (scripts/release.mjs,
 * docs/RELEASE.md), so scripts/releaseTool.test.ts can run them. Nothing here
 * reads a key or the network; the clinic comes from clinics/<id>.json
 * (scripts/clinic-config.mjs).
 */
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import { RELEASE_TAG } from './clinic-config.mjs'

/** A clinic's releases: the release tagged `stable` of its own repository (clinics/<id>.json releasesRepo). */
export { RELEASE_TAG }

/** The list expires 30 days after signing, the most it may (ARCHITECTURE-INSTANCES.md §5g; Kevin's decision, November 2026). */
export const LIST_DAYS = 30
export const MAX_LIST_DAYS = 30

/** The signing YubiKeys: C signs, D is the spare (scripts/yubikey/keys.mjs). */
export const SIGNERS = { C: 38272295, D: 38272284 }
/** PIV slots (scripts/yubikey/setup-plan.mjs): the update key and the app key. */
export const SLOTS = { update: '9c', app: '82' }

/** A TypeScript file with no imports, for plain Node (as scripts/yubikey/load-release.mjs). */
export async function loadTs(path) {
  const { code } = await transform(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm', target: 'node20' })
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}

/** electron-updater's feed for one installer (what electron-builder writes as latest.yml). */
export function latestYml({ version, file, sha512, size, releaseDate }) {
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n')
}

const MIGRATION = /^(\d{3})_[A-Za-z0-9_]+\.sql$/

/** The numbered migrations in sql/, in the order they run. */
export function migrationFiles(names) {
  return names.filter(n => MIGRATION.test(n)).sort((a, b) => Number(MIGRATION.exec(a)[1]) - Number(MIGRATION.exec(b)[1]) || (a < b ? -1 : 1))
}

/** The migrations after `previous` (the last release's `schema`). Null previous: none known. */
export function migrationsAfter(files, previous) {
  const m = previous ? MIGRATION.exec(previous) : null
  if (!m) return []
  return files.filter(f => Number(MIGRATION.exec(f)[1]) > Number(m[1]))
}

/**
 * The update and app keys of YubiKey `letter`, from the certificates' payloads
 * (root-signed, shared/release/certificates.ts): their ids and public keys.
 */
export function keysFor(letter, certificatePayloads) {
  const find = purpose => certificatePayloads.find(c => c.purpose === purpose && c.key_id.startsWith(`${purpose}-${letter}-`))
  const update = find('update')
  const app = find('app')
  if (!update || !app) return null
  return { update: { id: update.key_id, publicKey: update.public_key }, app: { id: app.key_id, publicKey: app.public_key } }
}

/** A certificate's payload, read without checking it (it is checked where it counts). */
export function certificatePayload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

/** Null when `next` may be published after `published` (a version, or nothing yet); else why not. */
export function versionProblem(published, next, compareVersions) {
  if (!published) return null
  if (compareVersions(next, published) <= 0) {
    return `the version must rise: ${published} is published, package.json says ${next}. Raise it (npm version patch --no-git-tag-version), commit, and build again`
  }
  return null
}

export function listDays(value) {
  const days = value === undefined ? LIST_DAYS : Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_LIST_DAYS) throw new Error(`--days must be a whole number from 1 to ${MAX_LIST_DAYS}`)
  return days
}

/**
 * The next list. What the previous list carried (database packages,
 * withdrawals, revocations) is kept: a list only grows (§5a).
 */
export function indexPayload({ keyId, serial, now, days, app, previous }) {
  return {
    v: 1,
    key_id: keyId,
    channel: 'stable',
    serial,
    generated_at: now.toISOString(),
    expires: new Date(now.getTime() + days * 86_400_000).toISOString(),
    versions: previous?.versions ?? [],
    withdrawn: previous?.withdrawn ?? [],
    revocations: previous?.revocations ?? [],
    app,
  }
}

/** The release statement the app key signs: this installer, for this clinic's build (its id). */
export function appPayload({ keyId, version, file, sha512, size, schema, now, build }) {
  if (!build || build === 'main') throw new Error('a clinic release names its clinic')
  return { v: 1, key_id: keyId, version, file, sha512, size, created_at: now.toISOString(), build, ...(schema ? { schema } : {}) }
}

/**
 * The gh commands that publish a release, in order: the installer first, then
 * the signed list, then latest.yml last, so no desktop is ever pointed at an
 * installer the list doesn't name yet.
 */
export function uploadPlan({ installer, blockmap, list, feed, repo }) {
  if (!repo) throw new Error('uploadPlan needs the clinic\'s repository')
  const up = files => ['release', 'upload', RELEASE_TAG, ...files, '--repo', repo, '--clobber']
  return [up(blockmap ? [installer, blockmap] : [installer]), up([list]), up([feed])]
}

export const releaseUrl = (repo, file) => `https://github.com/${repo}/releases/download/${RELEASE_TAG}/${file}`
