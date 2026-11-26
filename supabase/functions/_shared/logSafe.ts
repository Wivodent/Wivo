/**
 * What an Edge Function writes to its log when something fails (2.2.5,
 * docs/SECURITY-REVIEW-2026-11.md E2).
 *
 * Before, `console.error(err)` wrote the whole error. A database error carries
 * the row it refused (`Failing row contains (… name, phone …)`), a payment
 * provider's answer the customer, and the function log is a place with its
 * own retention and its own readers. Now only:
 *   - where it happened (the caller's text, which is code, not data);
 *   - the error's code (`23505`, `PGRST116`, a provider status);
 *   - its message, scrubbed (shared/privacy/scrub.ts: the row's values, e-mail
 *     addresses, personal codes, phone numbers) and cut to 200 characters.
 * Never `details`, `hint`, a request or response body.
 */
import { scrubPersonalData } from './generated/scrub.ts'

export function safeErrorText(err: unknown): string {
  if (err == null) return 'no error'
  const e = err as { code?: unknown; status?: unknown; name?: unknown; message?: unknown }
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? String(e.code)
    : typeof e.status === 'number' ? `status ${e.status}` : ''
  const message = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : ''
  const name = typeof e.name === 'string' && e.name !== 'Error' ? e.name : ''
  return [name, code, scrubPersonalData(message).slice(0, 200)].filter(Boolean).join(' · ') || 'error'
}

export function logFailure(where: string, err: unknown): void {
  console.error(`[${where}] ${safeErrorText(err)}`)
}

/** A warning text built elsewhere: scrubbed and cut the same way. */
export function logWarn(where: string, message: string): void {
  console.warn(`[${where}] ${scrubPersonalData(String(message)).slice(0, 300)}`)
}
