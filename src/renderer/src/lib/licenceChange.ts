/**
 * The owner's notice for a licence that arrived with the updates
 * (main/licenceDelivery.ts): what changed, one line each.
 */
import { PLAN_LABEL, type LicenceModule } from '@shared/license/token'
import { licenceDifference, type LicenceChange } from '@shared/license/published'
import { t } from '@/lib/i18n'

/** The modules' names, as Settings → Licence shows them. */
export const MODULE_LABEL: Record<LicenceModule, () => string> = {
  jobs:     () => t('settings.moduleJobs'),
  payroll:  () => t('settings.modulePayroll'),
  stock:    () => t('settings.moduleStock'),
  invoices: () => t('settings.moduleInvoices'),
  patients: () => t('settings.modulePatients'),
  stats:    () => t('settings.moduleStats'),
  partners: () => t('settings.modulePartners'),
  ratings:  () => t('settings.moduleRatings'),
}

const seatsText = (n: number | null): string => (n === null ? t('settings.unlimited2') : String(n))

/** What changed between the licence before and the one installed now. */
export function licenceChangeLines(change: LicenceChange): string[] {
  const d = licenceDifference(change.from, change.to)
  const none = t('licenceUpdated.none')
  const lines: string[] = []
  if (d.modulesAdded.length) lines.push(t('licenceUpdated.modulesAdded', { modules: d.modulesAdded.map(m => MODULE_LABEL[m]()).join(', ') }))
  if (d.modulesRemoved.length) lines.push(t('licenceUpdated.modulesRemoved', { modules: d.modulesRemoved.map(m => MODULE_LABEL[m]()).join(', ') }))
  if (d.seats) lines.push(t('licenceUpdated.seats', { from: change.from ? seatsText(d.seats.from) : none, to: seatsText(d.seats.to) }))
  if (d.exp) lines.push(t('licenceUpdated.validUntil', { from: d.exp.from ?? none, to: d.exp.to }))
  if (d.plan) lines.push(t('licenceUpdated.plan', { from: d.plan.from ? PLAN_LABEL[d.plan.from] : none, to: PLAN_LABEL[d.plan.to] }))
  return lines.length ? lines : [t('licenceUpdated.sameTerms')]
}
