/**
 * Payroll in a Latvian clinic: the person's tax profile and the payslip
 * estimate, both from shared/payroll/countryTax.ts. The Estonian pickers and
 * payslip stay in PayrollView, unchanged.
 *
 * Where the facts live (sql/127):
 *   tax booklet with us  maksuvaba_tulu: 0 = no, NULL = yes (the default)
 *   dependents           ulalpeetavad (NULL = 0)
 *   pensioner            pensionar (NULL = no)
 * A database without sql/127 has neither of the last two: they read as their
 * defaults and saving them says the feature is not available yet.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Minus, Plus } from 'lucide-react'
import { latviaPayslip, latviaRulesFor, type LatviaPayslip, type LatviaTaxProfile } from '@shared/payroll/countryTax'
import { updateProfile } from '../../lib/supabase'
import { describeError } from '../Patients/errors'
import { t } from '@/lib/i18n'

export interface LatviaWorkerFields {
  maksuvaba_tulu?: number | null
  ulalpeetavad?: number | null
  pensionar?: boolean | null
}

export function latviaProfileOf(w: LatviaWorkerFields): LatviaTaxProfile {
  return {
    taxBooklet: w.maksuvaba_tulu !== 0,
    dependents: w.ulalpeetavad ?? 0,
    pensioner: w.pensionar === true,
  }
}

/** This year's estimate for a gross amount. */
export function latviaSlipFor(gross: number, w: LatviaWorkerFields): LatviaPayslip {
  return latviaPayslip(gross, latviaProfileOf(w), latviaRulesFor(new Date().getFullYear()))
}

/** A column this database does not have yet (PostgREST / Postgres). */
const missingColumn = (err: unknown): boolean => {
  const e = err as { code?: string; message?: string } | null
  return e?.code === 'PGRST204' || e?.code === '42703' || /column .* does not exist|schema cache/i.test(e?.message ?? '')
}

function YesNo({ value, onChange, disabled, label }: {
  value: boolean; onChange: (v: boolean) => void; disabled: boolean; label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1 bg-bg-sidebar rounded-lg p-1 w-fit">
      {[true, false].map(v => (
        <button
          key={String(v)}
          type="button"
          disabled={disabled}
          aria-pressed={value === v}
          onClick={() => value !== v && onChange(v)}
          className={`min-h-[36px] px-4 rounded-md text-sm font-medium transition-colors disabled:opacity-50 ${
            value === v ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {v ? t('workers.lvYes') : t('workers.lvNo')}
        </button>
      ))}
    </div>
  )
}

export function LatviaTaxProfilePicker({ profileId, worker }: { profileId: string; worker: LatviaWorkerFields }) {
  const qc = useQueryClient()
  const rules = latviaRulesFor(new Date().getFullYear())
  const p = latviaProfileOf(worker)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(updates: Parameters<typeof updateProfile>[1]) {
    setSaving(true); setError(null)
    try {
      await updateProfile(profileId, updates)
      await qc.invalidateQueries({ queryKey: ['clinic_profiles'] })
    } catch (err) {
      setError(missingColumn(err) ? t('app.notAvailableYet') : describeError(err))
    } finally {
      setSaving(false)
    }
  }

  const dependents = p.dependents ?? 0
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">{t('workers.lvTaxBooklet')}</p>
          {/* No = 0 tax-free here; yes = NULL, the country's default. */}
          <YesNo value={p.taxBooklet !== false} disabled={saving} label={t('workers.lvTaxBooklet')}
            onChange={v => void save({ maksuvaba_tulu: v ? null : 0 })} />
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">{t('workers.lvDependents')}</p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={saving || dependents <= 0}
              aria-label={`${t('workers.lvDependents')} −1`}
              onClick={() => void save({ ulalpeetavad: Math.max(0, dependents - 1) })}
              className="w-9 h-9 rounded-lg border border-ink-faint/30 flex items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40">
              <Minus size={14} />
            </button>
            <span className="text-lg font-semibold text-ink tabular-nums w-8 text-center">{dependents}</span>
            <button type="button" disabled={saving || dependents >= 20}
              aria-label={`${t('workers.lvDependents')} +1`}
              onClick={() => void save({ ulalpeetavad: dependents + 1 })}
              className="w-9 h-9 rounded-lg border border-ink-faint/30 flex items-center justify-center text-ink-muted hover:text-ink disabled:opacity-40">
              <Plus size={14} />
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">{t('workers.lvPensioner')}</p>
          <YesNo value={p.pensioner === true} disabled={saving} label={t('workers.lvPensioner')}
            onChange={v => void save({ pensionar: v })} />
        </div>
      </div>
      <p className="text-xs text-ink-faint leading-relaxed">
        {t('workers.lvTaxProfileHelp', { minimum: rules.nonTaxableMinimum, dependent: rules.dependentAllowance })}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

export function LatviaPayslipPanel({ slip }: { slip: LatviaPayslip }) {
  const year = latviaRulesFor(new Date().getFullYear()).year
  const rows: { label: string; value: number; strong?: boolean; sign?: '−' }[] = [
    { label: t('workers.gross2'), value: slip.gross, strong: true },
    { label: t('workers.lvSocialEmployee', { pct: slip.employeeSocialPct }), value: slip.employeeSocial, sign: '−' },
    { label: t('workers.lvIncomeTax', { pct: slip.incomeTaxPct }), value: slip.incomeTax, sign: '−' },
  ]
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className={`flex justify-between text-sm ${r.strong ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
          <span>{r.label}</span>
          <span className="tabular-nums">{r.sign ? `${r.sign}${r.value.toFixed(2)}` : r.value.toFixed(2)} €</span>
        </div>
      ))}
      <div className="flex justify-between text-base font-bold text-ink border-t border-ink-faint/15 pt-2">
        <span>{t('workers.takeHome2')}</span>
        <span className="tabular-nums">{slip.net.toFixed(2)} €</span>
      </div>
      <div className="flex justify-between text-sm text-ink-muted">
        <span>{t('workers.lvEmployerSocial', { pct: slip.employerSocialPct })}</span>
        <span className="tabular-nums">{slip.employerSocial.toFixed(2)} €</span>
      </div>
      <div className="flex justify-between text-sm text-ink-muted">
        <span>{t('workers.costToClinic')}</span>
        <span className="tabular-nums">{slip.employerCost.toFixed(2)} €</span>
      </div>
      {slip.minimumWageApplied && (
        <p className="text-xs text-orange-600 leading-relaxed">{t('workers.lvMinWageNote', { min: slip.socialBase.toFixed(2) })}</p>
      )}
      <p className="text-xs text-ink-faint border-t border-ink-faint/15 pt-2 leading-relaxed">
        {t('workers.lvEstimateNote', { year })}
      </p>
    </div>
  )
}
