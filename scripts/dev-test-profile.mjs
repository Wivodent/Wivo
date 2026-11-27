#!/usr/bin/env node
/**
 * A second test window beside `npm run dev:test`, with its own userData
 * folder (sign-in, settings, lock), to try two people changing the same
 * thing at once:
 *
 *   npm run dev:test        → %APPDATA%/wivo-test-copy      (first person)
 *   npm run dev:test:2      → %APPDATA%/wivo-test-copy-2    (second person)
 *   node scripts/dev-test-profile.mjs 3   → …-test-copy-3, and so on
 *
 * `--fake`: the same, against one's own project of FAKE data instead of the
 * test copy (config/test-fake.env, docs/TEST-PROJECT.md):
 *
 *   npm run dev:fake        → %APPDATA%/wivo-test-fake
 *   npm run dev:fake:2      → %APPDATA%/wivo-test-fake-2
 *
 * Test mode only (src/main/index.ts reads WIVO_TEST_PROFILE and
 * WIVO_TEST_TARGET there and nowhere else): the same refusals of production
 * and of any other project. Its own Vite port is chosen by Vite when the
 * first one is taken.
 */
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const fake = args.includes('--fake')
const profile = args.filter(a => a !== '--fake')[0] ?? (fake ? '' : '2')
if (profile !== '' && !/^[A-Za-z0-9]{1,16}$/.test(profile)) {
  console.error(`Profile "${profile}": letters and digits only, at most 16.`)
  process.exit(1)
}

const env = { ...process.env, WIVO_TEST_PROFILE: profile }
if (fake) env.WIVO_TEST_TARGET = 'fake'
else delete env.WIVO_TEST_TARGET
const child = spawn('npx', ['electron-vite', 'dev', '--mode', 'test'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
})
child.on('exit', code => process.exit(code ?? 0))
