/**
 * `make-license.mjs sign|renew … --publish --clinic <id>`: the licence goes
 * into the clinic's own releases (the `stable` release of clinics/<id>.json
 * releasesRepo) as licence.json, next to updates.json, and every desktop of
 * the clinic takes it at its next update check (docs/RELEASE.md §7).
 *
 * Before anything is uploaded, the token is judged with the app's own rules
 * (shared/license/published judgePublishedLicence, loaded from the
 * TypeScript): signed by a pinned licence key, this clinic's organisation
 * and address, issued later than the licence published now. What the app
 * would refuse is not published.
 *
 * gh does the upload with Kevin's own sign-in, as release:publish does. No
 * secret is read or held here. For the tests (scripts/makeLicense.test.ts),
 * and only when WIVO_YKMAN names a stand-in: WIVO_GH (instead of gh),
 * WIVO_RELEASE_FEED_DIR (a folder instead of the network), WIVO_RELEASE_ROOT
 * (instead of releases/<id>/), WIVO_CLINIC_ROOT (a folder with its own clinics/).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build } from 'esbuild'
import { RELEASE_TAG, loadClinic, releaseSource } from './clinic-config.mjs'

const TESTING = Boolean(process.env.WIVO_YKMAN)
const FEED_DIR = TESTING ? process.env.WIVO_RELEASE_FEED_DIR : undefined
const GH = (TESTING && process.env.WIVO_GH) || 'gh'

const fail = msg => { console.error(`\nNot published: ${msg}\n`); process.exit(1) }

/** shared/license/published.ts with its imports, for plain Node. */
async function loadShared(root) {
  const r = await build({
    entryPoints: [join(root, 'shared/license/published.ts')], bundle: true, write: false,
    format: 'esm', platform: 'neutral', target: 'node20', logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`)
}

/**
 * Before the key is asked to sign: the clinic, and that the licence is for it.
 * @returns the clinic (clinics/<id>.json)
 */
export function checkBeforeSigning(root, clinicId, payload) {
  const { clinic, problem } = loadClinic((TESTING && process.env.WIVO_CLINIC_ROOT) || root, clinicId)
  if (problem) fail(problem)
  if (!clinic.orgId) {
    fail(`clinics/${clinic.id}.json has no orgId. Add the clinic's organisation UUID (it is --org; Settings → Licence → Organisation shows it), so the tool and the app can check a licence is ${clinic.name}'s.`)
  }
  if (payload.v !== 2) fail('a v1 licence names no organisation, so the app would not take it from the updates. Paste it in Settings → Licence instead.')
  if (payload.org.toLowerCase() !== clinic.orgId.toLowerCase()) fail(`--org ${payload.org} is not ${clinic.name}'s organisation (${clinic.orgId}, clinics/${clinic.id}.json).`)
  if (!(payload.api ?? []).includes(clinic.supabaseUrl)) fail(`--api does not name ${clinic.name}'s database, ${clinic.supabaseUrl}: the app would refuse it.`)
  return clinic
}

function gh(argv, quiet = false) {
  const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(GH) ? [process.execPath, [GH]] : [GH, []]
  return spawnSync(cmd, [...pre, ...argv], { stdio: quiet ? 'ignore' : ['ignore', 2, 2] }) // stdout stays the token's
}

async function fetchPublished(clinic, maxBytes) {
  if (FEED_DIR) { const p = join(FEED_DIR, 'licence.json'); return existsSync(p) ? new Uint8Array(readFileSync(p)) : null }
  try {
    const res = await fetch(`${releaseSource(clinic)}/${RELEASE_TAG}/licence.json`, { redirect: 'follow', signal: AbortSignal.timeout(30_000) })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    return bytes.length <= maxBytes ? bytes : null
  } catch {
    return null
  }
}

/**
 * After signing: judge the token as the app will, then upload and read back.
 * @param {{ root: string, clinic: object, token: string, verify: (token: string) => object | null }} o
 *   verify: make-license.mjs's own check against the pinned licence keys (C, D)
 */
export async function publishLicence({ root, clinic, token, verify }) {
  const S = await loadShared(root)

  // What is published now: the app compares with the licence it has, and
  // this with the one every desktop will have had from here.
  const before = await fetchPublished(clinic, S.MAX_LICENCE_FILE_BYTES)
  const was = before && S.parseLicenceFile(before)
  const wasPayload = was && was.clinic === clinic.id ? verify(was.token) : null
  const current = wasPayload ? { token: was.token, payload: wasPayload } : null

  const text = S.licenceFileText(clinic.id, token)
  const judged = S.judgePublishedLicence({ file: text, build: clinic.id, org: clinic.orgId, api: clinic.supabaseUrl, current, verify })
  if (!judged.ok && judged.reason === 'same') {
    console.error(`
This licence is already published for ${clinic.name}: nothing to upload.
`)
    return
  }
  if (!judged.ok) {
    const extra = judged.reason === 'not_newer'
      ? ` The published one was issued ${current.payload.iat}; the app takes only a licence issued on a later day. For a fix on the same day, paste the new key in Settings → Licence.`
      : ''
    fail(`${S.REFUSAL_TEXT[judged.reason]} (${judged.reason}).${extra}`)
  }

  const dir = (TESTING && process.env.WIVO_RELEASE_ROOT) ? join(process.env.WIVO_RELEASE_ROOT, 'licence') : join(root, 'releases', clinic.id, 'licence')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'licence.json')
  writeFileSync(file, text)

  const repo = clinic.releasesRepo
  if (gh(['--version'], true).status !== 0) fail('gh (GitHub CLI) is missing: winget install --id GitHub.cli -e, then gh auth login')
  if (gh(['release', 'view', RELEASE_TAG, '--repo', repo], true).status !== 0) {
    fail(`${repo} has no release "${RELEASE_TAG}" yet: publish ${clinic.name}'s first release (npm run release:publish -- --clinic ${clinic.id}). The token above still works pasted in Settings → Licence.`)
  }
  console.error(`\nUploading licence.json to ${repo} (release ${RELEASE_TAG})…`)
  if (gh(['release', 'upload', RELEASE_TAG, file, '--repo', repo, '--clobber']).status !== 0) {
    fail('the upload stopped (above says why). Run the same command again: an upload replaces what is there.')
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const got = await fetchPublished(clinic, S.MAX_LICENCE_FILE_BYTES)
    if (got && Buffer.compare(Buffer.from(got), Buffer.from(text)) === 0) {
      console.error(`Published, and read back from the public address: ${clinic.name}'s licence until ${judged.payload.exp}.`)
      console.error(`${clinic.name}'s desktops (Wivo 2.0.7 or later) take it within 30 minutes; the owner sees "Licence updated".\n`)
      return
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, FEED_DIR ? 10 : 20_000))
  }
  console.error(`Uploaded, but the public address does not show it yet. GitHub may take a minute: ${releaseSource(clinic)}/${RELEASE_TAG}/licence.json\n`)
  process.exit(2)
}
