/**
 * What a mail server's refusal means, in a few kinds a person can act on
 * (send-invoice, the invoice panel's "Send by e-mail"):
 *
 *   smtp_connect        the server could not be reached (host, port, TLS, network)
 *   smtp_auth           the login was refused (user name or password)
 *   sender_rejected     the server will not send from this From address
 *   recipient_rejected  a recipient's address was refused (no such mailbox)
 *   smtp_other          anything else; the server's words are in the details
 *
 * Read from the error text as the mail library gives it (an SMTP reply such
 * as "535 5.7.8 Authentication failed", or a connection error). Order
 * matters: a login failure is said as such even when it mentions the sender.
 *
 * NO DEPENDENCIES (shared/README.md): the Edge Function and the app read it.
 */
export type SmtpFailure = 'smtp_connect' | 'smtp_auth' | 'sender_rejected' | 'recipient_rejected' | 'smtp_other'

const AUTH = /\b53[045]\b|5\.7\.(8|9|14)\b|auth(entication)?\s+(failed|unsuccessful|required|rejected)|invalid\s+(login|credentials|user|password)|username\s+and\s+password|bad\s+credentials|login\s+(failed|denied)/i
const CONNECT = /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|getaddrinfo|dns|connection\s+(refused|reset|closed|timed\s*out|error)|timed?\s*out|\btls\b|\bssl\b|certificate|handshake|network\s+(error|unreachable)|os\s+error|broken\s+pipe|\b421\b/i
/** Said outright about the From address: before the recipient's words, which such a reply may also carry. */
const SENDER_SAID = /sender\s+address\s+rejected|MAIL\s+FROM|SendAsDenied|not\s+owned\s+by|send\s*as\s+(denied|permission)|5\.7\.60\b|from\s+address\s+(rejected|not\s+allowed)|not\s+allowed\s+to\s+send\s+(as|from)/i
const RECIPIENT = /RCPT|recipient|user\s+unknown|unknown\s+user|no\s+such\s+(user|mailbox)|mailbox\s+(unavailable|not\s+found|does\s+not\s+exist|full)|5\.1\.[0-3]\b|does\s+not\s+exist|undeliverable|over\s+quota|5\.2\.2\b/i
const SENDER = /sender|relay(ing)?\s+(denied|not\s+permitted|access\s+denied)|5\.7\.1\b|\bspf\b|dmarc/i

export function classifySmtpError(text: string | null | undefined): SmtpFailure {
  const s = text ?? ''
  if (AUTH.test(s)) return 'smtp_auth'
  if (SENDER_SAID.test(s)) return 'sender_rejected'
  if (RECIPIENT.test(s)) return 'recipient_rejected'
  if (SENDER.test(s)) return 'sender_rejected'
  if (CONNECT.test(s)) return 'smtp_connect'
  return 'smtp_other'
}

/** The server's reply code ("535", "550 5.1.1"), for a log line that names no one. Null when there is none. */
export function smtpCode(text: string | null | undefined): string | null {
  const m = /\b([245]\d\d)\b(?:[ -]((?:[245])\.\d{1,3}\.\d{1,3}))?/.exec(text ?? '')
  if (!m) return null
  return m[2] ? `${m[1]} ${m[2]}` : m[1]
}
