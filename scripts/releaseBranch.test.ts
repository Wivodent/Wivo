/**
 * Which branch a clinic's release may be built from (scripts/release-lib.mjs
 * releaseBranchProblem, docs/RELEASE.md §1): testing as always, and a
 * hotfix branch hotfix-X.Y.Z only when its name is the version, it contains
 * the published release's commit, the version is above the published one and
 * the tree is clean. Each refusal says why.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error plain .mjs without types
import { HOTFIX_BRANCH, releaseBranchProblem } from './release-lib.mjs'
import { compareVersions } from '../shared/release/release'

const PUBLISHED_COMMIT = 'c5f07524fb8a82666189304361a070ed2de40a98'
const ok = {
  branch: 'hotfix-2.2.6', version: '2.2.6', clean: true, published: '2.2.5',
  publishedCommit: PUBLISHED_COMMIT, containsPublished: true, compareVersions,
}
const problem = (over: Partial<typeof ok> & Record<string, unknown> = {}): string | null => releaseBranchProblem({ ...ok, ...over })

describe('a clinic release from a hotfix branch', () => {
  it('is allowed when all four hold', () => {
    expect(problem()).toBeNull()
  })

  it('(1) the branch name must be package.json\'s version', () => {
    expect(problem({ version: '2.2.7' })).toMatch(/hotfix-2\.2\.6 but package\.json says 2\.2\.7/)
    expect(problem({ branch: 'hotfix-2.2' })).toMatch(/built from testing, or from a hotfix branch/)
    expect(problem({ branch: 'hotfix-v2.2.6' })).toMatch(/built from testing, or from a hotfix branch/)
  })

  it('(2) the branch must contain the published release\'s commit, and that commit must be known', () => {
    expect(problem({ containsPublished: false })).toMatch(/does not contain c5f07524fb, the commit 2\.2\.5 was built from/)
    expect(problem({ publishedCommit: null, containsPublished: false })).toMatch(/cannot tell which commit 2\.2\.5 was built from/)
  })

  it('(3) the version must be above the published one; nothing published: no hotfix', () => {
    expect(problem({ branch: 'hotfix-2.2.5', version: '2.2.5' })).toMatch(/2\.2\.5 is already published/)
    expect(problem({ branch: 'hotfix-2.2.4', version: '2.2.4' })).toMatch(/already published/)
    expect(problem({ published: null, publishedCommit: null })).toMatch(/nothing is published yet/)
  })

  it('(4) the tree must be clean', () => {
    expect(problem({ clean: false })).toMatch(/working tree has changes/)
  })
})

describe('the other branches', () => {
  it('testing: as before, a clean tree is all it needs', () => {
    expect(problem({ branch: 'testing', published: '2.2.5', containsPublished: false, publishedCommit: null })).toBeNull()
    expect(problem({ branch: 'testing', clean: false })).toMatch(/working tree has changes/)
  })

  it('any other branch is refused, naming the two allowed', () => {
    for (const branch of ['main', 'riga', 'release-2.2.6', 'feature-x', 'HEAD']) {
      expect(problem({ branch })).toMatch(/built from testing, or from a hotfix branch hotfix-X\.Y\.Z/)
    }
  })

  it('the hotfix pattern takes exactly hotfix-X.Y.Z', () => {
    expect(HOTFIX_BRANCH.exec('hotfix-2.2.6')?.[1]).toBe('2.2.6')
    expect(HOTFIX_BRANCH.exec('hotfix-2.2.11')?.[1]).toBe('2.2.11')
    expect(HOTFIX_BRANCH.test('hotfix-2.2.6-b')).toBe(false)
    expect(HOTFIX_BRANCH.test('xhotfix-2.2.6')).toBe(false)
  })
})

describe('"contains the published commit" is git\'s own answer', () => {
  it('release.mjs asks git merge-base --is-ancestor, with the commit from the published version\'s release.json', () => {
    const src = readFileSync(join(__dirname, 'release.mjs'), 'utf8')
    expect(src).toMatch(/'merge-base', '--is-ancestor', publishedCommit, 'HEAD'/)
    expect(src).toMatch(/releaseBranchProblem\(\{/)
    expect(src).not.toMatch(/if \(branch !== 'testing'\)/)
  })

  it('on a real repository: a branch from the published commit contains it, one from before it does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wivo-hotfix-'))
    const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
    g('init', '-q', '-b', 'testing')
    g('config', 'user.email', 'test@example.invalid'); g('config', 'user.name', 'Test')
    writeFileSync(join(dir, 'f'), '1'); g('add', 'f'); g('commit', '-q', '-m', 'one')
    const before = g('rev-parse', 'HEAD')
    writeFileSync(join(dir, 'f'), '2'); g('commit', '-q', '-am', 'published')
    const published = g('rev-parse', 'HEAD')
    g('switch', '-q', '-c', 'hotfix-2.2.6')
    writeFileSync(join(dir, 'f'), '3'); g('commit', '-q', '-am', 'fix')
    const isAncestor = (c: string) => { try { g('merge-base', '--is-ancestor', c, 'HEAD'); return true } catch { return false } }
    expect(isAncestor(published)).toBe(true)
    g('switch', '-q', '-c', 'hotfix-old', before)
    expect(isAncestor(published)).toBe(false)
  })
})

describe('the installer build (build-clinic.mjs) applies the same rule', () => {
  // @ts-expect-error plain .mjs without types
  const lib = import('./release-lib.mjs') as Promise<{ latestLocalRelease: (dir: string, o?: object) => { version: string; commit: string | null } | null; compareXyz: (a: string, b: string) => number }>
  const C = (n: number) => String(n).repeat(40).slice(0, 40)
  const files: Record<string, string> = {
    'r/2.2.4/release.json': JSON.stringify({ version: '2.2.4', commit: C(4) }),
    'r/2.2.10/release.json': JSON.stringify({ version: '2.2.10', commit: C(1) }),
    'r/2.2.5/release.json': JSON.stringify({ version: '2.2.5', commit: C(5) }),
  }
  const read = (p: string) => { const k = p.split(String.fromCharCode(92)).join('/'); if (!(k in files)) throw new Error('missing'); return files[k] }
  const list = () => ['2.2.4', '2.2.5', '2.2.10', 'licence']

  it('takes the newest release this machine built below the version being built', async () => {
    const { latestLocalRelease } = await lib
    expect(latestLocalRelease('r', { read, list })).toEqual({ version: '2.2.10', commit: C(1) })
    expect(latestLocalRelease('r', { read, list, below: '2.2.6' })).toEqual({ version: '2.2.5', commit: C(5) })
    // A rebuild of 2.2.5 does not count its own earlier build.
    expect(latestLocalRelease('r', { read, list, below: '2.2.5' })).toEqual({ version: '2.2.4', commit: C(4) })
    expect(latestLocalRelease('nowhere', { list: () => { throw new Error('no dir') } })).toBeNull()
  })

  it('compares versions as numbers (2.2.10 is above 2.2.9)', async () => {
    const { compareXyz } = await lib
    expect(compareXyz('2.2.10', '2.2.9')).toBeGreaterThan(0)
    expect(compareXyz('2.2.6', '2.2.6')).toBe(0)
    expect(compareXyz('2.1.9', '2.2.0')).toBeLessThan(0)
  })

  it('build-clinic.mjs asks releaseBranchProblem, not "testing only"', () => {
    const src = readFileSync(join(__dirname, 'build-clinic.mjs'), 'utf8')
    expect(src).toMatch(/releaseBranchProblem\(\{/)
    expect(src).toMatch(/latestLocalRelease\(join\(ROOT, 'releases', clinic\.id\), \{ below: version \}\)/)
    expect(src).not.toMatch(/the installer is built from testing/)
  })
})
