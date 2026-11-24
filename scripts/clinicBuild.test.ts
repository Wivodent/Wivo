/**
 * A clinic's installer (clinics/<id>.json, scripts/clinic-config.mjs,
 * build-clinic.mjs, electron-builder.clinic.cjs; docs/RELEASE.md): what it
 * refuses before a build, and what it will not let into the app.
 */
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CLINIC_FIELDS, PRODUCTION_REF, TEST_REF, appUpdateYmlProblem, cliOptions, clinicFeed, clinicIds, forbiddenIn, loadClinic,
  parseClinic, parseClinicEnv, phoneBranchCommand, refOf, releaseSource,
// @ts-expect-error plain .mjs without types
} from './clinic-config.mjs'
import { MAIN_RELEASE_REPO, clinicReleaseSource, listAddress, updateSourcesFor } from '../shared/release/release'
import { feedUrlFor } from '../src/main/releaseCheck'

const REF = 'abcdefghijklmnopqrst'
const PHONE = 'https://wivo.dentiks.lv'
const SETTINGS = {
  id: 'dentiks', name: 'Dentiks', releasesRepo: 'SniperInSuit/wivo-dentiks-releases', phoneUrl: PHONE,
  supabaseRef: REF, cloudflareProject: 'wivo-dentiks', phoneBranch: 'riga',
}
const clinicWith = (over: Record<string, unknown> = {}) => parseClinic(JSON.stringify({ ...SETTINGS, ...over }), 'dentiks')
const CLINIC = clinicWith().clinic
const jwt = (payload: Record<string, unknown>) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig_nature`
const ANON = jwt({ iss: 'supabase', ref: REF, role: 'anon' })
const envFile = (key = ANON) => `VITE_SUPABASE_ANON_KEY=${key}\n`

describe('clinics/<id>.json', () => {
  it('every clinic file in the repository is right, and its id is its name', () => {
    const ids = clinicIds('.')
    expect(ids).toContain('dentiks')
    expect(readdirSync('clinics').filter(n => n.endsWith('.json')).length).toBe(ids.length)
    for (const id of ids) expect(loadClinic('.', id).problem, id).toBeNull()
  })

  it("Dentiks: its own releases repository, phone app, project and phone branch (named by the clinic, not the city)", () => {
    const { clinic } = loadClinic('.', 'dentiks')
    expect(clinic).toMatchObject({
      id: 'dentiks', releasesRepo: 'SniperInSuit/wivo-dentiks-releases', phoneUrl: 'https://wivo.dentiks.lv',
      cloudflareProject: 'wivo-dentiks', phoneBranch: 'riga', supabaseRef: 'fwsrnsdrlrlmjfkkkhvp',
    })
    expect(clinic.supabaseUrl).toBe('https://fwsrnsdrlrlmjfkkkhvp.supabase.co')
  })

  it('accepts the settings, and gives the project URL and the phone address without a trailing slash', () => {
    expect(clinicWith().problems).toEqual([])
    expect(clinicWith({ phoneUrl: `${PHONE}/` }).clinic.phoneUrl).toBe(PHONE)
    expect(CLINIC.supabaseUrl).toBe(`https://${REF}.supabase.co`)
  })

  it("refuses production's and the test copy's project, by their IDs", () => {
    expect(clinicWith({ supabaseRef: PRODUCTION_REF }).problems.join()).toContain('production')
    expect(clinicWith({ supabaseRef: TEST_REF }).problems.join()).toContain('test copy')
    expect(clinicWith({ supabaseRef: 'https://x.supabase.co' }).problems.join()).toContain('20 lowercase')
  })

  it("refuses main's repository, main or testing as the phone branch, and main as the id", () => {
    expect(clinicWith({ releasesRepo: MAIN_RELEASE_REPO }).problems.join()).toContain("main's repository")
    expect(clinicWith({ releasesRepo: 'sniperinsuit/wivo' }).problems.join()).toContain("main's repository")
    expect(clinicWith({ releasesRepo: 'https://github.com/x/y' }).problems.length).toBe(1)
    expect(clinicWith({ phoneBranch: 'main' }).problems.join()).toContain('may not be main')
    expect(clinicWith({ phoneBranch: 'testing' }).problems.join()).toContain('may not be testing')
    expect(parseClinic(JSON.stringify({ ...SETTINGS, id: 'main' }), 'main').problems.join()).toContain('not "main"')
  })

  it('refuses an id that is not the file name, an unknown setting, a missing one, and what is not JSON', () => {
    expect(parseClinic(JSON.stringify(SETTINGS), 'other').problems.join()).toContain('clinics/other.json')
    expect(clinicWith({ anonKey: ANON }).problems.join()).toContain('anonKey: not a clinic setting')
    const { name: _, ...noName } = SETTINGS
    expect(parseClinic(JSON.stringify(noName), 'dentiks').problems).toEqual(['name is missing'])
    expect(parseClinic('{', 'dentiks').problems).toEqual(['it is not JSON'])
    expect(CLINIC_FIELDS).toEqual([...Object.keys(SETTINGS), 'orgId'])
  })

  it('orgId is optional, and when given, a UUID (a delivered licence must name it, docs/RELEASE.md §7)', () => {
    expect(clinicWith().clinic?.orgId).toBeUndefined()
    expect(clinicWith({ orgId: '3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f' }).clinic?.orgId).toBe('3f1c2a9e-5b7d-4e2a-9c1f-0a1b2c3d4e5f')
    for (const orgId of ['', 'dentiks', 42, '3f1c2a9e5b7d4e2a9c1f0a1b2c3d4e5f']) {
      expect(clinicWith({ orgId }).problems, String(orgId)).toEqual(['orgId must be the UUID of the organisation (Settings → Licence → Organisation)'])
    }
  })

  it('the phone address: https and a host only, never a Supabase address', () => {
    expect(clinicWith({ phoneUrl: 'http://wivo.dentiks.lv' }).problems.length).toBe(1)
    expect(clinicWith({ phoneUrl: 'https://wivo-dentiks.pages.dev' }).problems).toEqual([]) // a pages.dev address is fine too
    expect(clinicWith({ phoneUrl: `${PHONE}/job/1` }).problems.length).toBe(1)
    expect(clinicWith({ phoneUrl: `https://${REF}.supabase.co` }).problems.join()).toContain('Supabase')
  })

  it('names what clinics there are when none, or an unknown one, is asked for', () => {
    expect(loadClinic('.', undefined).problem).toMatch(/--clinic <id> \(clinics: .*dentiks/)
    expect(loadClinic('.', 'riga').problem).toMatch(/no clinic "riga"/)
    expect(loadClinic('.', '../package').problem).toMatch(/no clinic/)
  })
})

