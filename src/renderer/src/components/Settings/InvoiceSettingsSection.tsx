/**
 * Settings → Prices → Invoices (sql/148): what the clinic's invoices say and
 * how they are numbered, for every country with Wivo's invoices
 * (shared/billing/countryInvoice).
 *
 *  - the document's language (Estonian, Latvian, English; the country's by default)
 *  - the number's prefix ("DEN-": letters, digits, - / _, no spaces) before
 *    the yearly sequence, which never repeats
 *  - VAT exempt, and the reason printed on every exempt invoice (e.g. the
 *    article of Latvia's VAT law)
 *  - the clinic's own details an invoice carries (registry code, VAT number,
 *    address, bank, IBAN): kept under Clinic details, shown here with what is
 *    missing
 *
 * The default VAT rate is the field just above (kmMaar); the country's
 * standard rate is a hint, never applied by itself.
 */
import { AlertTriangle, Check, FileText } from 'lucide-react'
import { useSettings } from '../../stores/useSettings'
import { useAuth } from '../../context/AuthContext'
import { clinicCountry } from '../../lib/country'
import { countryInvoicing, cleanPrefix, docLanguageFor, DOC_LANGUAGES, type DocLanguage } from '@shared/billing/countryInvoice'
import { t } from '@/lib/i18n'

const languageName = (l: DocLanguage): string => (l === 'et' ? t('invoiceSettings.langEt') : l === 'lv' ? t('invoiceSettings.langLv') : t('invoiceSettings.langEn'))

export function InvoiceSettingsSection({ onOpenClinic }: { onOpenClinic: () => void }) {
  const { settings, setText, setFlag } = useSettings()
  const { clinic } = useAuth()
  const country = clinicCountry(clinic)
  const rules = countryInvoicing(country)
  const lang = docLanguageFor(country, settings.arveKeel)
  const year = new Date().getFullYear()
  const c = (clinic ?? {}) as { reg_code?: string | null; vat_number?: string | null; address?: string | null; bank_name?: string | null; bank_account?: string | null }
  const details: { label: string; value: string | null | undefined; needed: boolean }[] = [
    { label: t('invoiceSettings.regCode'), value: c.reg_code, needed: true },
    { label: t('invoiceSettings.vatNumber'), value: c.vat_number, needed: !settings.kmVaba },
    { label: t('invoiceSettings.address'), value: c.address, needed: true },
    { label: t('invoiceSettings.bank'), value: c.bank_name, needed: false },
    { label: t('invoiceSettings.iban'), value: c.bank_account, needed: true },
  ]

  return (
    <section className="2xl:col-span-2 space-y-4" aria-label={t('invoiceSettings.title')}>
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{t('invoiceSettings.title')}</h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">{t('invoiceSettings.language')}</span>
          <select className="input" value={settings.arveKeel} onChange={e => setText('arveKeel', e.target.value)}>
            <option value="">{t('invoiceSettings.languageCountry', { language: languageName(rules.language) })}</option>
            {DOC_LANGUAGES.map(l => <option key={l} value={l}>{languageName(l)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('invoiceSettings.prefix')}</span>
          <input className="input font-mono" maxLength={12} value={settings.arvePrefiks}
            onChange={e => setText('arvePrefiks', cleanPrefix(e.target.value))} spellCheck={false} />
          <span className="block text-[11px] text-ink-faint mt-0.5">{t('invoiceSettings.prefixHint', { example: `${settings.arvePrefiks}${year}-0001` })}</span>
        </label>
      </div>

      {rules.standardVatPct !== null && !settings.kmVaba && settings.kmMaar !== rules.standardVatPct && (
        <p className="text-xs text-ink-muted">{t('invoiceSettings.standardRate', { rate: rules.standardVatPct, current: settings.kmMaar })}</p>
      )}

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4" checked={settings.kmVaba} onChange={e => setFlag('kmVaba', e.target.checked)} />
          <span><span className="font-semibold">{t('invoiceSettings.vatExempt')}</span>
            <span className="block text-xs text-ink-muted">{t('invoiceSettings.vatExemptHelp')}</span></span>
        </label>
        {settings.kmVaba && (
          <label className="block">
            <span className="label">{t('invoiceSettings.vatExemptNote')}</span>
            <textarea className="input resize-none" rows={2} maxLength={500} value={settings.kmVabaViide}
              onChange={e => setText('kmVabaViide', e.target.value)} placeholder={t('invoiceSettings.vatExemptNoteHint')} />
            {!settings.kmVabaViide.trim() && <span className="text-[11px] text-amber-700">{t('invoiceSettings.vatExemptNoteNeeded')}</span>}
          </label>
        )}
      </div>

      <div className="rounded-xl border border-ink-faint/20 p-3 space-y-1">
        <p className="text-xs font-semibold text-ink">{t('invoiceSettings.clinicDetails', { language: languageName(lang) })}</p>
        {details.map(d => (
          <p key={d.label} className="flex items-center gap-2 text-xs">
            {d.value?.trim()
              ? <Check size={12} className="text-emerald-600" aria-hidden="true" />
              : <AlertTriangle size={12} className={d.needed ? 'text-amber-600' : 'text-ink-faint'} aria-hidden="true" />}
            <span className="text-ink-muted w-32">{d.label}</span>
            <span className={d.value?.trim() ? 'text-ink' : d.needed ? 'text-amber-700' : 'text-ink-faint'}>{d.value?.trim() || t('invoiceSettings.missing')}</span>
          </p>
        ))}
        <button type="button" onClick={onOpenClinic} className="text-xs text-accent hover:underline">{t('invoiceSettings.editClinic')}</button>
      </div>
    </section>
  )
}
