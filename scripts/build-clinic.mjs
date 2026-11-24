#!/usr/bin/env node
/**
 * A clinic's Windows installer (clinics/<id>.json, docs/RELEASE.md). Run on
 * Kevin's machine, never in CI:
 *
 *   npm run dist:clinic -- --clinic dentiks
 *
 * (npm run release -- --clinic <id> runs it, and then makes the release.)
 *
 * What it does, in order, and stops at the first refusal:
 *   1. branch is `testing`, working tree clean (so the installer is a known commit);
 *   2. reads clinics/<id>.json (the clinic's project, phone address, releases)
 *      and clinics/<id>.env (its public key), refuses production's and the
 *      test copy's project, a key that is not the public one, any secret;
 *   3. builds with those values in the PROCESS environment (they win over
 *      the root .env, which is not read for them and may hold production's),
 *      the other Wivo variables blanked, and no token from the environment
 *      passed on (nothing here talks to GitHub);
 *   4. scans the built app (out/) for a secret or a JWT that is not the key;
 *   5. packages with scripts/electron-builder.clinic.cjs: no `.env` resource,
 *      output in dist-<id>/, updates from the clinic's own release
 *      (docs/RELEASE.md), nothing published (`npm run release:publish`
 *      publishes, after signing);
 *   6. checks the package holds no .env and none of the above, and prints the
 *      installer's SHA-256 for the handover;
 *   7. prints the command that moves the clinic's phone branch (its
 *      Cloudflare Pages project) to the same commit. It does not run it.
 *
 * It sends nothing anywhere and reads no secret: the env file holds only what
 * ships in every phone's bundle anyway.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appUpdateYmlProblem, cliOptions, clinicFeed, forbiddenIn, loadClinic, parseClinicEnv, phoneBranchCommand } from './clinic-config.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const fail = (msg) => { console.error(`\nRefused: ${msg}\n`); process.exit(1) }

const { clinic, problem } = loadClinic(ROOT, cliOptions(process.argv.slice(2), process.env).flag('--clinic'))
if (problem) fail(problem)
const OUT = `dist-${clinic.id}`
const FEED = clinicFeed(clinic)
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
const run = (script, args, env) => execFileSync(process.execPath, [join(ROOT, script), ...args], { cwd: ROOT, env, stdio: 'inherit' })

/** Every file under `dir` up to `maxBytes`, as [path, latin1 text]. */
function* filesIn(dir, maxBytes) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) yield* filesIn(p, maxBytes)
    else if (st.size <= maxBytes) yield [p, readFileSync(p, 'latin1')]
  }
}

function scan(dir, key, maxBytes) {
  const bad = []
  let n = 0
  for (const [p, text] of filesIn(dir, maxBytes)) {
    n++
    for (const what of forbiddenIn(text, key)) bad.push(`${p}: ${what}`)
  }
  if (bad.length) fail(`the build holds what it may not:\n  ${bad.join('\n  ')}`)
  console.log(`  scanned ${n} files in ${dir}: no secret, no other token`)
}

function findEnvFiles(dir) {
  const hits = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) hits.push(...findEnvFiles(p))
    else if (name === '.env' || name.startsWith('.env.')) hits.push(p)
  }
  return hits
}

// 1. a known commit
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'testing') fail(`the branch is "${branch}"; the installer is built from testing`)
if (git('status', '--porcelain') !== '') fail('the working tree has changes; commit or stash them first, so the installer is a known commit')
const commit = git('rev-parse', '--short', 'HEAD')
const fullCommit = git('rev-parse', 'HEAD')

// 2. the public values
const envName = `clinics/${clinic.id}.env`
const envPath = join(ROOT, envName)
if (!existsSync(envPath)) fail(`${envName} is missing: one line, VITE_SUPABASE_ANON_KEY=<the project's public key> (clinics/README.md)`)
const clinicEnv = parseClinicEnv(readFileSync(envPath, 'utf8'), clinic)
if (clinicEnv.problems.length) fail(`${envName}:\n  ${clinicEnv.problems.join('\n  ')}`)
console.log(`${clinic.name}: project ${clinic.supabaseRef} · phone ${clinic.phoneUrl} · updates ${FEED} · commit ${commit}`)
if (!clinic.orgId) console.log(`Note: clinics/${clinic.id}.json has no orgId, so a machine with no licence yet takes no licence from the updates (docs/RELEASE.md §7).`)

