#!/usr/bin/env node
/**
 * A clinic's signed desktop releases (docs/RELEASE.md). The clinic is named
 * on every command and everything about it comes from clinics/<id>.json
 * (clinics/README.md): its releases repository, its build id, its phone
 * branch. Run by Kevin on his Windows machine, never in CI. Three steps, each
 * its own command:
 *
 *   npm run release -- --clinic dentiks            build the installer (scripts/build-clinic.mjs)
 *                                                  and releases/<id>/<version>/: the installer,
 *                                                  latest.yml, release.json. Nothing signed.
 *   npm run release:sign -- --clinic dentiks       YubiKey C (PIN once, two touches) signs the list
 *     [--yubikey D] [--days 30]                    and the release statement; both are checked with
 *                                                  the app's own code before updates.json is written.
 *   npm run release:publish -- --clinic dentiks    uploads them to the clinic's repository (gh, Kevin's
 *                                                  sign-in) and reads them back from the public address.
 *
 *   release:sign -- --clinic <id> --refresh        a new list for the published release (one touch)
 *   release:publish -- --clinic <id> --refresh     publishes that list
 *   release:publish -- --clinic <id> --check       only reads back what is published
 *
 * `--min-version x.y.z` on the build, or on sign (also with --refresh): the oldest
 *   desktop that may still save (docs/RELEASE.md §6a); `off` removes it. Not given:
 *   the published minimum stays.
 * `--first` on the build and sign steps: nothing is published yet.
 * `--release-version x.y.z` on sign and publish: another version than package.json's.
 * (In PowerShell npm may drop the `--`; the options still arrive, scripts/clinic-config.mjs cliOptions.)
 *
 * It reads no secret and holds none: the private keys stay on the YubiKeys,
 * and gh keeps its own sign-in. For the tests (scripts/releaseTool.test.ts),
 * and only when WIVO_YKMAN names a stand-in: WIVO_RELEASE_TEST_TRUST (made-up
 * roots and certificates), WIVO_RELEASE_FEED_DIR (a folder instead of the
 * network), WIVO_RELEASE_ROOT (instead of releases/<id>/), WIVO_GH (instead of gh).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { cliOptions, loadClinic, phoneBranchCommand } from './clinic-config.mjs'
import {
  RELEASE_TAG, SIGNERS, SLOTS, appPayload, certificatePayload, indexPayload, keysFor, latestYml,
  listDays, loadTs, migrationFiles, migrationsAfter, minVersionOption, minimumLine, nextMinimum, releaseUrl, uploadPlan,
  versionProblem,
} from './release-lib.mjs'
import { loadRelease } from './yubikey/load-release.mjs'
import { signStatements } from './yubikey/sign-statements.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TESTING = Boolean(process.env.WIVO_YKMAN) // the test hooks below count only with a stand-in ykman
const FEED_DIR = TESTING ? process.env.WIVO_RELEASE_FEED_DIR : undefined
const GH = (TESTING && process.env.WIVO_GH) || 'gh'

const fail = msg => { console.error(`\nRefused: ${msg}\n`); process.exit(1) }
const args = process.argv.slice(2)
const cmd = args[0]
const { has, flag } = cliOptions(args, process.env)

const { clinic, problem } = loadClinic(ROOT, flag('--clinic'))
if (problem) fail(problem)
/** The build id the release statement carries: the desktop installs only a release for its own. */
const BUILD = clinic.id
const REPO = clinic.releasesRepo
const NAME = clinic.name
const ON = `-- --clinic ${clinic.id}` // the clinic, as the next command names it
const RELEASES = (TESTING && process.env.WIVO_RELEASE_ROOT) || join(ROOT, 'releases', clinic.id)
const SHOWN = `releases/${clinic.id}` // RELEASES, as the messages show it

const R = await loadRelease()
const trust = TESTING && process.env.WIVO_RELEASE_TEST_TRUST
  ? JSON.parse(readFileSync(process.env.WIVO_RELEASE_TEST_TRUST, 'utf8'))
  : { roots: R.PINNED_ROOTS, certificates: [...(await loadTs(join(ROOT, 'shared/release/certificates.ts'))).ROOT_A_CERTIFICATES] }
const SOURCE = R.updateSourcesFor(BUILD, R.clinicReleaseSource(REPO))[0]
if (!SOURCE) fail(`clinics/${clinic.id}.json: releasesRepo "${REPO}" is not a clinic's releases repository`)

