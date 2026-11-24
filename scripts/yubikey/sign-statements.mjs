/**
 * Ask a YubiKey to sign statements, through Yubico's `ykman script` and
 * setup-device.py `sign`: the PIN once (hidden), then a touch for each. Used by
 * scripts/make-license.mjs and scripts/release.mjs. Works the same on
 * Windows and on a Mac: the only outside program is ykman.
 *
 * `WIVO_YKMAN` names another program: a full path to ykman when it is not on
 * PATH, or, in the tests, a stand-in script (.mjs/.js, run with this Node,
 * because Windows cannot run a script file directly).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const INSTALL_YKMAN = 'Install it: on Windows `winget install --id Yubico.YubiKeyManagerCLI -e` (then a new PowerShell window), on a Mac `brew install ykman`.'

/** The program and the arguments before ykman's own. */
export function ykmanCommand(env = process.env) {
  const ykman = env.WIVO_YKMAN || 'ykman'
  return /\.(mjs|cjs|js)$/i.test(ykman) ? [process.execPath, [ykman]] : [ykman, []]
}

/**
 * @param {{ serial: number, what: string, statements: { id: string, label: string, slot: string, bytes: Uint8Array }[] }} job
 * @returns {{ ok: true, signatures: Map<string, Buffer> } | { ok: false, message: string }}
 *   ok only when every statement was signed.
 */
export function signStatements(job) {
  const dir = mkdtempSync(join(tmpdir(), 'wivo-yubikey-sign-'))
  try {
    const inFile = join(dir, 'in.json')
    const outFile = join(dir, 'out.json')
    writeFileSync(inFile, JSON.stringify({
      what: job.what,
      statements: job.statements.map(s => ({ id: s.id, label: s.label, slot: s.slot, hex: Buffer.from(s.bytes).toString('hex') })),
    }))
    writeFileSync(outFile, '{}')
    const [cmd, pre] = ykmanCommand()
    const r = spawnSync(cmd, [...pre, 'script', '--force', join(here, 'setup-device.py'), 'sign', String(job.serial), inFile, outFile],
      { stdio: ['inherit', 2, 'inherit'] }) // the key's prompts go to stderr; stdout stays the tool's
    if (r.error) return { ok: false, message: `Could not run ykman (${r.error.message}). ${INSTALL_YKMAN}` }
    if (r.status !== 0) return { ok: false, message: 'The YubiKey did not sign (above says why).' }
    let out
    try { out = JSON.parse(readFileSync(outFile, 'utf8')) } catch { out = {} }
    const signatures = new Map()
    for (const s of out.signed ?? []) if (s && typeof s.id === 'string' && typeof s.signature_hex === 'string') signatures.set(s.id, Buffer.from(s.signature_hex, 'hex'))
    const missing = job.statements.filter(s => !signatures.has(s.id))
    if (missing.length) return { ok: false, message: `The YubiKey did not sign ${missing.map(s => s.id).join(', ')} (not touched in time?).` }
    return { ok: true, signatures }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
