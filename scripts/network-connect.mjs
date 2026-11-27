#!/usr/bin/env node
/**
 * Connects one clinic to the Wivo Network, start to finish (docs/NETWORK-SETUP.md, B).
 *
 *   npm run network:connect -- --clinic dentiks            do it
 *   npm run network:connect -- --clinic dentiks --dry-run  only say what it would do (sends nothing)
 *
 * Other options: --rotate-key (a new clinic key even though one is there),
 * --skip-deploy (leave the Edge Functions as they are).
 *
 * Kevin runs it from his own computer. It reads clinics/<id>.json (the
 * clinic's project, name, city, country, phone address, organisation) and
 * network/config.json (the Network's project and its public key), and then,
 * each step only when it is not done yet, so a second run changes nothing:
 *
 *   a) the clinic's row in the Network's directory (its Network number and invite code);
 *   b) the clinic's own Ed25519 key: the public half into that row, the
 *      private half straight into the clinic project's secrets
 *      (NETWORK_CLINIC_KEY, with NETWORK_URL). Never on disk, never on screen;
 *   c) the Edge Functions on the clinic's project: network-client
 *      (--no-verify-jwt), network-directory, file-link;
 *   d) the Network's public key and the clinic's Network number into the
 *      clinic's network_settings. Orders stay OFF: the owner turns them on;
 *   e) the clinic's phone address /network among the Network's sign-in
 *      redirect addresses;
 *   f) a check of all of it, and a summary with the invite link.
 *
 * Everything goes through the Supabase Management API with Kevin's personal
 * access token (SUPABASE_ACCESS_TOKEN, or asked for, hidden); the functions
 * through the Supabase CLI with the same token in its environment. No
 * database password, no service key, no connection string.
 *
 * The work is in connectClinic(), with every outside call passed in, so
 * scripts/networkConnect.test.ts runs it against a fake API.
 */
import { webcrypto } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { stdin, stdout, argv, env, exit } from 'node:process'
import { loadClinic, cliOptions, PRODUCTION_REF, TEST_REF, clinicIds } from './clinic-config.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = 'https://api.supabase.com/v1'

export const FUNCTIONS = [
  { slug: 'network-client', verifyJwt: false },
  { slug: 'network-directory', verifyJwt: true },
  { slug: 'file-link', verifyJwt: true },
]
export const SECRET_KEY = 'NETWORK_CLINIC_KEY'
export const SECRET_URL = 'NETWORK_URL'

const REF = /^[a-z0-9]{20}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/

// ── Settings ────────────────────────────────────────────────────────────────

/**
 * network/config.json: the Network's project ref and its public key (both
 * public). `problem` says what is missing; the file is tracked and holds
 * nothing else.
 */
export function parseNetworkConfig(text, clinicRefs = []) {
  let c
  try { c = JSON.parse(text.replace(/^﻿/, '')) } catch { return { network: null, problem: 'network/config.json is not JSON' } }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { network: null, problem: 'network/config.json is not an object' }
  const extra = Object.keys(c).filter(k => k !== 'ref' && k !== 'publicKey')
  if (extra.length) return { network: null, problem: `network/config.json: ${extra.join(', ')} is not a setting (ref, publicKey)` }
  if (!c.ref) return { network: null, problem: 'network/config.json has no "ref" yet: the Network project (docs/NETWORK-SETUP.md, A1)' }
  if (!REF.test(c.ref)) return { network: null, problem: 'network/config.json "ref" must be 20 lowercase letters and digits' }
  if (c.ref === PRODUCTION_REF || c.ref === TEST_REF || clinicRefs.includes(c.ref)) {
    return { network: null, problem: 'network/config.json "ref" is production\'s, the test copy\'s or a clinic\'s project, not the Network\'s' }
  }
  if (!c.publicKey) return { network: null, problem: 'network/config.json has no "publicKey" yet: network-public-key.txt (docs/NETWORK-SETUP.md, A4)' }
  if (!PUBLIC_KEY.test(c.publicKey)) return { network: null, problem: 'network/config.json "publicKey" must be the 43 characters of network-public-key.txt' }
  return { network: { ref: c.ref, publicKey: c.publicKey, url: `https://${c.ref}.supabase.co` }, problem: null }
}