const pkgVersion = () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
const sha = (algo, bytes, enc) => createHash(algo).update(bytes).digest(enc)
const fileFacts = path => { const b = readFileSync(path); return { size: b.length, sha512: sha('sha512', b, 'base64'), sha256: sha('sha256', b, 'hex') } }

/** A published file (updates.json, latest.yml), or null when there is none. */
async function fetchPublished(name, maxBytes) {
  if (FEED_DIR) { const p = join(FEED_DIR, name); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null }
  return R.limitedFetcher(fetch)(`${SOURCE}/${RELEASE_TAG}/${name}`, maxBytes)
}

/** What is published now, each part checked against the pinned roots; null if nothing is. */
async function readPublished() {
  const bytes = await fetchPublished('updates.json', R.MAX_INDEX_BYTES * 2)
  if (!bytes) return null
  const list = R.parsePublishedList(bytes)
  if (!list) fail(`the published updates.json at ${SOURCE}/${RELEASE_TAG}/ is not a list. Stop and look at it before releasing.`)
  const t = await R.trustFrom(trust.roots, R.listedRevocations(list.index))
  const index = await R.checkSigned('index', list.index, list.certificates, t, new Date())
  if (!index.ok) fail(`the published list is not validly signed (${index.reason}). Stop: nothing should be published over it before you know why.`)
  let app = null
  if (list.app) {
    const a = await R.checkSigned('app', list.app, list.certificates, t, new Date())
    if (!a.ok) fail(`the published release statement is not validly signed (${a.reason}).`)
    app = a.payload
  }
  return { list, index: index.payload, indexSha: index.signedSha256, app }
}

const floorOf = published => (published ? { [published.index.key_id]: { serial: published.index.serial, sha256: published.indexSha } } : {})

/** The app's own check, on a list and an installer's bytes. */
async function appAccepts(list, version, facts, published) {
  return R.checkAppUpdate({
    list, version, sha512: facts.sha512, size: facts.size, pinned: trust.roots, now: new Date(), channel: 'stable',
    floor: floorOf(published), build: BUILD,
  })
}

function rawPublicKey(b64url) {
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(b64url, 'base64url')]), format: 'der', type: 'spki' })
}

/** Signs on the YubiKey and checks each signature against that key's certified public key. */
function signOnKey(letter, statements) {
  console.log(`\nYubiKey ${letter} (${SIGNERS[letter]}) signs ${statements.length === 1 ? 'one statement' : `${statements.length} statements`}: the PIN once, then touch the key each time it blinks.`)
  const r = signStatements({ serial: SIGNERS[letter], what: `Wivo for ${NAME}, signed by YubiKey ${letter}`, statements })
  if (!r.ok) fail(`${r.message} Nothing was written.`)
  for (const s of statements) {
    const sig = r.signatures.get(s.id)
    if (sig.length !== 64 || !nodeVerify(null, Buffer.from(s.bytes), rawPublicKey(s.publicKey), sig)) {
      fail(`the ${s.id} signature does not verify against ${s.keyId}'s public key (another key, or another slot?). Nothing was written.`)
    }
  }
  return r.signatures
}

function letterOf() {
  const letter = (flag('--yubikey') ?? 'C').toUpperCase()
  if (!SIGNERS[letter]) fail('--yubikey must be C or D (D is the spare)')
  const keys = keysFor(letter, trust.certificates.map(certificatePayload))
  if (!keys) fail(`no certificates for YubiKey ${letter}'s update and app keys`)
  return { letter, keys }
}

/** `--min-version`: undefined (keep the published one), null (off) or x.y.z. */
function askedMinimum() {
  try { return minVersionOption(flag('--min-version'), R.isVersion) } catch (e) { fail(e.message) }
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false // no one to answer: no
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try { return (await rl.question(question)).trim().toLowerCase() === 'yes' } finally { rl.close() }
}

const releaseDir = version => join(RELEASES, version)

// ─── build ────────────────────────────────────────────────────────────────────

