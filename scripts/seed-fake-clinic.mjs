#!/usr/bin/env node
/**
 * Fills an EMPTY Supabase project (every migration applied, nothing else in
 * it) with the fake clinic: sql/demo/fake-clinic.sql. docs/TEST-PROJECT.md.
 *
 *   node scripts/seed-fake-clinic.mjs
 *
 * Everything it needs is asked for, HIDDEN: the connection string, the
 * database password and the password the six fake accounts get. Never from an
 * argument, an environment variable or a file: a command line stays in the
 * shell's history, and PowerShell's history is a file on disk that nothing
 * clears.
 *
 * It refuses production, the test copy (real data) and every clinic's own
 * project by their ids (scripts/fake-project.mjs), and the SQL itself refuses
 * any database that already holds a clinic or a user that is not fake. It runs
 * in ONE transaction: all of it, or nothing.
 *
 * psql: from PSQL_PATH if set (a path, not a secret), else the Windows
 * default C:\Program Files\PostgreSQL\<newest>\bin\psql.exe, else `psql`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { psqlEnv, refOfConnection, refusedRef } from './fake-project.mjs'

const PLACEHOLDER = '<FAKE_' + 'PASSWORD>'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const ask = (question, hidden) => new Promise(resolve => {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  process.stderr.write(question)
  if (hidden) rl._writeToOutput = () => {}
  rl.question('', answer => {
    rl.close()
    if (hidden) process.stderr.write('\n')
    resolve(answer.trim())
  })
})

const stop = (why) => { console.error(`\nStopped: ${why}\nNothing was written.`); process.exit(2) }

function findPsql() {
  if (process.env.PSQL_PATH && existsSync(process.env.PSQL_PATH)) return process.env.PSQL_PATH
  const base = 'C:\\Program Files\\PostgreSQL'
  if (process.platform === 'win32' && existsSync(base)) {
    const versions = readdirSync(base).filter(v => /^\d+$/.test(v)).sort((a, b) => Number(b) - Number(a))
    for (const v of versions) {
      const p = join(base, v, 'bin', 'psql.exe')
      if (existsSync(p)) return p
    }
  }
  return 'psql'
}

console.error('Fake clinic for an EMPTY test project (docs/TEST-PROJECT.md).')
console.error('Dashboard → Connect → Session pooler. Paste the string (the password in it may be left out).')
const conn = await ask('Connection string (hidden): ', true)
const ref = refOfConnection(conn)
if (!ref) stop('the connection string does not name a Supabase project (postgres.<ref>@… or db.<ref>.supabase.co).')
const refused = refusedRef(ref)
if (refused) stop(`project ${ref}: ${refused}. Fake data goes only into a project of its own.`)

let dbPassword = ''
try { dbPassword = decodeURIComponent(new URL(conn).password) } catch { /* checked above */ }
if (!dbPassword) dbPassword = await ask('Database password (hidden): ', true)
if (!dbPassword) stop('no database password.')

const accounts = await ask('Password for the six fake accounts (hidden, at least 12 characters): ', true)
if (accounts.length < 12) stop(`that is ${accounts.length} characters; at least 12.`)
if (accounts === PLACEHOLDER) stop('that is the placeholder itself.')
if (/['\\]/.test(accounts)) stop("leave out ' and \\ (they would have to be escaped inside SQL).")
const again = await ask('The same password again (hidden): ', true)
if (again !== accounts) stop('the two passwords differ.')

const confirm = await ask(`\nProject ${ref}. Type its id to fill it with the fake clinic: `, false)
if (confirm !== ref) stop('the id typed is not the project\'s.')

const sqlText = readFileSync(join(ROOT, 'sql', 'demo', 'fake-clinic.sql'), 'utf8')
if (!sqlText.includes(PLACEHOLDER)) stop('sql/demo/fake-clinic.sql has no password placeholder any more.')
const sql = sqlText.replaceAll(PLACEHOLDER, accounts)

const psql = findPsql()
const child = spawn(psql, ['-X', '--no-psqlrc', '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-q'], {
  env: { ...process.env, ...psqlEnv(conn, dbPassword) },
  stdio: ['pipe', 'inherit', 'inherit'],
})
child.on('error', e => stop(`could not start psql (${psql}): ${e.message}. Set PSQL_PATH to psql.exe.`))
child.stdin.end(sql)
child.on('exit', code => {
  if (code === 0) {
    console.error('\nDone. Sign in as owner@fake.wivodent.com with the password you chose (docs/TEST-PROJECT.md, step 5).')
  } else {
    console.error('\npsql stopped with an error (above). In one transaction: nothing was written.')
  }
  process.exit(code ?? 1)
})