/** What the Network needs of a clinic, from clinics/<id>.json, or why it cannot have it. */
export function clinicProblem(clinic) {
  if (!clinic.orgId) return `clinics/${clinic.id}.json has no "orgId": the clinic's organisation (Settings → Licence → Organisation)`
  if (!clinic.country) return `clinics/${clinic.id}.json has no "country" (two letters, e.g. LV): the directory shows it`
  return null
}

// ── SQL, built only from checked values ─────────────────────────────────────

/** A SQL string literal. Every value is checked before; this is the second guard. */
export function lit(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return `'${String(v).replace(/'/g, "''")}'`
}

export const sql = {
  networkReady: () =>
    `select to_regclass('public.clinic') is not null as has_clinic,
            exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinic' and column_name = 'clinic_public_key') as has_key_column`,
  findClinic: apiUrl =>
    `select id, invite_code, name, city, country, clinic_public_key from public.clinic where api_url = ${lit(apiUrl)}`,
  insertClinic: c =>
    `insert into public.clinic (name, country, city, api_url, listed)
     values (${lit(c.name)}, ${lit(c.country)}, ${lit(c.city ?? null)}, ${lit(c.supabaseUrl)}, false)
     returning id, invite_code, name, city, country, clinic_public_key`,
  updateClinicPlace: (id, c) =>
    `update public.clinic set name = ${lit(c.name)}, country = ${lit(c.country)}, city = ${lit(c.city ?? null)} where id = ${lit(id)}`,
  setClinicKey: (id, publicKey) =>
    `update public.clinic set clinic_public_key = ${lit(publicKey)} where id = ${lit(id)}`,
  clinicReady: orgId =>
    `select to_regclass('public.network_settings') is not null as has_settings,
            exists (select 1 from public.clinics where id = ${lit(orgId)}) as has_org`,
  readSettings: orgId =>
    `select enabled, network_public_key, network_clinic_id from public.network_settings where org_id = ${lit(orgId)}`,
  // Orders are never turned on here: a new row starts off, an existing one keeps `enabled`.
  writeSettings: (orgId, publicKey, networkClinicId) =>
    `insert into public.network_settings (org_id, enabled, network_public_key, network_clinic_id, updated_at)
     values (${lit(orgId)}, false, ${lit(publicKey)}, ${lit(networkClinicId)}, now())
     on conflict (org_id) do update
        set network_public_key = excluded.network_public_key, network_clinic_id = excluded.network_clinic_id, updated_at = now()`,
}

/** The Network's redirect list with this address added, or null when it is there already. */
export function withRedirect(list, address) {
  const items = (list ?? '').split(',').map(s => s.trim()).filter(Boolean)
  if (items.includes(address)) return null
  return [...items, address].join(',')
}

/** A new key pair for the clinic, in memory only. */
export async function makeClinicKeys() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const priv = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64url')
  const pub = Buffer.from(await webcrypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')
  return { privateKey: priv, publicKey: pub }
}

// ── The work ────────────────────────────────────────────────────────────────

/**
 * @typedef {object} Deps
 * @property {(ref: string, query: string) => Promise<object[]>} query   SQL through the Management API
 * @property {(ref: string) => Promise<string[]>} secretNames
 * @property {(ref: string, secrets: {name: string, value: string}[]) => Promise<void>} setSecrets
 * @property {(ref: string) => Promise<{slug: string, verify_jwt: boolean}[]>} functions
 * @property {(ref: string, slug: string, verifyJwt: boolean) => Promise<void>} deploy
 * @property {(ref: string) => Promise<{uri_allow_list?: string}>} authConfig
 * @property {(ref: string, patch: object) => Promise<void>} patchAuthConfig
 * @property {() => Promise<{privateKey: string, publicKey: string}>} makeKeys
 * @property {(line: string) => void} log
 */

/**
 * Connect the clinic. Each step looks first and does only what is missing.
 * Returns what it did and what it found, for the summary and the tests.
 */
