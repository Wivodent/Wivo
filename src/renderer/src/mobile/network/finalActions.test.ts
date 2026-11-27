/**
 * The phone's Network mode: nothing final sits beside an ordinary button or
 * happens without a question. Read from the source, so a new button that ends,
 * deletes or cancels without confirmDialog fails here.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, 'NetworkApp.tsx'), 'utf8')

/** The body of the function that contains `at`, from its `function` or `async function` keyword. */
function enclosingFunction(at: number): string {
  const start = Math.max(SRC.lastIndexOf('\nfunction ', at), SRC.lastIndexOf('\n  async function ', at), SRC.lastIndexOf('\n  function ', at))
  return SRC.slice(start, at)
}

const callsOf = (needle: string): number[] => {
  const out: number[] = []
  for (let i = SRC.indexOf(needle); i >= 0; i = SRC.indexOf(needle, i + 1)) out.push(i)
  return out
}

describe('/network: final actions ask first', () => {
  it('ending a connection (in the Network and at the clinic) happens only after confirmDialog, in the same function', () => {
    const ends = [...callsOf('endConnection('), ...callsOf('api.end(')].filter(i => !SRC.slice(i - 30, i).includes('import'))
    expect(ends.length).toBeGreaterThan(0)
    for (const at of ends) expect(enclosingFunction(at), SRC.slice(at, at + 40)).toMatch(/await confirmDialog\(\{[\s\S]*danger: true/)
  })

  it('"End this connection" is only in the clinic\'s menu, once', () => {
    expect(callsOf("t('network.endConnection')")).toHaveLength(1)
    const at = SRC.indexOf("t('network.endConnection')")
    expect(SRC.slice(Math.max(0, at - 600), at)).toContain('{menu && (')
  })

  it('the confirmation names the clinic and says what is lost', () => {
    expect(SRC).toMatch(/title: t\('network\.endTitle', \{ clinic: conn\.clinic\.name \}\)/)
    expect(SRC).toContain("message: t('network.endExplain')")
  })

  it('leaving a filled-in order asks "Discard this order?" with Keep editing', () => {
    const at = SRC.indexOf('onLeave()')
    expect(at).toBeGreaterThan(0)
    const body = enclosingFunction(at)
    expect(body).toContain('orderTouched(')
    expect(body).toContain("t('network.discardTitle')")
    expect(body).toContain("cancelLabel: t('network.keepEditing')")
  })

  it('there is no delete or cancel of an order anywhere in the client\'s screens', () => {
    expect(SRC).not.toMatch(/deleteOrder|cancelOrder|cancel_order|delete_order/)
  })
})

describe('/network: notices (sql/142)', () => {
  it('say what happened, on which order and at which clinic, never a message text', async () => {
    const { noticeText } = await import('./NetworkApp')
    const message = noticeText({ kind: 'message', ref: 'TF-DE-261127-001', reason: null }, 'Dentiks')
    expect(message).toContain('TF-DE-261127-001')
    expect(message).toContain('Dentiks')
    expect(noticeText({ kind: 'sent', ref: 'TF-DE-261127-001', reason: null }, 'Dentiks')).toContain('TF-DE-261127-001')
    expect(noticeText({ kind: 'rejected', ref: 'R1', reason: 'We do not make these' }, 'Dentiks')).toContain('We do not make these')
    // "Your order R1 is on its way" names the order, not the clinic, as asked.
    for (const kind of ['message', 'accepted', 'rejected', 'ready', 'connected', 'declined'] as const) {
      expect(noticeText({ kind, ref: 'R1', reason: null }, 'Dentiks')).toContain('Dentiks')
    }
  })
  it('opening a notice marks it read and opens its order', () => {
    expect(SRC).toContain('readNotices([n.id])')
    expect(SRC).toMatch(/setScreen\(\{ name: 'clinic', conn: n\.conn, orderId: n\.order_id \?\? undefined \}\)/)
  })
})
