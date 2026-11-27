/**
 * The version line (lib/buildInfo, scripts/build-commit.mjs): the version and
 * the build's short commit, shown under the Network, the phone's Settings and
 * beside the desktop's "What's new". Only shown, never compared.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { versionLine } from './buildInfo'
import { buildCommit } from '../../../../scripts/build-commit.mjs'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the version line', () => {
  it('"<product> · <version> · <commit>", a part left out when missing', () => {
    expect(versionLine('Wivo Network', '2.2.7', '7ca8c95')).toBe('Wivo Network · 2.2.7 · 7ca8c95')
    expect(versionLine(null, '2.2.7', '7ca8c95')).toBe('2.2.7 · 7ca8c95')
    expect(versionLine('Wivo', '2.2.7', '')).toBe('Wivo · 2.2.7')
  })

  it('the commit: the build’s own (GitHub Actions, Cloudflare Pages) or git; seven hex letters', () => {
    expect(buildCommit({ GITHUB_SHA: '7CA8C95F00D1234' })).toBe('7ca8c95')
    expect(buildCommit({ CF_PAGES_COMMIT_SHA: 'abcdef0123456789' })).toBe('abcdef0')
    expect(buildCommit({ VITE_APP_COMMIT: 'not a commit', GITHUB_SHA: '' })).toMatch(/^([0-9a-f]{7})?$/)
  })

  it('put in at build time for the desktop and the phone; shown in the Network, the phone’s Settings and the desktop', () => {
    for (const config of ['electron.vite.config.ts', 'vite.mobile.config.ts']) {
      expect(read(config)).toContain('process.env.VITE_APP_COMMIT = buildCommit()')
    }
    expect(read('src/renderer/src/mobile/network/NetworkApp.tsx')).toContain("versionLine('Wivo Network', __APP_VERSION__)")
    expect(read('src/renderer/src/mobile/MobileSettings.tsx')).toContain("versionLine('Wivo', __APP_VERSION__)")
    expect(read('src/renderer/src/components/Sidebar.tsx')).toContain('v{versionLine(null, running)}')
  })
})