async function build() {
  const version = pkgVersion()
  if (!R.isVersion(version)) fail(`package.json's version "${version}" is not x.y.z`)
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
  if (branch !== 'testing') fail(`the branch is "${branch}"; a clinic's releases are built from testing`)
  if (git('status', '--porcelain') !== '') fail('the working tree has changes; commit them first, so the release is a known commit')

  const published = await readPublished()
  if (!published && !has('--first')) fail(`nothing is published at ${SOURCE}/${RELEASE_TAG}/ (or it can't be reached). If this is the first release, run again with --first`)
  if (published && has('--first')) fail('--first, but a release is already published')
  const problem = versionProblem(published?.app?.version ?? null, version, R.compareVersions)
  if (problem) fail(problem)
  const asked = askedMinimum()
  let minimum
  try { minimum = nextMinimum({ asked, previous: published?.index, appVersion: version, compareVersions: R.compareVersions }) } catch (e) { fail(e.message) }

  console.log(`${NAME} release ${version} · ${REPO} · published now: ${published?.app?.version ?? 'nothing'}\n`)
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/build-clinic.mjs'), '--clinic', clinic.id], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) process.exit(r.status ?? 1)

  const file = `Wivo-${clinic.id}-Setup-${version}.exe`
  const exe = join(ROOT, `dist-${clinic.id}`, file)
  if (!existsSync(exe)) fail(`dist-${clinic.id}/${file} is missing after the build`)
  const facts = fileFacts(exe)
  const migrations = migrationFiles(readdirSync(join(ROOT, 'sql')))
  const schema = migrations[migrations.length - 1]
  const newMigrations = migrationsAfter(migrations, published?.app?.schema ?? null)

  const dir = releaseDir(version)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  copyFileSync(exe, join(dir, file))
  const blockmap = existsSync(`${exe}.blockmap`) ? `${file}.blockmap` : null
  if (blockmap) copyFileSync(`${exe}.blockmap`, join(dir, blockmap))
  writeFileSync(join(dir, 'latest.yml'), latestYml({ version, file, sha512: facts.sha512, size: facts.size, releaseDate: new Date().toISOString() }))
  writeFileSync(join(dir, 'release.json'), JSON.stringify({
    build: BUILD, version, file, blockmap, ...facts, commit: git('rev-parse', 'HEAD'), schema, new_migrations: newMigrations,
    ...(asked !== undefined ? { min_version: asked } : {}),
    first: !published, previous: published ? { version: published.app?.version ?? null, schema: published.app?.schema ?? null, serial: published.index.serial } : null,
    built_at: new Date().toISOString(),
  }, null, 2) + '\n')

  console.log(`\nRelease ${version} is ready to sign: ${SHOWN}/${version}/`)
  console.log(`  Installer: ${file}\n  SHA-256:   ${facts.sha256}`)
  console.log(`  Database:  this version expects ${schema}`)
  if (!published) console.log(`  First release: ${NAME}'s database must already be at that migration (its baseline). Settings → Database shows it.`)
  else if (newMigrations.length) console.log(`  NEW since ${published.app?.version}: ${newMigrations.join(', ')}\n  Run them in ${NAME}'s database BEFORE signing (docs/RELEASE.md §5).`)
  else console.log(`  No new migrations since ${published.app?.version}.`)
  console.log(`  ${minimumLine(minimum, published?.index)}`)
  console.log(`\nNext: npm run release:sign ${ON}   (YubiKey C)`)
}

// ─── sign ─────────────────────────────────────────────────────────────────────

