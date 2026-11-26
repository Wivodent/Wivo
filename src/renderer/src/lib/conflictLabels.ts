/**
 * What a conflict names (2.2.3): a job's field, or a part of the clinic's
 * settings, in words the person knows from the screen. A field without a
 * name of its own is "other details", never a column name.
 */
import type { MergeConflict } from '@shared/concurrency/merge'
import { t } from './i18n'

const JOB_FIELDS: Record<string, () => string> = {
  status: () => t('conflict.fStage'),
  patsient: () => t('conflict.fPatient'),
  patient_id: () => t('conflict.fPatient'),
  customer_id: () => t('conflict.fCustomer'),
  customer_ref: () => t('conflict.fCustomer'),
  kuupaev: () => t('conflict.fReceived'),
  valmis_aeg: () => t('conflict.fDeadline'),
  valmis_kuupaev: () => t('conflict.fFinished'),
  too: () => t('conflict.fWork'),
  work_items: () => t('conflict.fWork'),
  hambad: () => t('conflict.fTeeth'),
  materjal: () => t('conflict.fMaterial'),
  masina: () => t('conflict.fMachine'),
  varv: () => t('conflict.fShade'),
  kondivarv: () => t('conflict.fShade'),
  kirjeldus: () => t('conflict.fDescription'),
  hind: () => t('conflict.fPrice'),
  disain_hind: () => t('conflict.fPrice'),
  extras: () => t('conflict.fPrice'),
  extra_costs: () => t('conflict.fCosts'),
  kulu_yle: () => t('conflict.fCosts'),
  assigned_to: () => t('conflict.fTechnician'),
  designed_by: () => t('conflict.fDesigner'),
  revisions: () => t('conflict.fRevisions'),
  markused: () => t('conflict.fNotes'),
  makstud: () => t('conflict.fPayment'),
  makse_kuupaev: () => t('conflict.fPayment'),
  delivery_status: () => t('conflict.fDelivery'),
  delivered_at: () => t('conflict.fDelivery'),
  kiirtoo: () => t('conflict.fRush'),
}

export const jobFieldLabel = (field: string): string => (JOB_FIELDS[field] ?? (() => t('conflict.fOther')))()

const SETTINGS_COLUMNS: Record<string, () => string> = {
  work_types: () => t('conflict.sWorkTypes'),
  pricing: () => t('conflict.sPrices'),
  material_prices: () => t('conflict.sPrices'),
  material_costs: () => t('conflict.sPrices'),
  materials: () => t('conflict.sMaterials'),
  machines: () => t('conflict.sMachines'),
  pipeline_stages: () => t('conflict.sStages'),
  visit_types: () => t('conflict.sVisitTypes'),
  calendar: () => t('conflict.sCalendar'),
  payroll: () => t('conflict.sPayroll'),
}

/**
 * "Work types: Crown design" — the settings part and, inside a list, the
 * item both changed (its name or key, as the list identifies it).
 */
export function settingsConflictLabel(column: string, c: Pick<MergeConflict, 'path'>): string {
  const part = (SETTINGS_COLUMNS[column] ?? (() => t('conflict.fOther')))()
  const item = c.path[0]
  return column === 'work_types' || column === 'visit_types' || column === 'pipeline_stages' ? (item ? `${part}: ${item}` : part) : part
}
