/**
 * Cloudflare Turnstile: is this booking request from a person (2.2.5)?
 *
 * The website widget renders Turnstile with the clinic's SITE key (public;
 * `/services` hands it out) and sends the token it gets as `turnstileToken`.
 * This checks the token with Cloudflare using the clinic's SECRET key, which
 * lives only in the function's secrets (`TURNSTILE_SECRET_KEY`).
 *
 * Without the secret the booking function refuses to take requests and says
 * so (`turnstileConfigured`): a spam check that is silently off is worse than
 * a form that says it is not ready.
 *
 * Pure apart from the injected fetch (turnstile.test.ts).
 */
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing_token' | 'refused' | 'wrong_host' | 'unreachable' }

export async function verifyTurnstile(args: {
  secret: string
  token: unknown
  ip: string
  /** Hostnames the widget may run on (from PUBLIC_BOOKING_ORIGINS); empty: any. */
  hostnames?: readonly string[]
  fetch?: typeof fetch
}): Promise<TurnstileVerdict> {
  const token = typeof args.token === 'string' ? args.token.trim() : ''
  if (!token || token.length > 2048) return { ok: false, reason: 'missing_token' }
  const body = new URLSearchParams({ secret: args.secret, response: token })
  if (args.ip && args.ip !== 'unknown') body.set('remoteip', args.ip)
  let res: Response
  try {
    res = await (args.fetch ?? fetch)(SITEVERIFY, { method: 'POST', body })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (!res.ok) return { ok: false, reason: 'unreachable' }
  const out = await res.json().catch(() => null) as { success?: boolean; hostname?: string } | null
  if (!out?.success) return { ok: false, reason: 'refused' }
  const hosts = args.hostnames ?? []
  if (hosts.length > 0 && !(out.hostname && hosts.includes(out.hostname))) return { ok: false, reason: 'wrong_host' }
  return { ok: true }
}

/** The hostnames of the allowed origins ("https://dentiks.lv" → "dentiks.lv"). */
export function originHostnames(origins: readonly string[]): string[] {
  return origins.flatMap(o => { try { return [new URL(o).hostname] } catch { return [] } })
}
