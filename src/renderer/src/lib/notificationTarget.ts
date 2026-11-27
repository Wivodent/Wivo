/**
 * Where a bell notification takes you — one answer for the desktop and the
 * phone, so the two cannot send the same notice to different places.
 *
 *   our own job                       → that job
 *   a Network order or a client's     → Orders, that order opened; once the
 *   message on it (sql/138, 142)        order was accepted, the job it became
 *   a request to connect              → Orders, at "Asking to connect"
 *   a security / update notice        → Settings
 *   a job shared with us (partners)   → "Shared with us", and only with the
 *                                       partners module; never for anything else
 *   anything else                     → nowhere (the text says it all)
 */
import type { AppNotification } from '../hooks/useNotifications'
import { isSecurityNotice, isUpdateNotice } from '../hooks/useNotifications'

export type NotificationTarget =
  | { to: 'job'; jobId: string }
  | { to: 'order'; orderId: string }
  | { to: 'requests' }
  | { to: 'settings'; group?: 'turvalisus' }
  | { to: 'partner' }
  | null

/** The partnership's own notices: the only ones that may open "Shared with us". */
const PARTNER_KINDS = new Set(['job_shared', 'stage_handover', 'files_added', 'question'])
/** The Network's notices about one order. */
const ORDER_KINDS = new Set(['client_order', 'client_message', 'client_review'])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function notificationTarget(
  n: Pick<AppNotification, 'kind' | 'job_id' | 'detail'>,
  ctx: { isOwnJob: (jobId: string) => boolean; partnersOn: boolean },
): NotificationTarget {
  if (isSecurityNotice(n)) return { to: 'settings', group: 'turvalisus' }
  if (isUpdateNotice(n)) return { to: 'settings' }
  if (ORDER_KINDS.has(n.kind)) {
    // Accepted already: the job is where the work and its talk now are.
    if (n.job_id && ctx.isOwnJob(n.job_id)) return { to: 'job', jobId: n.job_id }
    const order = n.detail?.order
    return typeof order === 'string' && UUID.test(order) ? { to: 'order', orderId: order } : { to: 'requests' }
  }
  if (n.kind === 'client_request') return { to: 'requests' }
  if (n.job_id && ctx.isOwnJob(n.job_id)) return { to: 'job', jobId: n.job_id }
  if (PARTNER_KINDS.has(n.kind) && n.job_id && ctx.partnersOn) return { to: 'partner' }
  return null
}
