/**
 * Settings → Invoices → "Automatic invoicing" (sql/151). Off by default; a
 * client's card can override it (Clients). The database makes the invoice the
 * moment the client confirms (or at the month's end) and keeps it a draft when
 * something is missing; "Send automatically" goes out through the clinic's
 * automatic e-mail (Settings → Email), with its daily cap and test address.
 */
import { AlertTriangle, Zap } from 'lucide-react'
import { useSettings } from '../../stores/useSettings'
import type { AutoMode, AutoSend, AutoTrigger } from '@shared/billing/autoInvoice'
import { t } from '@/lib/i18n'

export const autoTriggerText = (v: AutoTrigger): string => (v === 'fitted' ? t('autoInvoice.triggerFitted') : t('autoInvoice.triggerReceived'))
export const autoModeText = (v: AutoMode): string => (v === 'monthly' ? t('autoInvoice.modeMonthly') : t('autoInvoice.modePerJob'))
export const autoSendText = (v: AutoSend): string => (v === 'auto' ? t('autoInvoice.sendAuto') : t('autoInvoice.sendDraft'))

export function AutoInvoiceSection({ onOpenEmail }: { onOpenEmail: () => void }) {
  const { settings, setAutoArve } = useSettings()
  const a = settings.autoArve
  const mailOn = settings.epost.saatmineLubatud && settings.epost.lubaArved && !!settings.epost.saatjaAadress?.trim()
  return (
    <section className="space-y-3" aria-label={t('autoInvoice.title')}>
      <div className="flex items-center gap-2">
        <Zap size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('autoInvoice.title')}</h3>
      </div>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={a.on} onChange={e => setAutoArve({ on: e.target.checked })} />
        <span><span className="font-semibold">{t('autoInvoice.on')}</span>
          <span className="block text-xs text-ink-muted">{t('autoInvoice.help')}</span></span>
      </label>
      {a.on && (
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block"><span className="label">{t('autoInvoice.trigger')}</span>
            <select className="input" value={a.trigger} onChange={e => setAutoArve({ trigger: e.target.value as AutoTrigger })}>
              <option value="received">{autoTriggerText('received')}</option>
              <option value="fitted">{autoTriggerText('fitted')}</option>
            </select></label>
          <label className="block"><span className="label">{t('autoInvoice.mode')}</span>
            <select className="input" value={a.mode} onChange={e => setAutoArve({ mode: e.target.value as AutoMode })}>
              <option value="per_job">{autoModeText('per_job')}</option>
              <option value="monthly">{autoModeText('monthly')}</option>
            </select></label>
          <label className="block"><span className="label">{t('autoInvoice.send')}</span>
            <select className="input" value={a.send} onChange={e => setAutoArve({ send: e.target.value as AutoSend })}>
              <option value="draft">{autoSendText('draft')}</option>
              <option value="auto">{autoSendText('auto')}</option>
            </select></label>
        </div>
      )}
      {a.on && a.mode === 'monthly' && <p className="text-xs text-ink-muted">{t('autoInvoice.monthlyHint')}</p>}
      {a.on && <p className="text-xs text-ink-muted">{t('autoInvoice.draftWhen')}</p>}
      {a.on && a.send === 'auto' && !mailOn && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>{t('autoInvoice.mailOff')} <button type="button" onClick={onOpenEmail} className="text-accent hover:underline">{t('autoInvoice.openEmail')}</button></span>
        </p>
      )}
    </section>
  )
}
