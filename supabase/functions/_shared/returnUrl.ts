/**
 * Where the payment's return page links back to: the clinic's own website,
 * and only over https (2.2.5, docs/SECURITY-REVIEW-2026-11.md E3). A
 * `javascript:` or `data:` address in the booking settings would run on the
 * function's own domain when a patient clicks it; such a setting gives no
 * link at all.
 */
export function safeReturnUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const u = new URL(value.trim())
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}