describe('the clinic on the command line', () => {
  it('--clinic dentiks, or the same option as npm hands it on when PowerShell drops the --', () => {
    expect(cliOptions(['build', '--clinic', 'dentiks', '--first'], {}).flag('--clinic')).toBe('dentiks')
    const viaNpm = cliOptions(['build'], { npm_config_clinic: 'dentiks', npm_config_first: 'true', npm_config_migrations_applied: 'true' })
    expect(viaNpm.flag('--clinic')).toBe('dentiks')
    expect(viaNpm.has('--first')).toBe(true)
    expect(viaNpm.has('--migrations-applied')).toBe(true)
    expect(viaNpm.has('--refresh')).toBe(false)
    expect(cliOptions(['build', '--clinic'], {}).flag('--clinic')).toBeUndefined()
    expect(cliOptions(['build', '--clinic', '--first'], {}).flag('--clinic')).toBeUndefined()
  })
})

describe('clinics/<id>.env (the public key, not tracked)', () => {
  it("accepts the clinic's anon key and a publishable key", () => {
    expect(parseClinicEnv(envFile(), CLINIC)).toEqual({ key: ANON, problems: [] })
    expect(parseClinicEnv(envFile('sb_publishable_abc123_XYZ'), CLINIC).problems).toEqual([])
  })
  it('accepts a byte-order mark, CRLF and quotes; an older env file with the same URL and phone address', () => {
    const text = `﻿VITE_SUPABASE_URL="https://${REF}.supabase.co/"\r\nVITE_SUPABASE_ANON_KEY='${ANON}'\r\nVITE_PHONE_URL=${PHONE}/\r\n`
    expect(parseClinicEnv(text, CLINIC).problems).toEqual([])
  })
  it('refuses a URL or phone address that says something else than the clinic file', () => {
    expect(parseClinicEnv(`VITE_SUPABASE_URL=https://zzzzzzzzzzzzzzzzzzzz.supabase.co\n${envFile()}`, CLINIC).problems.join()).toContain('remove the line')
    expect(parseClinicEnv(`VITE_PHONE_URL=https://app.wivodent.com\n${envFile()}`, CLINIC).problems.join()).toContain('remove the line')
  })
  it('refuses a service_role key, a secret key and a key from another project', () => {
    expect(parseClinicEnv(envFile(jwt({ ref: REF, role: 'service_role' })), CLINIC).problems.join()).toContain('service_role')
    expect(parseClinicEnv(envFile('sb_secret_abcdefghijkl'), CLINIC).problems.length).toBeGreaterThan(0)
    expect(parseClinicEnv(envFile(jwt({ ref: 'zzzzzzzzzzzzzzzzzzzz', role: 'anon' })), CLINIC).problems.join()).toContain('another project')
  })
  it('refuses other names, duplicates and a missing key', () => {
    expect(parseClinicEnv(envFile() + 'RESEND_API_KEY=x\n', CLINIC).problems.join()).toContain('RESEND_API_KEY')
    expect(parseClinicEnv(envFile() + envFile(), CLINIC).problems.join()).toContain('twice')
    expect(parseClinicEnv('', CLINIC).problems).toEqual(['VITE_SUPABASE_ANON_KEY is missing'])
  })
  it('refuses a secret anywhere in the file, comments included', () => {
    for (const secret of ['sbp_0123456789abcdef', 're_AbCdEfGh1234', '-----BEGIN PRIVATE KEY-----', jwt({ role: 'service_role' })]) {
      expect(parseClinicEnv(`# ${secret}\n${envFile()}`, CLINIC).problems.length, secret).toBeGreaterThan(0)
    }
  })
  it('reads the project ref off a URL only when it is exactly one', () => {
    expect(refOf(`https://${REF}.supabase.co`)).toBe(REF)
    expect(refOf(`https://${REF}.supabase.co/rest/v1`)).toBeNull()
    expect(refOf('https://abc.supabase.co')).toBeNull()
  })
  it('hard-codes the same two IDs as the app', () => {
    const src = readFileSync('src/renderer/src/lib/testCopy.ts', 'utf8')
    expect(src).toContain(`PRODUCTION_REF = '${PRODUCTION_REF}'`)
    expect(src).toContain(`TEST_REF = '${TEST_REF}'`)
  })
})

