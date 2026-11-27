/**
 * "Send by e-mail" (sql/148): one invoice, now, to the addresses, subject and
 * message shown here (filled in from the clinic's letter, in the invoice's
 * language; all of it can be changed), with the PDF attached, from the
 * clinic's mailbox. Reply-To is the person sending it; "Send me a copy" sends
 * them a hidden copy. Sent: the invoice is Sent and the try is in its history.
 * Not sent: why, in words, and the invoice stays as it was.
 */
import { useMemo, useState } from 'react'
import { usePermissions } from '../../hooks/usePermissions'
import { classifySmtpError } from '@shared/billing/smtpError'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mail, Paperclip, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../stores/useSettings'
import { useCustomers } from '../../hooks/useCustomers'
import { clinicCountry } from '../../lib/country'
import { prefillLetter, renumberLetter, clientInvoiceAddress, sendInvoiceByEmail, SendInvoiceError, type SendErrorCode, type Letter } from '../../lib/invoiceSend'
import { isDraftNumber } from '../../types/invoice'
import { docLanguageFor } from '@shared/billing/countryInvoice'
import { splitAddresses, looksLikeEmail, HAND_SEND_MAX_RECIPIENTS } from '@shared/billing/sendGuard'
import type { InvoiceFull } from '../../types/invoice'
import { t } from '@/lib/i18n'

export function sendErrorText(code: SendErrorCode): string {
  switch (code) {
    case 'smtp_connect': return t('sendInvoice.errSmtpConnect')
    case 'smtp_auth': return t('sendInvoice.errSmtpAuth')
    case 'sender_rejected': return t('sendInvoice.errSenderRejected')
    case 'recipient_rejected': return t('sendInvoice.errRecipientRejected')
    case 'smtp_other': return t('sendInvoice.errSmtpOther')
    case 'not_deployed': return t('sendInvoice.errNotDeployed')
    case 'unreachable': return t('sendInvoice.errUnreachable')
    case 'testaadress-vigane': return t('sendInvoice.errTestAddressInvalid')
    case 'test_copy_needs_test_address': return t('sendInvoice.errTestCopyNeedsTestAddress')
    case 'test_address_not_allowed': return t('sendInvoice.errTestAddressNotAllowed')
    case 'saatja-puudub': return t('sendInvoice.errNoSender')
    case 'tuhistatud': return t('sendInvoice.errCancelled')
    case 'paevalimiit': return t('sendInvoice.errDailyLimit')
    case 'saajad-puuduvad': return t('sendInvoice.errNoRecipients')
    case 'saaja-vigane': return t('sendInvoice.errBadAddress')
    case 'liiga-palju-saajaid': return t('sendInvoice.errTooMany', { n: HAND_SEND_MAX_RECIPIENTS })
    case 'teema-puudub': return t('sendInvoice.errNoSubject')
    case 'number_changed': return t('sendInvoice.errNumberChanged')
    case 'smtp_not_set_up': return t('sendInvoice.errSmtp')
    case 'not_allowed': return t('sendInvoice.errNotAllowed')
    case 'signed_out': return t('sendInvoice.errSignedOut')
    default: return t('sendInvoice.errFailed')
  }
}