async function sign() {
  const { letter, keys } = letterOf()
  let days
  try { days = listDays(flag('--days')) } catch (e) { fail(e.message) }
  const now = new Date()
  const published = await readPublished()

  if (has('--refresh')) {
    if (!published?.app || !published.list.app) fail('nothing is published to refresh')
    let minimum
    try { minimum = nextMinimum({ asked: askedMinimum(), previous: published.index, appVersion: published.app.version, compareVersions: R.compareVersions }) } catch (e) { fail(e.message) }
    const index = indexPayload({ keyId: keys.update.id, serial: published.index.serial + 1, now, days, app: published.index.app, previous: published.index, minVersion: minimum })
    const prep = await R.prepare('index', index)
    console.log(`A new list for the published release ${published.app.version}: serial ${index.serial}, expires ${index.expires}.`)
    console.log(minimumLine(minimum, published.index))
    const sigs = signOnKey(letter, [{ id: 'index', label: `The list, serial ${index.serial}, expires ${index.expires.slice(0, 10)}${minimum ? `, minimum ${minimum}` : ''} (update key)`, slot: SLOTS.update, bytes: prep.statement, publicKey: keys.update.publicKey, keyId: keys.update.id }])
    const list = { index: R.assemble('index', prep.payloadB64, sigs.get('index')), certificates: trust.certificates, app: published.list.app }
    const ok = await appAccepts(list, published.app.version, { sha512: published.app.sha512, size: published.app.size }, published)
    if (!ok.ok) fail(`the new list does not pass the app's check (${ok.reason}). Nothing was written.`)
    const dir = join(RELEASES, 'refresh')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'updates.json'), JSON.stringify(list, null, 2) + '\n')
    console.log(`\nSigned and checked: ${SHOWN}/refresh/updates.json\nNext: npm run release:publish ${ON} --refresh`)
    return
  }

  const version = flag('--release-version') ?? pkgVersion()
  const dir = releaseDir(version)
  if (!existsSync(join(dir, 'release.json'))) fail(`${SHOWN}/${version}/release.json is missing: run npm run release ${ON} first`)
  const rel = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'))
  if (rel.build !== BUILD) fail(`${SHOWN}/${version} was built for "${rel.build}", not ${BUILD}. Build again.`)
  const facts = fileFacts(join(dir, rel.file))
  if (facts.sha512 !== rel.sha512 || facts.size !== rel.size) fail(`${rel.file} has changed since it was built. Build again.`)
  if (!published && !rel.first) fail(`nothing is published at ${SOURCE}/${RELEASE_TAG}/ any more (or it can't be reached), but this release was built after one. Check the connection.`)
  if (published && rel.first) fail('built as the first release, but a release is published now. Build again.')
  const problem = versionProblem(published?.app?.version ?? null, version, R.compareVersions)
  if (problem) fail(problem)

  if (rel.new_migrations.length) {
    console.log(`\nThis release needs these migrations in ${NAME}'s database:\n  ${rel.new_migrations.join('\n  ')}`)
    if (!has('--migrations-applied') && !(await confirm(`Are they applied in ${NAME}'s database (after the test copy)? Type yes: `))) {
      fail("apply them first (docs/RELEASE.md §5). Nothing was signed.")
    }
  }

  // The minimum: --min-version here, else the one given to the build, else the published one.
  const asked = askedMinimum()
  let minimum
  try {
    minimum = nextMinimum({ asked: asked !== undefined ? asked : rel.min_version, previous: published?.index, appVersion: version, compareVersions: R.compareVersions })
  } catch (e) { fail(e.message) }

  const app = appPayload({ keyId: keys.app.id, version, file: rel.file, sha512: rel.sha512, size: rel.size, schema: rel.schema, now, build: BUILD })
  const index = indexPayload({
    keyId: keys.update.id, serial: (published?.index.serial ?? 0) + 1, now, days,
    app: { version, file: rel.file, sha512: rel.sha512, size: rel.size }, previous: published?.index, minVersion: minimum,
  })
  const pi = await R.prepare('index', index)
  const pa = await R.prepare('app', app)
  console.log(`\nWhat is signed:\n  Wivo ${version} for ${BUILD}, commit ${rel.commit.slice(0, 10)}\n  ${rel.file}, ${rel.size} bytes\n  SHA-256 ${rel.sha256}\n  list serial ${index.serial}, expires ${index.expires}\n  ${minimumLine(minimum, published?.index)}`)
  const sigs = signOnKey(letter, [
    { id: 'index', label: `The list, serial ${index.serial}, expires ${index.expires.slice(0, 10)}${minimum ? `, minimum ${minimum}` : ''} (update key)`, slot: SLOTS.update, bytes: pi.statement, publicKey: keys.update.publicKey, keyId: keys.update.id },
    { id: 'app', label: `Wivo ${version} for ${NAME}, the installer's hash (app key)`, slot: SLOTS.app, bytes: pa.statement, publicKey: keys.app.publicKey, keyId: keys.app.id },
  ])
  const list = {
    index: R.assemble('index', pi.payloadB64, sigs.get('index')),
    certificates: trust.certificates,
    app: R.assemble('app', pa.payloadB64, sigs.get('app')),
  }
  const ok = await appAccepts(list, version, facts, published)
  if (!ok.ok) fail(`the signed release does not pass the app's own check (${ok.reason}). Nothing was written.`)
  writeFileSync(join(dir, 'updates.json'), JSON.stringify(list, null, 2) + '\n')
  console.log(`\nSigned, and checked with the app's own code: ${SHOWN}/${version}/updates.json\nNext: npm run release:publish ${ON}`)
}

// ─── publish ──────────────────────────────────────────────────────────────────

function gh(argv, quiet = false) {
  const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(GH) ? [process.execPath, [GH]] : [GH, []]
  return spawnSync(cmd, [...pre, ...argv], { cwd: ROOT, stdio: quiet ? 'ignore' : 'inherit' })
}

async function readBack(files) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wrong = []
    for (const [name, path] of files) {
      const got = await fetchPublished(name, 2 * 1024 * 1024)
      if (!got || Buffer.compare(Buffer.from(got), readFileSync(path)) !== 0) wrong.push(name)
    }
    if (!wrong.length) return true
    if (attempt < 3) { console.log(`  not yet the same: ${wrong.join(', ')}; trying again in 20 s`); await new Promise(r => setTimeout(r, FEED_DIR ? 10 : 20_000)) }
    else console.error(`  still not the same: ${wrong.join(', ')}. GitHub may take a minute: npm run release:publish ${ON} --check`)
  }
  return false
}

