// The short commit a build is made from, for the version line ("Wivo Network · 2.2.7 · 7ca8c95").
// Only shown, never compared: updates are checked by version (docs/RELEASE.md), not by this.
//
// From the build's own environment when it has one (GitHub Actions: GITHUB_SHA; Cloudflare Pages:
// CF_PAGES_COMMIT_SHA; or VITE_APP_COMMIT set by hand), else from git. Nothing at all ('') when neither
// is there: the line then shows the version alone.
import { execSync } from 'node:child_process'

export function buildCommit(env = process.env) {
  const given = env.VITE_APP_COMMIT || env.GITHUB_SHA || env.CF_PAGES_COMMIT_SHA || ''
  if (/^[0-9a-f]{7,40}$/i.test(given)) return given.slice(0, 7).toLowerCase()
  try {
    const out = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    return /^[0-9a-f]{7}$/i.test(out) ? out.toLowerCase() : ''
  } catch {
    return ''
  }
}
