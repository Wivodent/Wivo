/**
 * One invoice sent by e-mail by hand (Edge Function send-invoice, sql/148).
 *
 *   { invoiceId, to: string[], subject, message, copyToMe }
 *
 * Asked of the database as the signed-in person (invoice_send_prepare: Edit
 * payments, an invoice of their clinic). The guard (shared/billing/sendGuard
 * mayHandSendInvoice) decides: a From address set up, not cancelled, within
 * the daily cap, real addresses; the test address takes every copy while it
 * is set. Sent from the clinic's mailbox, Reply-To the person's own address,
 * the PDF attached, in the invoice's language; "Send me a copy" is a hidden
 * copy to the person. What the mail server answered is recorded with the
 * service key (invoice_send_record): Sent, or the error with the invoice as
 * it was (a draft stays a draft).
 *
 * Every answer is one of a few fixed ones; the server's own words go only to
 * the invoice (send_error), credentials taken out (mail.ts safeError).
 */
import { invoiceDoc, type DocInvoice, type DocClinic, type InvoiceDoc } from '@shared/billing/invoiceDoc.ts'
import { docLanguageFor } from '@shared/billing/countryInvoice.ts'
import { mayHandSendInvoice, looksLikeEmail, SAFE_MAIL_POLICY, type MailPolicy } from '@shared/billing/sendGuard.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Answer { status: number; body: Record<string, unknown> }

export interface Prepared {
  invoice: DocInvoice & { id: string }
  clinic: (DocClinic & { country?: string | null }) | null
  email: Partial<MailPolicy> & { saatjaNimi?: string }
  language: string | null
  sent_today: number
  caller: { id: string; email: string | null }
}

export interface Outgoing {
  fromAddress: string
  fromName: string
  to: string[]
  bcc: string[]
  replyTo: string | null
  subject: string
  html: string
  text: string
  attachment: { filename: string; content: Uint8Array }
}

export interface SendInvoiceDeps {
  /** invoice_send_prepare as the caller. */
  prepare: (invoiceId: string) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
  /** invoice_send_record with the service key. */
  record: (args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>
  smtpReady: () => boolean
  render: (doc: InvoiceDoc, letter: { subject: string; message: string }) => Promise<{ html: string; text: string; pdf: Uint8Array; filename: string }>
  send: (mail: Outgoing) => Promise<void>
  safeError: (err: unknown) => string
}

const bad: Answer = { status: 400, body: { error: 'bad_request' } }

export async function handleSendInvoice(authorization: string | null, body: unknown, deps: SendInvoiceDeps): Promise<Answer> {
  if (!authorization?.startsWith('Bearer ')) return { status: 401, body: { error: 'signed_out' } }
  if (!body || typeof body !== 'object') return bad
  const b = body as Record<string, unknown>
  const invoiceId = typeof b.invoiceId === 'string' && UUID.test(b.invoiceId) ? b.invoiceId : null
  const to = Array.isArray(b.to) ? b.to.filter((x): x is string => typeof x === 'string') : null
  const subject = typeof b.subject === 'string' ? b.subject.trim().slice(0, 300) : ''
  const message = typeof b.message === 'string' ? b.message.slice(0, 10000) : ''
  const copyToMe = b.copyToMe === true
  if (!invoiceId || !to || (Array.isArray(b.to) && to.length !== b.to.length)) return bad

  const prepared = await deps.prepare(invoiceId)
  if (prepared.error) {
    if (prepared.error.code === '42501') return { status: 403, body: { error: 'not_allowed' } }
    if (/JWT|token/i.test(prepared.error.message ?? '')) return { status: 401, body: { error: 'signed_out' } }
    return { status: 500, body: { error: 'failed' } }
  }
  const p = prepared.data as Prepared
  const policy = { ...SAFE_MAIL_POLICY, ...(p.email ?? {}) }
  const verdict = mayHandSendInvoice(p.invoice as { status: string }, policy, to, subject, Number(p.sent_today ?? 0))
  if (!verdict.send) return { status: 422, body: { error: 'refused', code: verdict.code } }
  if (!deps.smtpReady()) return { status: 503, body: { error: 'smtp_not_set_up' } }

  const language = docLanguageFor((p.clinic?.country ?? 'EE') as string, p.language)
  const doc = invoiceDoc(p.invoice, p.clinic, language)
  const callerEmail = looksLikeEmail(p.caller?.email) ? p.caller.email!.trim() : null
  const record = (ok: boolean, error: string | null) => deps.record({
    // What the person typed; where the test address took it, apart.
    p_invoice: invoiceId, p_by: p.caller?.id ?? null, p_to: [...new Set(to.map(a => a.trim()).filter(Boolean))], p_subject: subject,
    p_copy: copyToMe && !!callerEmail, p_redirected: verdict.redirected ? verdict.to[0] : null, p_ok: ok, p_error: error,
  })
  try {
    const out = await deps.render(doc, { subject, message })
    await deps.send({
      fromAddress: policy.saatjaAadress.trim(),
      fromName: (p.email?.saatjaNimi ?? '').trim(),
      to: verdict.to,
      // A copy for the sender, unless the test address is taking everything anyway.
      bcc: copyToMe && callerEmail && !verdict.redirected ? [callerEmail] : [],
      replyTo: callerEmail,
      subject,
      html: out.html,
      text: out.text,
      attachment: { filename: out.filename, content: out.pdf },
    })
  } catch (err) {
    const msg = deps.safeError(err)
    await record(false, msg)
    return { status: 502, body: { error: 'send_failed', message: msg } }
  }
  const { error } = await record(true, null)
  // The mail went; only the note of it failed. Said, so nobody sends it twice in a hurry.
  if (error) return { status: 200, body: { ok: true, recorded: false, to: verdict.to, redirected: verdict.redirected } }
  return { status: 200, body: { ok: true, recorded: true, to: verdict.to, redirected: verdict.redirected } }
}
