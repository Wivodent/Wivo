import { describe, expect, it } from 'vitest'
import { classifySmtpError, smtpCode } from './smtpError'

describe('what a mail server’s refusal means', () => {
  it.each([
    ['535 5.7.8 Error: authentication failed: UGFzc3dvcmQ6', 'smtp_auth'],
    ['534-5.7.9 Application-specific password required', 'smtp_auth'],
    ['Invalid login: 535 Incorrect authentication data', 'smtp_auth'],
    ['Connection refused (os error 10061)', 'smtp_connect'],
    ['getaddrinfo ENOTFOUND mail.example.lv', 'smtp_connect'],
    ['invalid peer certificate: UnknownIssuer', 'smtp_connect'],
    ['Connection timed out', 'smtp_connect'],
    ['553 5.7.1 <arved@dentiks.lv>: Sender address rejected: not owned by user info@dentiks.lv', 'sender_rejected'],
    ['550 5.1.0 <arved@dentiks.lv>: Sender address rejected: User unknown in local recipient table', 'sender_rejected'],
    ['554 5.2.252 SendAsDenied; arved@dentiks.lv not allowed to send as', 'sender_rejected'],
    ['550 5.7.1 Relaying denied', 'sender_rejected'],
    ['550 5.1.1 <buh@zobi.lv>: Recipient address rejected: User unknown in virtual mailbox table', 'recipient_rejected'],
    ['550 No such user here', 'recipient_rejected'],
    ['552 5.2.2 Mailbox full / over quota', 'recipient_rejected'],
    ['451 4.3.0 Temporary server error', 'smtp_other'],
    ['', 'smtp_other'],
  ])('%s → %s', (text, kind) => {
    expect(classifySmtpError(text)).toBe(kind)
  })

  it('the reply code for a log line that names no one', () => {
    expect(smtpCode('550 5.1.1 <buh@zobi.lv>: Recipient address rejected')).toBe('550 5.1.1')
    expect(smtpCode('535 Incorrect authentication data')).toBe('535')
    expect(smtpCode('Connection refused (os error 10061)')).toBeNull()
  })
})
