/**
 * Where "Request a feature" and "Ask Wivo" send their e-mail: Wivo's own
 * address, from the build's environment (VITE_WIVO_CONTACT_EMAIL, e.g. in
 * clinics/<id>.env). Without it the buttons are not shown — an e-mail link to
 * a made-up address is worse than no button.
 *
 * Only a mailto: link for now; the admin console comes later (docs/ROADMAP.md).
 */
export const WIVO_CONTACT_EMAIL: string = (import.meta.env.VITE_WIVO_CONTACT_EMAIL ?? '').trim()

/** A mailto: link with subject and body, or null when no address is configured. */
export function wivoMailto(subject: string, body = ''): string | null {
  if (!WIVO_CONTACT_EMAIL) return null
  const q = new URLSearchParams({ subject, body }).toString().replace(/\+/g, '%20')
  return `mailto:${WIVO_CONTACT_EMAIL}?${q}`
}
