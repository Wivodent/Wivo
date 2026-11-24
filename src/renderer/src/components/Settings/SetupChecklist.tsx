/**
 * "Set up your clinic" (docs/design setup-and-settings.html): the owner's list
 * of first steps at the top of Settings. Each step is done or not from data
 * the app already has — nothing new is stored, except "hidden", which is this
 * computer's choice (localStorage).
 *
 * "Phones for staff" has no done state: it opens a short how-to.
 */
import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ViewMode } from '../../types/view'
import type { GroupKey } from '../SettingsPage'
import { useAuth } from '../../context/AuthContext'
import { useSettings } from '../../stores/useSettings'
import { usePipeline } from '../../context/PipelineContext'
import { usePermissions } from '../../hooks/usePermissions'
import { useClinicProfiles } from '../../hooks/useClinicProfiles'
import { useWorkerRates } from '../../hooks/useWorkerPay'
import { phoneUrl } from '../../lib/releaseNotes'
import { t } from '@/lib/i18n'

const hiddenKey = (clinicId: string | null) => `wivo.setupHidden.${clinicId ?? 'none'}`

export function setupHidden(clinicId: string | null): boolean {
  try { return localStorage.getItem(hiddenKey(clinicId)) === '1' } catch { return false }
}

interface Step {
  key: string
  label: string
  done: boolean | null
  action: string
  go: () => void
}

/** Pay rules exist: read only where payroll is in the licence (the hook subscribes). */
function usePayDone(enabled: boolean): boolean {
  const { data = [] } = useWorkerRates()
  return enabled && data.length > 0
}

export function SetupChecklist({ onOpenGroup, onOpenView, onHide }: {
  onOpenGroup: (k: GroupKey) => void
  onOpenView: (v: ViewMode) => void
  onHide: () => void
}) {
  const { clinic, clinicId } = useAuth()
  const { settings } = useSettings()
  const { stages } = usePipeline()
  const { moduleOn } = usePermissions()
  const { data: people = [] } = useClinicProfiles()
  const payroll = moduleOn('payroll')
  const payDone = usePayDone(payroll)
  const [phones, setPhones] = useState(false)

  const jobs = moduleOn('jobs')
  const steps: Step[] = [
    {
      key: 'clinic', label: t('setup.clinicDetails'),
      done: !!clinic?.name?.trim() && !!(clinic?.address?.trim() || clinic?.phone?.trim() || clinic?.email?.trim()),
      action: t('setup.open'), go: () => onOpenGroup('kliinik'),
    },
    {
      key: 'staff', label: people.length > 0 ? t('setup.staffN', { n: people.length }) : t('setup.staff'),
      done: people.length > 1, action: t('setup.addPeople'), go: () => onOpenView('workers'),
    },
    ...(jobs ? [
      { key: 'types', label: t('setup.workTypes'), done: settings.tooTuubid.length > 0, action: t('setup.open'), go: () => onOpenGroup('valikud') },
      { key: 'prices', label: t('setup.prices'), done: settings.tooTuubid.some(w => w.hind != null), action: t('setup.addPrices'), go: () => onOpenGroup('hinnad') },
      { key: 'machines', label: t('setup.machines'), done: settings.masinad.length > 0, action: t('setup.addMachines'), go: () => onOpenGroup('masinad') },
      { key: 'materials', label: t('setup.materials'), done: settings.materjalid.length > 0, action: t('setup.addMaterials'), go: () => onOpenGroup('valikud') },
      { key: 'stages', label: t('setup.stages'), done: stages.length > 1, action: t('setup.open'), go: () => onOpenGroup('etapid') },
    ] : []),
    ...(payroll ? [
      { key: 'pay', label: t('setup.pay'), done: payDone, action: t('setup.open'), go: () => onOpenView('tootasud') },
    ] : []),
    { key: 'phones', label: t('setup.phones'), done: null, action: t('setup.howTo'), go: () => setPhones(true) },
  ]
  const counted = steps.filter(s => s.done !== null)
  const doneCount = counted.filter(s => s.done).length
  const pct = counted.length ? Math.round(doneCount / counted.length * 100) : 100

  return (
    <section className="card p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-ink">{t('setup.title')}</h2>
          <p className="text-base text-ink-muted mt-1">{t('setup.progress', { done: doneCount, total: counted.length })}</p>
        </div>
        <button
          type="button"
          onClick={() => { try { localStorage.setItem(hiddenKey(clinicId), '1') } catch { /* private mode */ } onHide() }}
          className="min-h-[40px] px-3 text-base text-ink-muted hover:text-ink"
        >
          {t('setup.hide')}
        </button>
      </div>
      <div className="h-2.5 rounded-full bg-bg-sidebar overflow-hidden" aria-hidden="true">
        <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
        {steps.map(s => (
          <li
            key={s.key}
            className={`flex items-center justify-between gap-3 min-h-[60px] rounded-xl pl-4 pr-2 ${
              s.done ? 'border border-ink-faint/20 text-ink-muted' : 'border-2 border-amber-300 bg-amber-50/60 text-ink font-semibold'
            }`}
          >
            <span className="flex items-center gap-3 text-base">
              {s.done
                ? <span className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center"><Check size={16} aria-hidden="true" /></span>
                : <span className="w-7 h-7 rounded-full border-2 border-amber-500" aria-hidden="true" />}
              <span>{s.label}{s.done && <span className="sr-only"> · {t('setup.doneWord')}</span>}</span>
            </span>
            {!s.done && (
              <button type="button" onClick={s.go}
                className="min-h-[44px] px-4 rounded-xl bg-accent text-white text-sm font-bold hover:opacity-90">
                {s.action}
              </button>
            )}
          </li>
        ))}
      </ul>

      {phones && (
        <div role="dialog" aria-modal="true" aria-labelledby="setup-phones-h"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setPhones(false)}>
          <div className="card p-6 max-w-lg w-full space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h3 id="setup-phones-h" className="text-xl font-bold text-ink">{t('setup.phonesTitle')}</h3>
              <button type="button" onClick={() => setPhones(false)} aria-label={t('setup.close')}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <p className="text-base text-ink-soft">{t('setup.phonesIntro', { url: phoneUrl() })}</p>
            <ol className="list-decimal pl-5 space-y-2 text-base text-ink">
              <li>{t('setup.phonesIphone')}</li>
              <li>{t('setup.phonesAndroid')}</li>
              <li>{t('setup.phonesNotify')}</li>
            </ol>
            <button type="button" onClick={() => setPhones(false)}
              className="min-h-[48px] px-6 rounded-xl bg-accent text-white text-base font-bold">
              {t('setup.close')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
