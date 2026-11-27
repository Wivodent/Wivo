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

export function AutoInvoiceNote({ invoice }: { invoice: Pick<Invoice, 'auto_created_at' | 'auto_trigger' | 'auto_period' | 'auto_reasons' | 'status'> }) {
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
    </div>
  )
}
