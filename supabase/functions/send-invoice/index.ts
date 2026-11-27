/**
 * The invoice panel's "Send by e-mail" (sql/148): one invoice, sent now by the
 * person who pressed Send, to the addresses, subject and message they wrote,
 * with the PDF attached, from the clinic's mailbox (the same SMTP as the
 * automatic sender, send-invoices), Reply-To the person's own address.
 *
 * The work and the checks are in ../_shared/sendInvoice.ts (tested). The
 * gateway's JWT check is OFF (verify_jwt = false in supabase/config.toml;
 * deploy with --no-verify-jwt): the caller's token is checked by PostgREST on
 * the first call, made as that person (invoice_send_prepare), and the
 * database decides who may. Only then is anything sent, and the result is
 * written with the service key (invoice_send_record).
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, the service key (as for
 * send-notifications), SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS (as for
 * send-invoices).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { handleSendInvoice } from '../_shared/sendInvoice.ts'
import { serviceClientKey } from '../_shared/serviceAuth.ts'
import { APP_ALLOWED_HEADERS, callerVersionHeaders } from '../_shared/appVersion.ts'
import { openSmtp, smtpProblems, safeError } from '../_shared/mail.ts'
import { logWarn } from '../_shared/logSafe.ts'
import { invoiceHtml, invoiceText } from '../_shared/invoiceHtml.ts'
import { invoicePdf, invoicePdfName } from '../_shared/invoicePdf.ts'

const env = (name: string) => Deno.env.get(name)
const URL_ = env('SUPABASE_URL') ?? ''
const noSession = { persistSession: false, autoRefreshToken: false }
const service = createClient(URL_, serviceClientKey(env), { auth: noSession })

// A bearer token, not a cookie: any origin may ask, only a signed-in person gets an answer.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': APP_ALLOWED_HEADERS,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'bad_request' })

  const authorization = req.headers.get('Authorization')
  let body: unknown = null
  try { body = await req.json() } catch { /* answered as bad_request */ }

  const asUser = createClient(URL_, env('SUPABASE_ANON_KEY') ?? '', {
    global: { headers: { Authorization: authorization ?? '', ...callerVersionHeaders(req) } }, auth: noSession,
  })
  const answer = await handleSendInvoice(authorization, body, {
    prepare: async id => await asUser.rpc('invoice_send_prepare', { p_invoice: id }),
    record: async args => await service.rpc('invoice_send_record', args),
    smtpReady: () => smtpProblems().length === 0,
    // The person's own words: the subject, and the message above the invoice (nothing below it).
    render: async (doc, letter) => {
      const tpl = { pealkiri: letter.subject, sissejuhatus: letter.message, lopp: '' }
      return { html: invoiceHtml(doc, tpl), text: invoiceText(doc, tpl), pdf: await invoicePdf(doc), filename: invoicePdfName(doc) }
    },
    send: async mail => {
      const smtp = openSmtp(mail.fromAddress, mail.fromName)
      try {
        await smtp.send({
          to: mail.to, bcc: mail.bcc, replyTo: mail.replyTo ?? undefined, subject: mail.subject, html: mail.html, text: mail.text,
          attachments: [{ filename: mail.attachment.filename, content: mail.attachment.content, contentType: 'application/pdf' }],
        })
      } finally {
        await smtp.close()
      }
    },
    safeError,
    allowOnly: env('EMAIL_ALLOW_ONLY'),
    // Scrubbed again on the way out (logSafe): the line carries nothing personal to begin with.
    log: line => logWarn('send-invoice', line),
  })
  return json(answer.status, answer.body)
})

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}
