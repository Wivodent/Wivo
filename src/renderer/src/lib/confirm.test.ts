import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirmDialog, currentConfirm, answerConfirm, registerConfirmHost } from './confirm'

describe('Wivo\'s own confirmation dialog', () => {
  it('without a host on screen the answer is no, so nothing irreversible happens', async () => {
    expect(await confirmDialog({ message: 'Delete?' })).toBe(false)
  })

  it('yes and no come back to the caller', async () => {
    const release = registerConfirmHost()
    const a = confirmDialog({ message: 'Delete?', danger: true })
    expect(currentConfirm()).toMatchObject({ message: 'Delete?', danger: true })
    answerConfirm(true)
    expect(await a).toBe(true)
    const b = confirmDialog({ message: 'Stop notifications to this phone?' })
    answerConfirm(false)
    expect(await b).toBe(false)
    expect(currentConfirm()).toBeNull()
    release()
  })

  it('carries a title and the words of both buttons to the dialog', async () => {
    const release = registerConfirmHost()
    const a = confirmDialog({ title: 'Discard this order?', message: 'It is lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true })
    expect(currentConfirm()).toMatchObject({ title: 'Discard this order?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' })
    answerConfirm(false)
    expect(await a).toBe(false)
    release()
  })

  it('a dangerous question starts on Cancel, so Enter alone never confirms it (ConfirmHost)', () => {
    const src = readFileSync(join(__dirname, '../components/ui/ConfirmHost.tsx'), 'utf8')
    expect(src).toContain(';(request.danger ? no : yes).current?.focus()')
  })

  it('one question at a time, in order', async () => {
    const release = registerConfirmHost()
    const first = confirmDialog({ message: 'first' })
    const second = confirmDialog({ message: 'second' })
    expect(currentConfirm()?.message).toBe('first')
    answerConfirm(true)
    expect(currentConfirm()?.message).toBe('second')
    answerConfirm(false)
    expect([await first, await second]).toEqual([true, false])
    release()
  })

  it('if the host goes away with a question open, it is answered no', async () => {
    const release = registerConfirmHost()
    const open = confirmDialog({ message: 'End the partnership?' })
    release()
    expect(await open).toBe(false)
    expect(currentConfirm()).toBeNull()
  })

  it('an answer with nothing asked does nothing', () => {
    expect(() => answerConfirm(true)).not.toThrow()
  })
})

describe('no system dialogs left', () => {
  it('no screen calls the browser\'s confirm()', async () => {
    const { execSync } = await import('node:child_process')
    const root = execSync('git rev-parse --show-toplevel').toString().trim()
    let hits = ''
    try {
      hits = execSync(`git grep -n -E "window\\.confirm\\(|[^A-Za-z_.]confirm\\(" -- 'src/renderer/src' ':!*.test.ts' ':!src/renderer/src/lib/confirm.ts'`, { cwd: root }).toString()
    } catch { /* nothing found */ }
    expect(hits).toBe('')
  })
})
