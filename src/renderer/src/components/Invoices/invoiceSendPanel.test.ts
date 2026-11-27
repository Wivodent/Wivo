/**
 * From testing (2026-11-27): "Send by e-mail" wrapped onto several lines in the
 * invoice panel; a draft's letter said "Invoice DRAFT"; the test copy's
 * "not one of the allowed addresses" did not say how to fix it.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { en } from '@shared/i18n/en'
import { et } from '@shared/i18n/et'
import { ru } from '@shared/i18n/ru'

const read = (p: string) => readFileSync(p, 'utf8')

describe('the invoice panel and "Send by e-mail"', () => {
  it('the button keeps one line, an envelope; on a narrow panel the envelope alone with its name as the tooltip', () => {
    const view = read('src/renderer/src/components/Invoices/InvoicesView.tsx')
    expect(view).toContain('<div className="min-w-0 flex-1">')
    expect(view).toContain('<div className="flex flex-shrink-0 items-center gap-1">')
    expect(view).toContain('className="btn-ghost whitespace-nowrap text-xs border border-ink-faint/25"')
    expect(view).toContain('<Mail size={13} aria-hidden="true" /> <span className="invoice-send-label">{t(\'sendInvoice.button\')}</span>')
    expect(view).toContain("title={t('sendInvoice.button')} aria-label={t('sendInvoice.button')}")
    expect(view).toContain('className="invoice-panel ')
    const css = read('src/renderer/src/styles/index.css')
    expect(css).toContain('.invoice-panel { container-type: inline-size; }')
    expect(css).toMatch(/@container \(max-width: 359px\) \{\s*\.invoice-send-label \{ display: none; \}/)
  })

  it('a draft’s letter is written with the number it will get, and sent with that number to check', () => {
    const dialog = read('src/renderer/src/components/Invoices/SendInvoiceDialog.tsx')
    expect(dialog).toContain("supabase.rpc('upcoming_invoice_number', { p_clinic: invoice.clinic_id })")
    expect(dialog).toContain('prefillLetter(invoice, clinic, language, settings.epost, addressee, upcoming.data)')
    expect(dialog).toContain('expectedNumber: number')
    expect(dialog).toContain("e.code === 'number_changed'")
    expect(dialog).toContain("t('sendInvoice.numberChanged', { from: renumbered.from, to: renumbered.to })")
    expect(dialog).toContain("t('sendInvoice.title', { number })")
  })

  it('the test copy’s refusal says where the allowed addresses are set', () => {
    for (const lang of [en, et, ru]) {
      const text = String(lang['sendInvoice.errTestAddressNotAllowed'])
      expect(text).toContain('Supabase → Edge Functions → Secrets')
      expect(text).toContain('EMAIL_ALLOW_ONLY')
    }
  })
})