async function publish() {
  const refresh = has('--refresh')
  const version = flag('--release-version') ?? pkgVersion()
  const dir = refresh ? join(RELEASES, 'refresh') : releaseDir(version)
  const list = join(dir, 'updates.json')
  if (!existsSync(list)) fail(`${SHOWN}/${refresh ? 'refresh' : version}/updates.json is missing: sign first`)
  const signed = R.parsePublishedList(new Uint8Array(readFileSync(list)))
  if (!signed) fail('updates.json is not a list')
  const published = await readPublished()

  let rel = null
  if (!refresh) {
    rel = JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8'))
    const facts = fileFacts(join(dir, rel.file))
    if (facts.sha512 !== rel.sha512) fail(`${rel.file} has changed since it was signed`)
    const already = published && published.list.index === signed.index
    if (has('--check')) {
      console.log((await readBack([['updates.json', list], ['latest.yml', join(dir, 'latest.yml')]])) ? 'Published, and the same as here.' : 'Not the same yet.')
      return
    }
    if (!already) {
      const ok = await appAccepts(signed, version, facts, published)
      if (!ok.ok) fail(`updates.json does not pass the app's own check (${ok.reason}): sign again`)
    }
  } else {
    if (!published?.app) fail('nothing is published to refresh')
    const ok = await appAccepts(signed, published.app.version, { sha512: published.app.sha512, size: published.app.size }, published)
    if (!ok.ok && !(published.list.index === signed.index)) fail(`the refreshed list does not pass the app's own check (${ok.reason})`)
  }

  if (gh(['--version'], true).status !== 0) fail('gh (GitHub CLI) is missing: winget install --id GitHub.cli -e, then gh auth login')
  if (gh(['release', 'view', RELEASE_TAG, '--repo', REPO], true).status !== 0) {
    console.log(`Creating the release "${RELEASE_TAG}" in ${REPO}…`)
    const c = gh(['release', 'create', RELEASE_TAG, '--repo', REPO, '--title', `Wivo for ${NAME}`,
      '--notes', `Signed desktop releases of Wivo for ${NAME}. The app installs them only after checking Wivo's signature.`, '--latest'])
    if (c.status !== 0) fail(`could not create the release. Does https://github.com/${REPO} exist, public, and is gh signed in (gh auth status)? docs/CLINIC-ROLLOUT.md`)
  }

  const plan = refresh
    ? [['release', 'upload', RELEASE_TAG, list, '--repo', REPO, '--clobber']]
    : uploadPlan({ installer: join(dir, rel.file), blockmap: rel.blockmap ? join(dir, rel.blockmap) : null, list, feed: join(dir, 'latest.yml'), repo: REPO })
  for (const argv of plan) {
    console.log(`gh ${argv.slice(0, 3).join(' ')} ${argv.slice(3, -3).map(p => p.split(/[\\/]/).pop()).join(' ')}`)
    if (gh(argv).status !== 0) fail('the upload stopped (above says why). Run the same command again: uploads replace what is there.')
  }

  console.log('\nReading it back from the public address…')
  const same = await readBack(refresh ? [['updates.json', list]] : [['updates.json', list], ['latest.yml', join(dir, 'latest.yml')]])
  if (!refresh) {
    console.log(`\n${same ? 'Published' : 'Uploaded'}: Wivo ${version} for ${NAME}.`)
    console.log(`  Installer: ${releaseUrl(REPO, rel.file)}\n  SHA-256:   ${rel.sha256}`)
    console.log(`\n${NAME}'s desktops find it within 30 minutes and install it at their next start.`)
    console.log(`${NAME}'s phone app (Cloudflare ${clinic.cloudflareProject}), from the same commit (push testing first):\n\n  ${phoneBranchCommand(rel.commit, clinic.phoneBranch)}\n`)
  } else console.log(same ? '\nThe new list is published.' : '\nUploaded; check again in a minute.')
  if (!same) process.exit(2)
}

if (cmd === 'build') await build()
else if (cmd === 'sign') await sign()
else if (cmd === 'publish') await publish()
else {
  console.log('Usage: npm run release -- --clinic <id> [--first --min-version x.y.z|off] | release:sign -- --clinic <id> [--yubikey D --days 30 --refresh --min-version x.y.z|off] | release:publish -- --clinic <id> [--refresh --check]')
  process.exit(1)
}