export async function connectClinic(clinic, network, deps, { rotateKey = false, skipDeploy = false } = {}) {
  const { log } = deps
  const did = []
  const phoneNetwork = `${clinic.phoneUrl}/network`

  // Both databases have what this needs, before anything is written.
  const [n] = await deps.query(network.ref, sql.networkReady())
  if (!n?.has_clinic || !n?.has_key_column) {
    throw new Error('The Network project lacks network/sql/001 or 002: apply them first (docs/NETWORK-SETUP.md, A3).')
  }
  const [k] = await deps.query(clinic.supabaseRef, sql.clinicReady(clinic.orgId))
  if (!k?.has_settings) throw new Error(`${clinic.name}'s project lacks sql/138 (network_settings): it arrives with the update; apply it first.`)
  if (!k?.has_org) throw new Error(`${clinic.name}'s project has no organisation ${clinic.orgId}: check orgId in clinics/${clinic.id}.json.`)

  // a) The directory row.
  log('a) The clinic in the Network directory')
  let [row] = await deps.query(network.ref, sql.findClinic(clinic.supabaseUrl))
  if (!row) {
    ;[row] = await deps.query(network.ref, sql.insertClinic(clinic))
    if (!row?.id) throw new Error('The Network did not return the new row.')
    did.push('directory row added')
    log(`   added: ${row.id}`)
  } else if (row.name !== clinic.name || (row.city ?? null) !== (clinic.city ?? null) || row.country !== clinic.country) {
    await deps.query(network.ref, sql.updateClinicPlace(row.id, clinic))
    did.push('directory name/city/country updated')
    log(`   there (${row.id}); name, city and country updated from clinics/${clinic.id}.json`)
  } else {
    log(`   there already: ${row.id}`)
  }
  if (!UUID.test(row.id) || !/^[a-z0-9]{12,40}$/.test(row.invite_code ?? '')) throw new Error('The Network row is not what it should be (id, invite code).')

  // b) The clinic's own key.
  log('b) The clinic\'s own key')
  const names = await deps.secretNames(clinic.supabaseRef)
  const hasKey = names.includes(SECRET_KEY) && !!row.clinic_public_key
  if (!hasKey || rotateKey) {
    const keys = await deps.makeKeys()
    await deps.setSecrets(clinic.supabaseRef, [
      { name: SECRET_KEY, value: keys.privateKey },
      { name: SECRET_URL, value: network.url },
    ])
    await deps.query(network.ref, sql.setClinicKey(row.id, keys.publicKey))
    did.push(rotateKey && names.includes(SECRET_KEY) ? 'clinic key replaced' : 'clinic key made')
    log('   made: the private half is in the clinic\'s secrets, the public half in the Network row')
  } else if (!names.includes(SECRET_URL)) {
    await deps.setSecrets(clinic.supabaseRef, [{ name: SECRET_URL, value: network.url }])
    did.push('NETWORK_URL set')
    log('   there already; NETWORK_URL added')
  } else {
    log('   there already')
  }

  // c) The Edge Functions.
  log('c) The Edge Functions')
  if (skipDeploy) log('   skipped (--skip-deploy)')
  else {
    for (const f of FUNCTIONS) {
      await deps.deploy(clinic.supabaseRef, f.slug, f.verifyJwt)
      log(`   ${f.slug} deployed${f.verifyJwt ? '' : ' (--no-verify-jwt)'}`)
    }
    did.push('functions deployed')
  }

  // d) The clinic's settings: the Network's key and the clinic's number. Orders stay as they are (off when new).
  log('d) The clinic\'s Network settings')
  const [s] = await deps.query(clinic.supabaseRef, sql.readSettings(clinic.orgId))
  if (!s || s.network_public_key !== network.publicKey || s.network_clinic_id !== row.id) {
    await deps.query(clinic.supabaseRef, sql.writeSettings(clinic.orgId, network.publicKey, row.id))
    did.push('clinic settings written')
    log(`   written; orders ${s?.enabled ? 'stay on' : 'stay off until the owner turns them on'}`)
  } else {
    log(`   there already; orders are ${s.enabled ? 'on' : 'off'}`)
  }

  // e) The phone address among the Network's sign-in redirects.
  log('e) The Network\'s sign-in redirects')
  const auth = await deps.authConfig(network.ref)
  const next = withRedirect(auth.uri_allow_list, phoneNetwork)
  if (next) {
    await deps.patchAuthConfig(network.ref, { uri_allow_list: next })
    did.push('redirect added')
    log(`   added ${phoneNetwork}`)
  } else {
    log(`   ${phoneNetwork} is there already`)
  }

  // f) Check all of it again, as it is now.
  log('f) Check')
  const problems = []
  const [after] = await deps.query(network.ref, sql.findClinic(clinic.supabaseUrl))
  if (!after?.clinic_public_key) problems.push('the Network row has no clinic key')
  const secretsNow = await deps.secretNames(clinic.supabaseRef)
  for (const name of [SECRET_KEY, SECRET_URL]) if (!secretsNow.includes(name)) problems.push(`the clinic's secret ${name} is missing`)
  const fns = await deps.functions(clinic.supabaseRef)
  for (const f of FUNCTIONS) {
    const there = fns.find(x => x.slug === f.slug)
    if (!there) problems.push(`the function ${f.slug} is not on the clinic's project`)
    else if (there.verify_jwt !== f.verifyJwt) problems.push(`${f.slug}: JWT check is ${there.verify_jwt ? 'on' : 'off'}, should be ${f.verifyJwt ? 'on' : 'off'}`)
  }
  const [settingsNow] = await deps.query(clinic.supabaseRef, sql.readSettings(clinic.orgId))
  if (settingsNow?.network_public_key !== network.publicKey || settingsNow?.network_clinic_id !== row.id) problems.push('the clinic\'s network_settings do not match')
  const authNow = await deps.authConfig(network.ref)
  if (withRedirect(authNow.uri_allow_list, phoneNetwork) !== null) problems.push(`${phoneNetwork} is not among the Network's redirects`)

  const inviteLink = `${clinic.phoneUrl}/network/join/${row.invite_code}`
  return { did, problems, networkClinicId: row.id, inviteLink, ordersOn: !!settingsNow?.enabled }
}