// 3. the build, with a clean environment
const env = {}
for (const [name, value] of Object.entries(process.env)) {
  if (/token|secret|password|passwd|credential|api_?key/i.test(name)) continue // GH_TOKEN and the like: not passed on
  if (name.startsWith('VITE_') || name.startsWith('MAIN_VITE_') || name.startsWith('RENDERER_VITE_') || name.startsWith('PRELOAD_VITE_')) continue
  env[name] = value
}
Object.assign(env, {
  VITE_SUPABASE_URL: clinic.supabaseUrl,
  VITE_SUPABASE_ANON_KEY: clinicEnv.key,
  VITE_PHONE_URL: clinic.phoneUrl, // "What's new" names the clinic's phone app, not app.wivodent.com
  // The clinic's build: reads its updates only from its own releases, and
  // installs only a release signed for its id (docs/RELEASE.md, src/main/releaseCheck.ts)
  MAIN_VITE_WIVO_BUILD: clinic.id,
  MAIN_VITE_WIVO_RELEASES_REPO: clinic.releasesRepo,
  // A licence delivered with the updates must name these (src/main/licenceDelivery.ts)
  MAIN_VITE_WIVO_API: clinic.supabaseUrl,
  MAIN_VITE_WIVO_ORG: clinic.orgId ?? '',
  MAIN_VITE_SENTRY_DSN: '', // a clinic's errors do not go to a project of Tallinn's
  WIVO_CLINIC: clinic.id, // for scripts/electron-builder.clinic.cjs
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  WIN_CSC_LINK: '',
})
console.log('\nBuilding the app…')
run('node_modules/electron-vite/bin/electron-vite.js', ['build'], env)

// 4. scan the build
console.log('\nChecking the build…')
scan(join(ROOT, 'out'), clinicEnv.key, 50_000_000)

// 5. package (an installer of an earlier version left in dist-<id>/ is removed first)
rmSync(join(ROOT, OUT), { recursive: true, force: true })
console.log('\nPackaging…')
run('node_modules/electron-builder/cli.js',
  ['--win', '--x64', '--publish', 'never', '--config', 'scripts/electron-builder.clinic.cjs', '--config.forceCodeSigning=false'], env)

// 6. check the package
console.log('\nChecking the package…')
const unpacked = join(ROOT, OUT, 'win-unpacked')
if (!existsSync(unpacked)) fail(`${OUT}/win-unpacked is missing, so the package cannot be checked`)
const envFiles = findEnvFiles(unpacked)
if (envFiles.length) fail(`the package holds an env file:\n  ${envFiles.join('\n  ')}`)
console.log('  no .env in the package')
const feedFile = join(unpacked, 'resources', 'app-update.yml')
const feedProblem = appUpdateYmlProblem(existsSync(feedFile) ? readFileSync(feedFile, 'utf8') : '', FEED)
if (feedProblem) fail(`resources/app-update.yml: ${feedProblem}`)
console.log(`  updates from ${clinic.name}'s own release only (app-update.yml)`)
scan(join(unpacked, 'resources'), clinicEnv.key, 50_000_000)

const exes = readdirSync(join(ROOT, OUT)).filter(f => f.startsWith(`Wivo-${clinic.id}-Setup-`) && f.endsWith('.exe'))
if (exes.length !== 1) fail(`expected one installer in ${OUT}/, found ${exes.length}`)
const sha = createHash('sha256').update(readFileSync(join(ROOT, OUT, exes[0]))).digest('hex')
console.log(`\nDone.\n  Installer: ${OUT}/${exes[0]}\n  Commit:    ${commit}\n  Project:   ${clinic.supabaseRef}\n  SHA-256:   ${sha}\n`)
console.log('Send the SHA-256 by another channel than the installer. Windows will warn that the file is unsigned: that is expected.')

// 7. the phone app, from the same commit
let pushed = false
try { execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/testing'], { cwd: ROOT }); pushed = true } catch { /* not pushed, or no origin/testing */ }
console.log(`\n${clinic.name}'s phone app (Cloudflare ${clinic.cloudflareProject} builds the ${clinic.phoneBranch} branch). When you hand over this installer, move it to the same commit:\n\n  ${phoneBranchCommand(fullCommit, clinic.phoneBranch)}\n`)
if (!pushed) console.log('First push testing: this commit is not on origin/testing yet.')
