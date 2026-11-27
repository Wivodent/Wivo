/**
 * A client's own price (sql/153): a discount off the clinic's whole list, and
 * its own price for any work type (over the list and the discount). The client
 * sees only these in Wivo Network, and accepting its orders prices them so
 * (shared/pricing/clientPrices).
 */
import { useState } from 'react'
import { useSettings } from '../../stores/useSettings'
import { clientFactor } from '@shared/pricing/clientPrices'
import { t } from '@/lib/i18n'

export function ClientPricesFields({ discount, prices, onChange }: {
  discount: number | null | undefined
  prices: Record<string, number> | null | undefined
  onChange: (patch: { discount_pct?: number | null; client_prices?: Record<string, number> }) => void
}) {
  const { settings } = useSettings()
  const own = prices ?? {}
  const [open, setOpen] = useState(Object.keys(own).length > 0)
  const factor = clientFactor({ discountPct: discount ?? null })
  const setOwn = (name: string, text: string) => {
    const n = Number(text.replace(',', '.'))
    const next = { ...own }
    if (text.trim() === '' || !Number.isFinite(n) || n <= 0) delete next[name]
    else next[name] = Math.round(n * 100) / 100
    onChange({ client_prices: next })
  }
  return (
    <fieldset className="space-y-2 rounded-xl border border-ink-faint/20 p-3">
      <legend className="px-1 text-xs font-semibold text-ink">{t('customers.pricesTitle')}</legend>
      <label className="flex items-center gap-2 text-sm text-ink">
        <span className="w-40">{t('customers.discountPct')}</span>
        <input className="input w-24" inputMode="decimal" value={discount ?? ''} placeholder="0"
          onChange={e => {
            const v = e.target.value.replace(',', '.').trim()
            const n = Number(v)
            onChange({ discount_pct: v === '' || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), 100) })
          }} />
        <span className="text-ink-muted">%</span>
      </label>
      <button type="button" onClick={() => setOpen(o => !o)} className="text-xs text-accent hover:underline">
        {open ? t('customers.ownPricesHide') : t('customers.ownPricesShow', { n: Object.keys(own).length })}
      </button>
      {open && (
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {settings.tooTuubid.map(w => {
            const list = typeof w.hind === 'number' && w.hind > 0 ? Math.round(w.hind * factor * 100) / 100 : null
            return (
              <label key={w.nimi} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">{w.nimi}</span>
                <input className="input w-28" inputMode="decimal" defaultValue={own[w.nimi] ?? ''} placeholder={list != null ? String(list) : '—'}
                  aria-label={t('customers.ownPriceFor', { work: w.nimi })} onBlur={e => setOwn(w.nimi, e.target.value)} />
                <span className="w-10 text-xs text-ink-muted">{w.hinnaTyyp === 'hammas' ? t('customers.perTooth') : '€'}</span>
              </label>
            )
          })}
        </div>
      )}
      <p className="text-[11px] text-ink-faint">{t('customers.pricesHint')}</p>
    </fieldset>
  )
}
