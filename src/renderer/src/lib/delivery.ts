/**
 * Where a sent job is on its way to whoever ordered it (sql/145):
 *
 *   not sent → awaiting (sent, not confirmed) → received
 *                     ↘ problem (until the clinic resolves it)
 *
 * One answer for the job page, the Orders page and the phone. Pure: no
 * database here (the network-only build uses the labels too).
 *
 * A job sent before sql/145 has no sent_at and counts as received: nobody is
 * asked about old work. A database without 145 has no sent_at at all
 * (undefined): the same, so the screens behave as before.
 */
import { t } from '@/lib/i18n'

export type DeliveryStep = 'not_sent' | 'awaiting' | 'problem' | 'received'

export interface DeliveryJob {
  delivery_status?: string | null
  sent_at?: string | null
  received_at?: string | null
}

export const isSent = (j: DeliveryJob): boolean => j.delivery_status === 'teel' || j.delivery_status === 'yle_antud'

/** Received: the orderer said so, or it was sent before this step existed. */
export const isReceived = (j: DeliveryJob): boolean => isSent(j) && (!!j.received_at || !j.sent_at)

export function deliveryStep(j: DeliveryJob, openProblem: boolean): DeliveryStep {
  if (!isSent(j)) return 'not_sent'
  if (openProblem) return 'problem'
  return isReceived(j) ? 'received' : 'awaiting'
}

/** Sent more than `days` days ago and still not confirmed: "Not confirmed" on the Orders page. */
export function notConfirmed(j: DeliveryJob, openProblem: boolean, days: number, now: Date = new Date()): boolean {
  if (deliveryStep(j, openProblem) !== 'awaiting' || !j.sent_at) return false
  return now.getTime() - new Date(j.sent_at).getTime() > Math.max(1, days) * 86_400_000
}

/** The clinic's setting, as the database reads it (received_reminder_days): 1–60, 3 when unset. */
export const reminderDays = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : 3
  return Math.min(60, Math.max(1, v))
}

export const PROBLEM_REASONS = ['not_arrived', 'damaged', 'wrong_item', 'missing_parts', 'other'] as const
export type ProblemReason = (typeof PROBLEM_REASONS)[number]
export const RESOLUTIONS = ['resend', 'replaced', 'other'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

/** Damaged work or a wrong item may become a remake when the clinic resolves it. */
export const mayRemake = (reason: string): boolean => reason === 'damaged' || reason === 'wrong_item'

export function problemReasonText(r: string): string {
  switch (r) {
    case 'not_arrived': return t('delivery.reasonNotArrived')
    case 'damaged': return t('delivery.reasonDamaged')
    case 'wrong_item': return t('delivery.reasonWrongItem')
    case 'missing_parts': return t('delivery.reasonMissingParts')
    default: return t('delivery.reasonOther')
  }
}

export function resolutionText(r: string): string {
  switch (r) {
    case 'resend': return t('delivery.resolutionResend')
    case 'replaced': return t('delivery.resolutionReplaced')
    default: return t('delivery.resolutionOther')
  }
}
