/**
 * The clinic's e-mails to a Network client (shared/network/clientMail.ts):
 * every kind in every language, word for word the notice the client sees in
 * /network where they say the same thing, and never more than a subject and a
 * link.
 */
import { describe, expect, it } from 'vitest'
import { CLIENT_MAIL, CLIENT_MAIL_LANGS, clientMailLang, clientMailSubject, clientMailText, type ClientMailKind } from './clientMail'
import { translate, type MessageKey } from '../i18n'

/** The e-mail and the bell say the same thing for these. */
const SAME_AS_NOTICE: Partial<Record<ClientMailKind, MessageKey>> = {
  message: 'network.noticeMessage',
  accepted: 'network.noticeAccepted',
  rejected: 'network.noticeRejected',
  ready: 'network.noticeReady',
  sent: 'network.noticeSent',
  connected: 'network.noticeConnected',
  declined: 'network.noticeDeclined',
  problem_resolved: 'network.noticeProblemResolved',
  cancelled: 'network.noticeCancelled',
  reinstated: 'network.noticeReinstated',
}

describe('the e-mails to a Network client', () => {
  it('each language has every kind', () => {
    const kinds = Object.keys(CLIENT_MAIL.en.subjects).sort()
    for (const l of CLIENT_MAIL_LANGS) expect(Object.keys(CLIENT_MAIL[l].subjects).sort(), l).toEqual(kinds)
  })

  it('say word for word what the notice in /network says, in each language', () => {
    for (const l of CLIENT_MAIL_LANGS) {
      for (const [kind, key] of Object.entries(SAME_AS_NOTICE) as [ClientMailKind, MessageKey][]) {
        expect(clientMailSubject(kind, 'TF-DE-261127-001', 'Dentiks', l), `${l} ${kind}`)
          .toBe(translate(l, key, { ref: 'TF-DE-261127-001', clinic: 'Dentiks' }))
      }
    }
  })

  it('carry a reference and a clinic name only: no amount, reason or patient', () => {
    for (const l of CLIENT_MAIL_LANGS) {
      for (const s of Object.values(CLIENT_MAIL[l].subjects)) {
        expect(s.match(/\{(\w+)\}/g)?.every(p => p === '{ref}' || p === '{clinic}') ?? true, `${l}: ${s}`).toBe(true)
      }
    }
  })

  it('in the client\'s language; English when the clinic does not know it', () => {
    expect(clientMailSubject('sent', 'R1', 'Dentiks', 'lv')).toBe('Jūsu pasūtījums R1 ir ceļā')
    expect(clientMailSubject('sent', 'R1', 'Dentiks', null)).toBe('Your order R1 is on its way')
    expect(clientMailSubject('sent', 'R1', 'Dentiks', 'de')).toBe('Your order R1 is on its way')
    expect(clientMailLang('ru')).toBe('ru')
    expect(clientMailText('Jūsu pasūtījums R1 ir ceļā', 'https://app.wivodent.com/network', 'lv'))
      .toBe('Jūsu pasūtījums R1 ir ceļā\n\nAtvērt Wivo Network: https://app.wivodent.com/network\n')
  })

  it('a notice without a reference leaves no placeholder behind', () => {
    for (const l of CLIENT_MAIL_LANGS) {
      for (const kind of Object.keys(CLIENT_MAIL[l].subjects) as ClientMailKind[]) {
        expect(clientMailSubject(kind, null, 'Dentiks', l), `${l} ${kind}`).not.toMatch(/\{\w+\}/)
      }
    }
    expect(clientMailSubject('accepted', null, 'Dentiks', 'en')).toBe('Dentiks accepted your order')
  })
})
