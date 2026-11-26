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
 * Test mode only (src/main/index.ts reads WIVO_TEST_PROFILE there and nowhere
 * else): the same test copy, the same refusals of any other project.
 * Its own Vite port is chosen by Vite when the first one is taken.
 */
import { spawn } from 'node:child_process'

const profile = process.argv[2] ?? '2'
if (!/^[A-Za-z0-9]{1,16}$/.test(profile)) {
  console.error(`Profile "${profile}": letters and digits only, at most 16.`)
  process.exit(1)
}

const child = spawn('npx', ['electron-vite', 'dev', '--mode', 'test'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, WIVO_TEST_PROFILE: profile },
})
child.on('exit', code => process.exit(code ?? 0))