export function SendInvoiceDialog({ invoice, onClose }: { invoice: InvoiceFull; onClose: () => void }) {
  const { clinic, user } = useAuth()
  const { settings } = useSettings()
  const { data: customers = [] } = useCustomers()
  const qc = useQueryClient()
  const language = docLanguageFor(clinicCountry(clinic), settings.arveKeel)
  // The patient's own address, for an invoice to a patient.
  const patientEmail = useQuery<string | null>({
    queryKey: ['invoice-patient-email', invoice.patient_id],
    enabled: invoice.bill_to_kind !== 'customer' && !!invoice.patient_id,
    queryFn: async () => {
      const { data } = await supabase.from('patients').select('email').eq('id', invoice.patient_id!).maybeSingle()
      return (data?.email as string | null) ?? null
    },
  })
  // A draft: the number it will get when it is sent (sql/150), read without taking it.
  const draft = isDraftNumber(invoice.number)
  const upcoming = useQuery<string | null>({
    queryKey: ['invoice-upcoming-number', invoice.clinic_id],
    enabled: draft,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('upcoming_invoice_number', { p_clinic: invoice.clinic_id })
      return error ? null : (data as string | null) ?? null
    },
  })
  // A client: its billing e-mail, else its invoice e-mail, else the ordering Network account's (sql/152).
  const clientAddress = useQuery<string | null>({
    queryKey: ['invoice-recipient', invoice.customer_id],
    enabled: invoice.bill_to_kind === 'customer' && !!invoice.customer_id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('invoice_recipient_email', { p_customer: invoice.customer_id })
      return error ? null : (data as string | null) ?? null
    },
  })
  const client = invoice.bill_to_kind === 'customer' ? customers.find(c => c.id === invoice.customer_id) ?? null : null
  const addressee = invoice.bill_to_kind === 'customer'
    ? { email: clientAddress.data ?? clientInvoiceAddress(client), cc_emails: client?.cc_emails ?? [] }
    : { email: patientEmail.data ?? null }
  const ready = (invoice.bill_to_kind === 'customer'
    ? (customers.length > 0 || !invoice.customer_id) && (!invoice.customer_id || clientAddress.isFetched)
    : !invoice.patient_id || patientEmail.isFetched)
    && (!draft || upcoming.isFetched)
  const start = useMemo(() => prefillLetter(invoice, clinic, language, settings.epost, addressee, upcoming.data),
    // Filled once, when what it is made from has arrived; edits are the person's after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready])
  return ready
    ? <SendForm key={start.to.join(',')} invoice={invoice} start={start} myEmail={user?.email ?? null}
        onSent={() => { void qc.invalidateQueries({ queryKey: ['invoices'] }); void qc.invalidateQueries({ queryKey: ['invoice-send-log', invoice.id] }); onClose() }}
        onClose={onClose} />
    : null
}

