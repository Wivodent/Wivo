/**
 * The Content-Security-Policy of the desktop window and of the phone app
 * (2.2.5, docs/SECURITY-REVIEW-2026-11.md A4, W1). One place, so the two
 * cannot drift apart from what the app actually loads.
 *
 * What the renderer loads, checked against the built bundle (no eval, no
 * `new Function`, no WebAssembly, no inline script; one module worker of its
 * own):
 *   - its own files (scripts, styles, Inter, images, sounds, the zip worker);
 *   - the clinic's Supabase project: REST, Auth, Storage (signed links for
 *     previews and files), Edge Functions over https, realtime over wss;
 *   - Sentry: the desktop renderer through the `sentry-ipc:` scheme of
 *     @sentry/electron, the phone straight to the DSN's host;
 *   - `blob:` and `data:` for PDFs in the file viewer, camera pictures,
 *     downloads made in the page, and small inline images.
 * `style-src 'unsafe-inline'`: libraries set inline styles (motion, layout);
 * a style cannot run code. Scripts get no such allowance.
 */

/** The https and wss origins of a Supabase (or own-server) address; [] when there is none. */
export function apiOrigins(url: string | undefined): string[] {
  if (!url) return []
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return []
    return [u.origin, `wss://${u.host}`]
  } catch {
    return []
  }
}

/** The ingest host of a Sentry DSN ("https://key@o1.ingest.de.sentry.io/2" → its https origin). */
export function sentryOrigin(dsn: string | undefined): string[] {
  if (!dsn) return []
  try {
    const u = new URL(dsn)
    return u.protocol === 'https:' ? [`https://${u.host}`] : []
  } catch {
    return []
  }
}

const join = (directives: Record<string, string[]>): string =>
  Object.entries(directives).map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`).join('; ')

/**
 * The desktop window (a meta tag in index.html, packaged builds only: the dev
 * server's React refresh is an inline script).
 *
 * Which project a desktop talks to comes from its licence at run time (part
 * B), so connect-src allows any *.supabase.co. A clinic on its own server
 * (docs/OWN-SERVER.md) is built with its address (`MAIN_VITE_WIVO_API`),
 * which is added here.
 */
export function desktopCsp(opts: { apiUrl?: string } = {}): string {
  const supabase = ['https://*.supabase.co', 'wss://*.supabase.co']
  return join({
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://*.supabase.co', ...apiOrigins(opts.apiUrl).slice(0, 1)],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", ...supabase, ...apiOrigins(opts.apiUrl), 'sentry-ipc:', 'https://*.sentry.io', 'blob:', 'data:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'self'", 'blob:'],
    'object-src': ["'self'", 'blob:'],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  })
}

/**
 * The phone app (the `_headers` of each clinic's build, Report-Only at first):
 * exactly the one project it is built for (VITE_SUPABASE_URL), the Sentry DSN's
 * host, nothing else. Without a project address it falls back to *.supabase.co
 * and the build says so.
 */
export function mobileCsp(opts: { supabaseUrl?: string; sentryDsn?: string }): string {
  const api = apiOrigins(opts.supabaseUrl)
  const project = api.length ? api : ['https://*.supabase.co', 'wss://*.supabase.co']
  return join({
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', project[0]],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", ...project, ...sentryOrigin(opts.sentryDsn)],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'frame-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  })
}
