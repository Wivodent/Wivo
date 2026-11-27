/**
 * "Created automatically" on an invoice (sql/151): when (the client confirmed
 * Received or Fitted), the month of a monthly invoice, and why it is a draft.
 */
import { format } from 'date-fns'
import { Zap } from 'lucide-react'
import { isAutoReason, type AutoReason } from '@shared/billing/autoInvoice'
import type { Invoice } from '../../types/invoice'
import { t, dateLocale } from '@/lib/i18n'

export const autoReasonText = (r: AutoReason): string => {
  switch (r) {
    case 'no_price': return t('autoInvoice.reasonNoPrice')
    case 'no_email': return t('autoInvoice.reasonNoEmail')
    case 'buyer_details': return t('autoInvoice.reasonBuyerDetails')
    case 'mail_off': return t('autoInvoice.reasonMailOff')
    case 'failed': return t('autoInvoice.reasonFailed')
    default: return t('autoInvoice.reasonReview')
  }
}

export function AutoInvoiceNote({ invoice, onAddEmail }: {
  invoice: Pick<Invoice, 'auto_created_at' | 'auto_trigger' | 'auto_period' | 'auto_reasons' | 'status' | 'customer_id'>
  /** Opens the client's card (sql/152): where the missing e-mail goes. */
  onAddEmail?: (customerId: string) => void
}) {
  if (!invoice.auto_created_at) return null
  const date = format(new Date(invoice.auto_created_at), 'd MMM yyyy', { locale: dateLocale })
  const reasons = (invoice.auto_reasons ?? []).filter(isAutoReason)
  return (
    <div className="rounded-lg border border-accent/20 bg-accent/5 px-2.5 py-1.5 text-[11px] text-ink-muted space-y-0.5">
      <p className="flex items-center gap-1.5 text-ink">
        <Zap size={11} className="text-accent" aria-hidden="true" />
        {invoice.auto_trigger === 'fitted' ? t('autoInvoice.createdFitted', { date }) : t('autoInvoice.createdReceived', { date })}
      </p>
      {invoice.auto_period && <p>{t('autoInvoice.monthlyFor', { period: invoice.auto_period })}</p>}
      {invoice.status === 'mustand' && reasons.length > 0 && (
        <p>{t('autoInvoice.draftBecause', { reasons: reasons.map(autoReasonText).join('; ') })}</p>
      )}
      {/* The one reason the clinic fixes on the client's card: said plainly, with the way there. */}
      {invoice.status === 'mustand' && reasons.includes('no_email') && (
        <p className="flex flex-wrap items-center gap-2 font-semibold text-amber-800">
          {t('autoInvoice.notSentNoEmail')}
          {onAddEmail && invoice.customer_id && (
            <button type="button" onClick={() => onAddEmail(invoice.customer_id!)} className="rounded border border-amber-400 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
              {t('autoInvoice.addEmail')}
            </button>
          )}
        </p>
      )}
    </div>
  )
}