function SendForm({ invoice, start, myEmail, onSent, onClose }: {
  invoice: InvoiceFull; start: Letter; myEmail: string | null; onSent: () => void; onClose: () => void
}) {
  const qc = useQueryClient()
  const [to, setTo] = useState(start.to.join(', '))
  const [subject, setSubject] = useState(start.subject)
  const [message, setMessage] = useState(start.message)
  // The number the letter names: the draft's coming one, or the number the invoice got meanwhile.
  const [number, setNumber] = useState(start.number)
  const [renumbered, setRenumbered] = useState<{ from: string; to: string } | null>(null)
  const draft = isDraftNumber(invoice.number) && !renumbered
  const [copy, setCopy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ text: string; detail?: string } | null>(null)
  const { isOwner } = usePermissions()
  const addresses = splitAddresses(to)
  const badAddress = addresses.find(a => !looksLikeEmail(a))
  const ok = addresses.length > 0 && addresses.length <= HAND_SEND_MAX_RECIPIENTS && !badAddress && !!subject.trim()

  async function send() {
    setBusy(true); setError(null)
    try {
      await sendInvoiceByEmail({ invoiceId: invoice.id, to: addresses, subject: subject.trim(), message, copyToMe: copy, expectedNumber: number })
      onSent()
    } catch (e) {
      // Someone took the number first: the invoice has another one now. Nothing was sent; the letter says the new one.
      if (e instanceof SendInvoiceError && e.code === 'number_changed' && e.number) {
        const next = renumberLetter({ subject, message }, number, e.number)
        setSubject(next.subject); setMessage(next.message)
        setRenumbered({ from: number, to: e.number }); setNumber(e.number)
        void qc.invalidateQueries({ queryKey: ['invoices'] })
        return
      }
      setError(e instanceof SendInvoiceError ? { text: sendErrorText(e.code), detail: e.detail } : { text: sendErrorText('failed') })
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="send-invoice-h" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card w-full max-w-lg space-y-3 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h2 id="send-invoice-h" className="text-lg font-bold text-ink">{t('sendInvoice.title', { number })}</h2>
            {/* A draft gets this number when it is sent (sql/150). */}
            {draft && <p className="text-[11px] text-ink-muted">{t('sendInvoice.numberOnSend')}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label={t('invoices.close')} className="h-9 w-9 rounded-lg text-ink-muted hover:bg-bg-sidebar"><X size={18} className="mx-auto" /></button>
        </div>
        <label className="block"><span className="label">{t('sendInvoice.to')}</span>
          <input className="input" value={to} onChange={e => setTo(e.target.value)} placeholder={t('sendInvoice.toPlaceholder')} />
          <span className={`block text-[11px] mt-0.5 ${badAddress ? 'text-red-700' : 'text-ink-faint'}`}>
            {badAddress ? t('sendInvoice.notAnAddress', { address: badAddress }) : t('sendInvoice.toHint')}
          </span>
        </label>
        <label className="block"><span className="label">{t('sendInvoice.subject')}</span>
          <input className="input" maxLength={300} value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label className="block"><span className="label">{t('sendInvoice.message')}</span>
          <textarea className="input min-h-40 text-sm" maxLength={10000} value={message} onChange={e => setMessage(e.target.value)} /></label>
        <p className="flex items-center gap-1.5 text-xs text-ink-muted"><Paperclip size={12} aria-hidden="true" /> {t('sendInvoice.pdfAttached')}</p>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="h-4 w-4" checked={copy} onChange={e => setCopy(e.target.checked)} disabled={!myEmail} />
          {myEmail ? t('sendInvoice.copyToMe', { email: myEmail }) : t('sendInvoice.copyToMeNoEmail')}
        </label>
        <p className="text-[11px] text-ink-faint">{t('sendInvoice.replyTo')}</p>
        {renumbered && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" role="status">
            {t('sendInvoice.numberChanged', { from: renumbered.from, to: renumbered.to })}
          </p>
        )}
        {error && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5 space-y-1" role="alert">
            <p>{error.text}</p>
            {/* The mail server's own words, passwords taken out: for the owner, who sets the mailbox up. */}
            {isOwner && error.detail && <ServerDetails detail={error.detail} />}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost border border-ink-faint/25">{t('invoices.cancel')}</button>
          <button type="button" disabled={!ok || busy} onClick={() => void send()} className="btn-primary disabled:opacity-50">
            <Mail size={14} aria-hidden="true" /> {busy ? t('sendInvoice.sending') : t('sendInvoice.send')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** "Details": what the mail server said. */
function ServerDetails({ detail }: { detail: string }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-red-800">{t('sendInvoice.details')}</summary>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] text-ink">{detail}</pre>
    </details>
  )
}

/** The invoice's sending history: who sent it, when, to whom, the subject; a failure's reason in words, its details for the owner. */
export function InvoiceSendHistory({ invoiceId, nameOf }: { invoiceId: string; nameOf: (id: string | null) => string }) {
  const { isOwner } = usePermissions()
  const log = useQuery<{ id: string; sent_by: string | null; sent_at: string; recipients: string[]; subject: string; ok: boolean; error: string | null; redirected_to: string | null }[]>({
    queryKey: ['invoice-send-log', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase.from('invoice_send_log').select('id, sent_by, sent_at, recipients, subject, ok, error, redirected_to')
        .eq('invoice_id', invoiceId).order('sent_at', { ascending: false })
      return error ? [] : (data ?? []) as never
    },
  }).data ?? []
  if (log.length === 0) return null
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">{t('sendInvoice.history')}</h3>
      {log.map(e => (
        <div key={e.id} className={`text-[11px] rounded-lg border px-2.5 py-1.5 ${e.ok ? 'border-ink-faint/20' : 'border-red-200 bg-red-50'}`}>
          <p className="text-ink">
            {new Date(e.sent_at).toLocaleString()} · {nameOf(e.sent_by)} · {e.ok ? t('sendInvoice.sent') : t('sendInvoice.notSent')}
          </p>
          <p className="text-ink-muted">{t('sendInvoice.historyTo', { to: e.recipients.join(', ') })}{e.redirected_to ? ` (${t('sendInvoice.redirected', { to: e.redirected_to })})` : ''}</p>
          <p className="text-ink-muted truncate">{e.subject}</p>
          {e.error && <p className="text-red-700">{sendErrorText(classifySmtpError(e.error))}</p>}
          {e.error && isOwner && <ServerDetails detail={e.error} />}
        </div>
      ))}
    </section>
  )
}