describe('the built app', () => {
  it('may hold the public key and nothing like a secret', () => {
    expect(forbiddenIn(`var k="${ANON}"; var sr="service_role";`, ANON)).toEqual([])
  })
  it('may not hold another token, a secret key, an access token or a private key', () => {
    expect(forbiddenIn(jwt({ role: 'service_role' }), ANON).join()).toContain('service_role')
    expect(forbiddenIn(jwt({ role: 'anon', ref: 'zzzzzzzzzzzzzzzzzzzz' }), ANON).length).toBe(1)
    for (const s of ['sb_secret_abcdefghijkl', 'sbp_0123456789abcdef', 're_AbCdEfGh1234', '-----BEGIN RSA PRIVATE KEY-----']) {
      expect(forbiddenIn(`x="${s}"`, ANON).length, s).toBe(1)
    }
  })
})

describe('where the clinic\'s updates come from', () => {
  const FEED = 'https://github.com/SniperInSuit/wivo-dentiks-releases/releases/download/stable'
  it('its own repository\'s `stable` release: the same address for the tool, the installer and the app', () => {
    expect(clinicFeed(CLINIC)).toBe(FEED)
    expect(releaseSource(CLINIC)).toBe(clinicReleaseSource(CLINIC.releasesRepo))
    const sources = updateSourcesFor('dentiks', clinicReleaseSource(CLINIC.releasesRepo))
    expect(listAddress(sources[0], 'stable')).toBe(`${FEED}/updates.json`)
    expect(feedUrlFor('dentiks', clinicReleaseSource(CLINIC.releasesRepo))).toBe(FEED)
  })
  it("main reads nothing of a clinic's, a clinic nothing of main's, and a clinic build without its repository reads nothing", () => {
    expect(updateSourcesFor('main', clinicReleaseSource(CLINIC.releasesRepo))).not.toContain(releaseSource(CLINIC))
    expect(feedUrlFor('main', clinicReleaseSource(CLINIC.releasesRepo))).toBeNull()
    expect(clinicReleaseSource(MAIN_RELEASE_REPO)).toBeNull()
    expect(clinicReleaseSource('../x')).toBeNull()
    expect(clinicReleaseSource(undefined)).toBeNull()
    expect(updateSourcesFor('dentiks', null)).toEqual([])
    expect(feedUrlFor('dentiks', null)).toBeNull()
  })
})

