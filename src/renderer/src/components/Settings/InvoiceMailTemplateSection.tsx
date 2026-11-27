/**
 * Settings → Invoices: the letter around an e-mailed invoice (subject, the
 * words above it, the words below it), moved here from Settings → Email,
 * which keeps the mailbox, what may be sent, the limit and the test address.
 *
 * The automatic sender and "Send by e-mail" both start from it; a letter the
 * clinic has never touched is the plain one in the invoice's language
 * (shared/billing/mailTemplate mailTemplateForInvoice).
 */
import { useEffect } from 'react'
import { Mail } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../stores/useSettings'
import type { MailSettings } from '../../stores/useSettings'
import {
  renderTemplate, unknownTokens, TEMPLATE_TOKENS, defaultMailTemplateFor, isUntouchedDefaultTemplate,
} from '@shared/billing/mailTemplate'
import { t } from '@/lib/i18n'
import type { MessageKey } from '@shared/i18n'

/** What each token means, in the reader's language. */
const TOKEN_HELP: Record<string, MessageKey> = {
  '{arve}': 'settings.tokenArve', '{saaja}': 'settings.tokenSaaja', '{summa}': 'settings.tokenSumma',
  '{tasumata}': 'settings.tokenTasumata', '{tahtaeg}': 'settings.tokenTahtaeg',
  '{kuupaev}': 'settings.tokenKuupaev', '{kliinik}': 'settings.tokenKliinik',
}

export function InvoiceMailTemplateSection() {
  const { settings, setEpost } = useSettings()
  const { clinic, role } = useAuth()
  const e = settings.epost
  const patch = (p: Partial<MailSettings>) => setEpost(p)

  /**
   * A made-up invoice for the preview, signed with the clinic's OWN name.
   * The invoice number and sums are recognisably fake on purpose: a preview
   * using real numbers invites reading it as a real document.
   */
  const PREVIEW_VARS: Record<string, string> = {
    arve: '2026-0007',
    saaja: t('settings.previewRecipient'),
    summa: '1220.00 €',
    tasumata: '1220.00 €',
    tahtaeg: '15.09.2026',
    kuupaev: '01.09.2026',
    kliinik: clinic?.name?.trim() || t('settings.previewClinicFallback'),
  }

  // The letter a clinic has never touched is the default in the CLINIC's
  // language: an English clinic gets the English letter, not the Estonian one
  // every clinic was seeded with. An edited letter is never replaced. Owner
  // only — the clinic's settings are the owner's to write.
  const clinicLang = clinic?.default_language
  const wanted = defaultMailTemplateFor(clinicLang)
  const untouched = isUntouchedDefaultTemplate(e)
  const needsSwap = role === 'owner' && !!clinicLang && untouched && e.pealkiri !== wanted.pealkiri
  useEffect(() => {
    if (needsSwap) setEpost({ ...wanted })
  }, [needsSwap]) // eslint-disable-line react-hooks/exhaustive-deps

  const unknown = [
    ...unknownTokens(e.pealkiri, PREVIEW_VARS),
    ...unknownTokens(e.sissejuhatus, PREVIEW_VARS),
    ...unknownTokens(e.lopp, PREVIEW_VARS),
  ]

  return (
    <section className="space-y-3 max-w-2xl" aria-label={t('settings.emailText')}>
      <div className="space-y-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink"><Mail size={14} className="text-accent" /> {t('settings.emailText')}</h3>
          <p className="text-xs text-ink-muted leading-relaxed">
            {t('settings.theInvoiceItselfIsAlwaysIn')}{' '}
            <strong>{t('settings.around')}</strong>
            {t('settings.itAGreetingBeforeAndA')}
          </p>
        </div>

        <div>
          <label className="label">{t('settings.subject')}</label>
          <input
            type="text" value={e.pealkiri}
            onChange={ev => patch({ pealkiri: ev.target.value })}
            className="input"
          />
        </div>

        <div>
          <label className="label">{t('settings.introductionAboveTheInvoice')}</label>
          <textarea
            value={e.sissejuhatus} rows={5}
            onChange={ev => patch({ sissejuhatus: ev.target.value })}
            className="input resize-none font-mono text-xs leading-relaxed"
          />
        </div>

        <div>
          <label className="label">{t('settings.closingBelowTheInvoice')}</label>
          <textarea
            value={e.lopp} rows={3}
            onChange={ev => patch({ lopp: ev.target.value })}
            className="input resize-none font-mono text-xs leading-relaxed"
          />
        </div>

        <div>
          <p className="text-[11px] font-medium text-ink-muted mb-1">
            {t('settings.placeholdersClickToAddToThe')}
          </p>
          <div className="flex flex-wrap gap-1">
            {TEMPLATE_TOKENS.map(tok => (
              <button
                key={tok.token}
                type="button"
                title={TOKEN_HELP[tok.token] ? t(TOKEN_HELP[tok.token]) : tok.token}
                onClick={() => patch({ sissejuhatus: `${e.sissejuhatus}${tok.token}` })}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-bg-sidebar text-ink-muted hover:text-accent transition-colors"
              >
                {tok.token}
              </button>
            ))}
          </div>
        </div>

        {/* Rendered with the SAME functions the sender uses, so the preview
            cannot promise wording the patient does not get. */}
        {unknown.length > 0 && (
          <p className="text-[11px] text-orange-600">
            {t('settings.unknownPlaceholder')} {unknown.map(token => `{${token}}`).join(', ')}{' '}
            {t('settings.itGoesIntoTheEmailExactly')}
          </p>
        )}

        <div className="rounded-xl border border-ink-faint/20 bg-white p-3">
          <p className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider mb-2">
            {t('settings.preview')}
          </p>
          <p className="text-xs font-semibold text-ink mb-2">
            {renderTemplate(e.pealkiri, PREVIEW_VARS)}
          </p>
          <p className="text-[11px] text-ink-soft whitespace-pre-line leading-relaxed">
            {renderTemplate(e.sissejuhatus, PREVIEW_VARS)}
          </p>
          <div className="my-2 border-t border-dashed border-ink-faint/30 py-2">
            <p className="text-[10px] text-ink-faint italic">{t('settings.invoiceHeaderLinesTotalsPaymentDetails')}</p>
          </div>
          <p className="text-[11px] text-ink-soft whitespace-pre-line leading-relaxed">
            {renderTemplate(e.lopp, PREVIEW_VARS)}
          </p>
        </div>
      </div>

    </section>
  )
}
