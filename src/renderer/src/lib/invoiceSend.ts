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
  const doc = invoiceDoc(invoice, clinic, language)
  const tpl = mailTemplateForInvoice(clinicTemplate, doc.language)
  const vars = templateVars(doc)
  const to = [addressee?.email, ...(addressee?.cc_emails ?? [])].map(a => (a ?? '').trim()).filter(Boolean)
  return {
    to: [...new Set(to)],
    subject: renderTemplate(tpl.pealkiri, vars),
    message: [renderTemplate(tpl.sissejuhatus, vars), renderTemplate(tpl.lopp, vars)].filter(s => s.trim()).join('\n\n'),
  }
}

export type SendErrorCode =
  | 'saatja-puudub' | 'tuhistatud' | 'paevalimiit' | 'saajad-puuduvad' | 'saaja-vigane' | 'liiga-palju-saajaid' | 'teema-puudub'
  | 'smtp_not_set_up' | 'send_failed' | 'not_allowed' | 'signed_out' | 'bad_request' | 'failed'

export class SendInvoiceError extends Error {
  constructor(readonly code: SendErrorCode, readonly detail?: string) { super(detail ?? code) }
}

export async function sendInvoiceByEmail(input: { invoiceId: string; to: string[]; subject: string; message: string; copyToMe: boolean }):
  Promise<{ to: string[]; redirected: boolean; recorded: boolean }> {
  const { data, error } = await supabase.functions.invoke('send-invoice', { body: input })
  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    const answer = (await context?.json?.().catch(() => null)) as { error?: string; code?: string; message?: string } | null
    const code = (answer?.error === 'refused' ? answer.code : answer?.error) as SendErrorCode | undefined
    throw new SendInvoiceError(code ?? 'failed', answer?.message)
  }
  const d = data as { ok?: boolean; to?: string[]; redirected?: boolean; recorded?: boolean }
  if (!d?.ok) throw new SendInvoiceError('failed')
  return { to: d.to ?? [], redirected: !!d.redirected, recorded: d.recorded !== false }
}