/** What a dry run prints: every step, the SQL it would send, no secret, nothing sent. */
export function dryRunPlan(clinic, network) {
  const fake = '00000000-0000-4000-8000-000000000000'
  return [
    `Dry run for ${clinic.name} (${clinic.supabaseRef}) → Network ${network.ref}. Nothing is sent.`,
    '',
    'Checks first:',
    `  [Network] ${sql.networkReady()}`,
    `  [${clinic.id}] ${sql.clinicReady(clinic.orgId)}`,
    'a) The directory row, if there is none:',
    `  [Network] ${sql.findClinic(clinic.supabaseUrl)}`,
    `  [Network] ${sql.insertClinic(clinic)}`,
    'b) The clinic key, if there is none (made in memory):',
    `  [${clinic.id}] secrets: ${SECRET_KEY}=<private key, never shown>, ${SECRET_URL}=${network.url}`,
    `  [Network] ${sql.setClinicKey('<network number>', '<public key>')}`,
    'c) Functions:',
    ...FUNCTIONS.map(f => `  npx supabase functions deploy ${f.slug}${f.verifyJwt ? '' : ' --no-verify-jwt'} --project-ref ${clinic.supabaseRef}`),
    'd) The clinic\'s settings (orders stay off):',
    `  [${clinic.id}] ${sql.writeSettings(clinic.orgId, network.publicKey, fake).replace(fake, '<network number>')}`,
    'e) Redirect:',
    `  [Network] auth uri_allow_list += ${clinic.phoneUrl}/network`,
    'f) Check everything and print the invite link.',
  ].join('\n')
}

// ── The Management API and the CLI ──────────────────────────────────────────

export function managementApi(tokenFor, fetchImpl = fetch) {
  async function call(ref, method, path, body) {
    const res = await fetchImpl(`${API}/projects/${ref}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokenFor(ref)}`, 'Content-Type': 'application/json', 'User-Agent': 'wivo-network-connect' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      const why = res.status === 401 || res.status === 403 ? 'the access token cannot reach this project' : text.slice(0, 300)
      throw new Error(`${method} ${path} on ${ref}: ${res.status} ${why}`)
    }
    return text ? JSON.parse(text) : null
  }
  return {
    query: async (ref, query) => (await call(ref, 'POST', '/database/query', { query })) ?? [],
    secretNames: async ref => ((await call(ref, 'GET', '/secrets')) ?? []).map(s => s.name),
    setSecrets: async (ref, secrets) => { await call(ref, 'POST', '/secrets', secrets) },
    functions: async ref => (await call(ref, 'GET', '/functions')) ?? [],
    authConfig: async ref => (await call(ref, 'GET', '/config/auth')) ?? {},
    patchAuthConfig: async (ref, patch) => { await call(ref, 'PATCH', '/config/auth', patch) },
  }
}

