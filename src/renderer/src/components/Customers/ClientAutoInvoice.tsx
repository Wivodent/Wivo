/**
 * A client's own automatic invoicing (sql/151): each part empty = the clinic's
 * choice (Settings → Invoices), shown in brackets so nobody has to look it up.
 */
import { useSettings } from '../../stores/useSettings'
import { policyForClient, type AutoMode, type AutoSend, type AutoTrigger, type ClientAutoInvoice } from '@shared/billing/autoInvoice'
import { autoModeText, autoSendText, autoTriggerText } from '../Settings/AutoInvoiceSection'
import { t } from '@/lib/i18n'

export function ClientAutoInvoiceFields({ value, onChange }: {
  value: ClientAutoInvoice
  onChange: (patch: Partial<ClientAutoInvoice>) => void
}) {
  const { settings } = useSettings()
  const clinic = settings.autoArve
  const now = policyForClient(clinic, value)
  const onOff = (v: boolean) => (v ? t('autoInvoice.clientOn') : t('autoInvoice.clientOff'))
  return (
    <fieldset className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
      <legend className="px-1 text-xs font-semibold text-ink">{t('autoInvoice.title')}</legend>
      <select className="input" aria-label={t('autoInvoice.title')}
        value={value.auto_invoice_on == null ? '' : value.auto_invoice_on ? 'on' : 'off'}
        onChange={e => onChange({ auto_invoice_on: e.target.value === '' ? null : e.target.value === 'on' })}>
        <option value="">{t('autoInvoice.clientDefault', { value: onOff(clinic.on) })}</option>
        <option value="on">{t('autoInvoice.clientOn')}</option>
        <option value="off">{t('autoInvoice.clientOff')}</option>
      </select>
      {now.on && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block"><span className="label">{t('autoInvoice.trigger')}</span>
            <select className="input" value={value.auto_invoice_trigger ?? ''}
              onChange={e => onChange({ auto_invoice_trigger: (e.target.value || null) as AutoTrigger | null })}>
              <option value="">{t('autoInvoice.clientDefault', { value: autoTriggerText(clinic.trigger) })}</option>
              <option value="received">{autoTriggerText('received')}</option>
              <option value="fitted">{autoTriggerText('fitted')}</option>
            </select></label>
          <label className="block"><span className="label">{t('autoInvoice.mode')}</span>
            <select className="input" value={value.auto_invoice_mode ?? ''}
              onChange={e => onChange({ auto_invoice_mode: (e.target.value || null) as AutoMode | null })}>
              <option value="">{t('autoInvoice.clientDefault', { value: autoModeText(clinic.mode) })}</option>
              <option value="per_job">{autoModeText('per_job')}</option>
              <option value="monthly">{autoModeText('monthly')}</option>
            </select></label>
          <label className="block"><span className="label">{t('autoInvoice.send')}</span>
            <select className="input" value={value.auto_invoice_send ?? ''}
              onChange={e => onChange({ auto_invoice_send: (e.target.value || null) as AutoSend | null })}>
              <option value="">{t('autoInvoice.clientDefault', { value: autoSendText(clinic.send) })}</option>
              <option value="draft">{autoSendText('draft')}</option>
              <option value="auto">{autoSendText('auto')}</option>
            </select></label>
        </div>
      )}
    </fieldset>
  )
}
