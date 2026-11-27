/**
 * Sending one invoice by e-mail by hand (sql/148, Edge Function send-invoice).
 *
 * prefillLetter: what the dialog starts with. The recipients are the
 * invoice's addressee (a client's invoice address and its copies, or the
 * patient's e-mail); the subject and the message are the clinic's letter
 * (Settings → Email), or the plain letter in the invoice's language when the
 * clinic has not written its own, with the invoice's details filled in.
 * Everything can be changed before sending.
 *
 * sendInvoiceByEmail: the call, with the function's refusal as a code the
 * dialog can say in words.
 */
import { supabase } from './supabase'
import { invoiceDoc, type DocInvoice, type DocClinic } from '@shared/billing/invoiceDoc'
import { mailTemplateForInvoice, renderTemplate, templateVars, type MailTemplate } from '@shared/billing/mailTemplate'
import type { DocLanguage } from '@shared/billing/countryInvoice'

export interface Letter { to: string[]; subject: string; message: string }

export function prefillLetter(invoice: DocInvoice, clinic: DocClinic | null, language: DocLanguage,
  clinicTemplate: Partial<MailTemplate> | null | undefined, addressee: { email?: string | null; cc_emails?: string[] | null } | null): Letter {
  // The invoice's own language (sql/149) wins; `language` is the clinic's default, for an invoice without one.
  const doc = invoiceDoc(invoice, clinic, language)
  const tpl = mailTemplateForInvoice(clinicTemplate, doc.language, language)
  const vars = templateVars(doc)
  const to = [addressee?.email, ...(addressee?.cc_emails ?? [])].map(a => (a ?? '').trim()).filter(Boolean)
  return {
    to: [...new Set(to)],
    subject: renderTemplate(tpl.pealkiri, vars),
    message: [renderTemplate(tpl.sissejuhatus, vars), renderTemplate(tpl.lopp, vars)].filter(s => s.trim()).join('\n\n'),
  }
}

export type SendErrorCode =
  // refused before sending (shared/billing/sendGuard, the test copy)
  | 'saatja-puudub' | 'tuhistatud' | 'paevalimiit' | 'saajad-puuduvad' | 'saaja-vigane' | 'liiga-palju-saajaid' | 'teema-puudub'
  | 'testaadress-vigane' | 'test_copy_needs_test_address' | 'test_address_not_allowed'
  // the mail server's answer (shared/billing/smtpError)
  | 'smtp_connect' | 'smtp_auth' | 'sender_rejected' | 'recipient_rejected' | 'smtp_other'
  // the function itself
  | 'smtp_not_set_up' | 'not_deployed' | 'unreachable' | 'not_allowed' | 'signed_out' | 'bad_request' | 'failed'

export class SendInvoiceError extends Error {
  constructor(readonly code: SendErrorCode, readonly detail?: string) { super(detail ?? code) }
}

/**
 * What went wrong, from what supabase-js hands back: the function's own answer
 * (refused, or the mail server's kind and words), or no answer at all. A 404
 * with no answer of ours is the function not being there (not deployed); a
 * request that never got a response is "could not reach it".
 */
export async function sendErrorFrom(error: unknown): Promise<SendInvoiceError> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<unknown> } }
  const answer = (await e.context?.json?.().catch(() => null)) as { error?: string; code?: string; reason?: string; detail?: string } | null
  if (answer?.error === 'refused' && answer.code) return new SendInvoiceError(answer.code as SendErrorCode)
  if (answer?.error === 'send_failed') return new SendInvoiceError((answer.reason ?? 'smtp_other') as SendErrorCode, answer.detail)
  if (answer?.error) return new SendInvoiceError(answer.error as SendErrorCode)
  if (e.context?.status === 404) return new SendInvoiceError('not_deployed')
  if (e.name === 'FunctionsFetchError' || e.name === 'FunctionsRelayError') return new SendInvoiceError('unreachable')
  return new SendInvoiceError('failed')
}

export async function sendInvoiceByEmail(input: { invoiceId: string; to: string[]; subject: string; message: string; copyToMe: boolean }):
  Promise<{ to: string[]; redirected: boolean; recorded: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-invoice', { body: input })
  if (error) throw await sendErrorFrom(error)
  const d = data as { ok?: boolean; to?: string[]; redirected?: boolean; recorded?: boolean }
  if (!d?.ok) throw new SendInvoiceError('failed')
  return { to: d.to ?? [], redirected: !!d.redirected, recorded: d.recorded !== false }
}