describe('the packaging configuration', () => {
  process.env.WIVO_CLINIC = 'dentiks'
  const config = createRequire(import.meta.url)('./electron-builder.clinic.cjs') as {
    extraResources: { from: string }[]; directories: { output: string }; artifactName: string
    publish?: unknown; files: string[]; appId: string; productName: string
  }
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    build: { extraResources: { from: string }[]; directories: { output: string }; appId: string; productName: string }
  }
  it('ships no .env, keeps the teeth model, writes to dist-<id> and names the installer for the clinic', () => {
    expect(config.extraResources.map(r => r.from)).toEqual(['resources/teeth.glb'])
    expect(config.directories.output).toBe('dist-dentiks')
    expect(config.artifactName).toBe('Wivo-dentiks-Setup-${version}.${ext}')
    expect(config.files).toEqual(['out/**/*'])
  })
  it("keeps main's app identity, so an installed Wivo is updated in place", () => {
    expect(config.appId).toBe(pkg.build.appId)
    expect(config.productName).toBe(pkg.build.productName)
  })
  it("reads updates only from the clinic's own release, the address the app checks the signature against", () => {
    expect(config.publish).toEqual([{ provider: 'generic', url: clinicFeed(CLINIC) }])
  })
  it("the packaged app-update.yml is checked: the clinic's generic feed, never main's GitHub releases", () => {
    const feed = clinicFeed(CLINIC)
    expect(appUpdateYmlProblem(`provider: generic\nurl: ${feed}\nupdaterCacheDirName: wivo-updater\n`, feed)).toBeNull()
    expect(appUpdateYmlProblem('owner: SniperInSuit\nrepo: Wivo\nprovider: github\n', feed)).toMatch(/must never reach/)
    expect(appUpdateYmlProblem('provider: generic\nurl: https://example.com/stable\n', feed)).toMatch(/not https/)
    expect(appUpdateYmlProblem('', feed)).toMatch(/missing/)
  })
  it('refuses to load without a clinic', () => {
    const before = process.env.WIVO_CLINIC
    delete process.env.WIVO_CLINIC
    const path = createRequire(import.meta.url).resolve('./electron-builder.clinic.cjs')
    delete createRequire(import.meta.url).cache[path]
    try { expect(() => createRequire(import.meta.url)('./electron-builder.clinic.cjs')).toThrow(/WIVO_CLINIC/) } finally { process.env.WIVO_CLINIC = before }
  })
  it("leaves package.json (main's releases' configuration) as it is", () => {
    expect(pkg.build.extraResources.map(r => r.from)).toContain('.env')
    expect(pkg.build.directories.output).toBe('dist')
  })
  it('is run by a script that refuses to start without the checks', () => {
    const src = readFileSync('scripts/build-clinic.mjs', 'utf8')
    for (const needle of ["'testing'", 'loadClinic', 'parseClinicEnv', 'forbiddenIn', "'never'", "MAIN_VITE_SENTRY_DSN: ''",
      'phoneBranchCommand(fullCommit, clinic.phoneBranch)', 'MAIN_VITE_WIVO_BUILD: clinic.id', 'MAIN_VITE_WIVO_RELEASES_REPO: clinic.releasesRepo',
      'VITE_PHONE_URL: clinic.phoneUrl', 'VITE_SUPABASE_URL: clinic.supabaseUrl', 'appUpdateYmlProblem', 'WIVO_CLINIC: clinic.id']) expect(src).toContain(needle)
  })
})

describe("the clinic's phone branch", () => {
  it("is moved to the installer's full commit, never forced", () => {
    const sha = 'a'.repeat(40)
    expect(phoneBranchCommand(sha, 'riga')).toBe(`git push origin ${sha}:refs/heads/riga`)
    expect(phoneBranchCommand(sha, 'riga')).not.toMatch(/--force|-f\b|\+/)
  })
  it('refuses a short or odd commit, and main or testing as the branch', () => {
    expect(() => phoneBranchCommand('abc1234', 'riga')).toThrow()
    expect(() => phoneBranchCommand(`${'a'.repeat(40)} --force`, 'riga')).toThrow()
    expect(() => phoneBranchCommand('a'.repeat(40), 'main')).toThrow()
    expect(() => phoneBranchCommand('a'.repeat(40), 'testing')).toThrow()
    expect(() => phoneBranchCommand('a'.repeat(40), '+riga')).toThrow()
  })
})