/** The CLI deploy; the token goes in its environment, never on its command line. */
export function deployWithCli(token) {
  return async (ref, slug, verifyJwt) => {
    if (!REF.test(ref) || !FUNCTIONS.some(f => f.slug === slug)) throw new Error('Refusing a deploy I did not plan.')
    const args = ['supabase', 'functions', 'deploy', slug, '--project-ref', ref, ...(verifyJwt ? [] : ['--no-verify-jwt'])]
    const win = process.platform === 'win32'
    // Windows: npx is npx.cmd, which Node starts only through a shell. Every argument is checked above.
    const r = spawnSync(win ? 'npx.cmd' : 'npx', args, { cwd: ROOT, stdio: 'inherit', shell: win, env: { ...env, SUPABASE_ACCESS_TOKEN: token } })
    if (r.status !== 0) throw new Error(`Deploying ${slug} failed (exit ${r.status}).`)
  }
}

const ask = (question, { secret = false } = {}) => new Promise(done => {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true })
  if (secret) { stdout.write(question); rl._writeToOutput = () => {} }
  rl.question(secret ? '' : question, answer => { rl.close(); if (secret) stdout.write('\n'); done(answer.trim()) })
})

// ── The command ─────────────────────────────────────────────────────────────

async function main() {
  const opts = cliOptions(argv.slice(2), env)
  const { clinic, problem } = loadClinic(ROOT, opts.flag('--clinic'))
  if (!clinic) { console.error(problem); exit(2) }
  const cp = clinicProblem(clinic)
  if (cp) { console.error(cp); exit(2) }
  const cfgPath = join(ROOT, 'network', 'config.json')
  if (!existsSync(cfgPath)) { console.error('network/config.json is missing'); exit(2) }
  const refs = clinicIds(ROOT).map(id => loadClinic(ROOT, id).clinic?.supabaseRef).filter(Boolean)
  const { network, problem: np } = parseNetworkConfig(readFileSync(cfgPath, 'utf8'), refs)
  if (!network) { console.error(np); exit(2) }

  if (opts.has('--dry-run')) { console.log(dryRunPlan(clinic, network)); return }

  const clinicToken = env.SUPABASE_ACCESS_TOKEN || await ask(`Supabase access token for ${clinic.name}'s project (hidden; Account → Access Tokens): `, { secret: true })
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(clinicToken)) { console.error('That is not a Supabase access token (sbp_…).'); exit(2) }
  const other = env.SUPABASE_NETWORK_ACCESS_TOKEN || await ask('Token for the Network project (hidden; Enter = the same token): ', { secret: true })
  const networkToken = other || clinicToken
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(networkToken)) { console.error('That is not a Supabase access token (sbp_…).'); exit(2) }

  const api = managementApi(ref => (ref === network.ref ? networkToken : clinicToken))
  const result = await connectClinic(clinic, network, {
    ...api,
    deploy: deployWithCli(clinicToken),
    makeKeys: makeClinicKeys,
    log: line => console.log(line),
  }, { rotateKey: opts.has('--rotate-key'), skipDeploy: opts.has('--skip-deploy') })

  console.log('')
  console.log(result.did.length ? `Done: ${result.did.join('; ')}.` : 'Nothing to do: everything was there already.')
  console.log(`Network number: ${result.networkClinicId}`)
  console.log(`Invite link:    ${result.inviteLink}`)
  console.log(`Orders:         ${result.ordersOn ? 'on' : 'off (the owner turns them on in Wivo → Orders)'}`)
  if (result.problems.length) {
    console.error(`\nNot right yet:\n  ${result.problems.join('\n  ')}`)
    exit(1)
  }
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`\n${e instanceof Error ? e.message : String(e)}`); exit(1) })
}
