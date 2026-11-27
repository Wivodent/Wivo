/**
 * What can still happen to an invoice (sql/149), at the bottom of its panel:
 *
 *  - a draft: "Delete draft" (asked first; it never had a number, so no hole
 *    is left). While it is deleted the button says so and waits: a slow
 *    answer is not an error.
 *  - issued (Sent, Paid): never deleted. "Cancel invoice" with a reason (the
 *    number stays; it no longer counts), or "Create credit note" (a new
 *    invoice with its own number crediting this one), with a reason.
 *  - cancelled: why, and when.
 *  - a credit note and the invoice it credits point at each other.
 *
 * The database decides (delete_invoice, cancel_invoice, create_credit_note);
 * its refusal is shown as it is.
 */
import { useState } from 'react'
import { Loader2, Trash2, Ban, FileMinus, X } from 'lucide-react'
import { format } from 'date-fns'
import { useDeleteInvoice, useCancelInvoice, useCreateCreditNote } from '../../hooks/useInvoices'
import { invoiceNumberText, type InvoiceFull } from '../../types/invoice'
import { describeError } from '../Patients/errors'
import { t, dateLocale } from '@/lib/i18n'

export function InvoiceLifecycle({ invoice, all, canWrite, onDeleted, onOpen }: {
  invoice: InvoiceFull
  /** Every invoice, to name a credit note and the invoice it credits. */
  all: readonly InvoiceFull[]
  canWrite: boolean
  onDeleted: () => void
  onOpen: (id: string) => void
}) {
  const del = useDeleteInvoice()
  const cancel = useCancelInvoice()
  const credit = useCreateCreditNote()
  const [asking, setAsking] = useState<'delete' | 'cancel' | 'credit' | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const draftWord = t('invoices.draftLabel')
  const numberOf = (id: string) => invoiceNumberText(all.find(i => i.id === id)?.number, draftWord)
  const creditNote = all.find(i => i.credit_of === invoice.id) ?? null
  const issued = invoice.status === 'saadetud' || invoice.status === 'makstud'
  const busy = del.isPending || cancel.isPending || credit.isPending

  async function confirm() {
    setError(null)
    try {
      if (asking === 'delete') { await del.mutateAsync(invoice.id); onDeleted() }
      else if (asking === 'cancel') await cancel.mutateAsync({ id: invoice.id, reason: reason.trim() })
      else if (asking === 'credit') onOpen(await credit.mutateAsync({ id: invoice.id, reason: reason.trim() }))
      setAsking(null); setReason('')
    } catch (e) { setError(describeError(e)) }
  }

  return (
    <section className="pt-1 border-t border-ink-faint/15 space-y-2">
      {invoice.credit_of && (
        <button type="button" onClick={() => onOpen(invoice.credit_of!)} className="text-xs text-accent hover:underline">
          {t('invoices.creditNoteFor', { number: numberOf(invoice.credit_of) })}
        </button>
      )}
      {creditNote && (
        <button type="button" onClick={() => onOpen(creditNote.id)} className="block text-xs text-accent hover:underline">
          {t('invoices.creditedBy', { number: invoiceNumberText(creditNote.number, draftWord) })}
        </button>
      )}
      {invoice.status === 'tuhistatud' && (
        <p className="text-xs text-ink-muted">
          {t('invoices.cancelledOn', { date: invoice.cancelled_at ? format(new Date(invoice.cancelled_at), 'd MMM yyyy', { locale: dateLocale }) : '—' })}
          {invoice.cancel_reason ? ` · ${invoice.cancel_reason}` : ''}
        </p>
      )}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          {invoice.status === 'mustand' && (
            <button type="button" onClick={() => setAsking('delete')} disabled={busy} className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500">
              <Trash2 size={11} /> {t('invoices.deleteDraft')}
            </button>
          )}
          {issued && (
            <button type="button" onClick={() => setAsking('cancel')} disabled={busy} className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-red-500">
              <Ban size={11} /> {t('invoices.cancelInvoice')}
            </button>
          )}
          {issued && !invoice.credit_of && !creditNote && (
            <button type="button" onClick={() => setAsking('credit')} disabled={busy} className="flex items-center gap-1.5 text-xs text-ink-faint hover:text-accent">
              <FileMinus size={11} /> {t('invoices.createCreditNote')}
            </button>
          )}
        </div>
      )}

      {asking && (
        <div role="dialog" aria-modal="true" aria-labelledby="invoice-lifecycle-h" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setAsking(null)}>
          <div className="card w-full max-w-md space-y-3 p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <h2 id="invoice-lifecycle-h" className="flex-1 text-lg font-bold text-ink">
                {asking === 'delete' ? t('invoices.deleteDraftAsk') : asking === 'cancel'
                  ? t('invoices.cancelInvoiceAsk', { number: invoiceNumberText(invoice.number, draftWord) })
                  : t('invoices.creditNoteAsk', { number: invoiceNumberText(invoice.number, draftWord) })}
              </h2>
              <button type="button" disabled={busy} onClick={() => setAsking(null)} aria-label={t('invoices.close')} className="h-9 w-9 rounded-lg text-ink-muted hover:bg-bg-sidebar"><X size={18} className="mx-auto" /></button>
            </div>
            <p className="text-sm text-ink-muted">
              {asking === 'delete' ? t('invoices.deleteDraftText') : asking === 'cancel' ? t('invoices.cancelInvoiceText') : t('invoices.creditNoteText')}
            </p>
            {asking !== 'delete' && (
              <label className="block"><span className="label">{t('invoices.reasonRequired')}</span>
                <textarea className="input min-h-16 text-sm" maxLength={500} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
            )}
            {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5" role="alert">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setAsking(null)} className="btn-ghost border border-ink-faint/25">{t('invoices.cancel')}</button>
              <button type="button" disabled={busy || (asking !== 'delete' && !reason.trim())} onClick={() => void confirm()}
                className={`btn-primary disabled:opacity-50 ${asking === 'credit' ? '' : 'bg-red-600 hover:bg-red-700'}`}>
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {busy
                  ? (asking === 'delete' ? t('invoices.deleting') : t('invoices.working'))
                  : asking === 'delete' ? t('invoices.deleteDraft') : asking === 'cancel' ? t('invoices.cancelInvoice') : t('invoices.createCreditNote')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
