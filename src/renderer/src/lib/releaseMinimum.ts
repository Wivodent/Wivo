/**
 * Below the minimum version in the clinic's signed release list
 * (docs/RELEASE.md §6a, main/releaseMinimum.ts), this desktop saves nothing
 * until it updates; reading goes on. The main process says whether this build
 * is below it; this module keeps that answer and refuses saves in the
 * database client's fetch, before they leave the machine, with the same
 * answer the database gives an old build (HTTP 426, `update_required`,
 * sql/104), so every screen that shows save errors already says "Update Wivo".
 *
 * A guard against old builds losing data, like sql/104: not a security
 * control. The database's rules (RLS, permissions) are the same for every build.
 */
import type { ReleaseMinimum } from '../../../types/update'

// ── What a save is ──────────────────────────────────────────────────────────

/**
 * The database functions this app calls that only read (declared `stable`,
 * sql/checks/schema_check.sql). Any other function call is a save.
 * lib/releaseMinimum.test.ts fails when a function the app calls is a read
 * but missing here, or is listed here and is not a read.
 */
export const READ_FUNCTIONS: ReadonlySet<string> = new Set([
  'app_min_version_for_me', 'audit_people', 'audit_search', 'can_move_stage', 'clinic_settings_private',
  'customers_full', 'deleted_jobs', 'has_mfa', 'job_activity', 'job_files', 'job_skipped_stages', 'job_thread', 'may_edit_job_stages',
  'client_feedback_summary', 'my_rating_summary',
  // sql/146: what a job is tied to, before deleting it.
  'job_delete_check',
  // sql/150: the number a draft will get, read for its e-mail without taking it.
  'upcoming_invoice_number',
  'open_questions', 'partner_orgs', 'partner_stock', 'pay_settings', 'preview_order_reference', 'team_accounts', 'update_status',
])

/**
 * Functions that change only the trace that reading leaves, so they stay
 * allowed: reading means opening a job, a file, a preview or a partner's
 * job, and exporting, and each of those is logged or granted first.
 */
export const READ_TRACES: ReadonlySet<string> = new Set([
  'log_job_view', //               the audit entry for opening a job (078)
  'mark_job_seen', //              opening a job: no longer "new" for me (136)
  'open_partner_job', //           opening a partner's job, audited (071)
  'preview_partnership_invite', // reading an invitation before accepting it (070)
  'audit_export', //               the audit entry an export leaves before the file is made (106)
  'patient_export', //             a patient's data export, audited (081)
  'mark_notifications_read', //    marking notifications as read
  'record_mfa_factors', //         the second factor, recorded at sign-in (097)
])

/** Edge Functions that only read: a file's download link. */
const READ_EDGE_FUNCTIONS = new Set(['file-link'])

const READS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Does this request to the database change something? */
export function isSaveRequest(url: string, method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase()
  if (READS.has(m)) return false
  let path: string
  try { path = new URL(url).pathname } catch { return false }
  const rpc = /^\/rest\/v1\/rpc\/([A-Za-z0-9_]+)\/?$/.exec(path)
  if (rpc) return !READ_FUNCTIONS.has(rpc[1]) && !READ_TRACES.has(rpc[1])
  if (path.startsWith('/rest/v1/')) return true
  if (path.startsWith('/storage/v1/')) {
    // A signed link, a listing or a file's details: reads, though they are POSTs.
    return !(m === 'POST' && /^\/storage\/v1\/object\/(sign|list|info)\//.test(path))
  }
  const fn = /^\/functions\/v1\/([A-Za-z0-9_-]+)/.exec(path)
  if (fn) return !READ_EDGE_FUNCTIONS.has(fn[1])
  // Signing in, out and the second factor go on; changing the account (password, e-mail) does not.
  if (path.startsWith('/auth/v1/')) return path.replace(/\/+$/, '') === '/auth/v1/user'
  return false
}

// ── The minimum, from the main process ──────────────────────────────────────

let status: ReleaseMinimum | null = null
const listeners = new Set<(s: ReleaseMinimum | null) => void>()
let watching = false

export function setReleaseMinimum(s: ReleaseMinimum | null): void {
  status = s
  listeners.forEach(l => l(s))
}

export const releaseMinimum = (): ReleaseMinimum | null => status
/** This build is below the signed minimum: no saves. */
export const savesBlocked = (): boolean => !!status?.below

export function onReleaseMinimum(fn: (s: ReleaseMinimum | null) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Asks the main process once, and listens for changes. The phone and older preloads have no bridge: no minimum. */
export function watchReleaseMinimum(): void {
  if (watching || typeof window === 'undefined') return
  const bridge = window.wivo
  if (!bridge?.releaseMinimum) return
  watching = true
  void bridge.releaseMinimum().then(setReleaseMinimum).catch(() => {})
  bridge.onReleaseMinimum?.(setReleaseMinimum)
}

/** The database's refusal of a save from an old build (sql/104), made here. */
export function refusedForVersion(minimum: string | null): Response {
  return new Response(JSON.stringify({
    code: 'PT426',
    message: 'Update Wivo: this version can no longer save. Restart Wivo to update.',
    details: minimum ?? '',
    hint: 'update_required',
  }), { status: 426, headers: { 'content-type': 'application/json' } })
}

/** fetch, refusing saves while this build is below the signed minimum. */
export function saveGuardFetch(inner: typeof fetch, blocked: () => boolean = savesBlocked): typeof fetch {
  watchReleaseMinimum()
  return async (input, init) => {
    if (blocked()) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : undefined)
      if (isSaveRequest(url, method)) return refusedForVersion(status?.minimum ?? null)
    }
    return inner(input, init)
  }
}
