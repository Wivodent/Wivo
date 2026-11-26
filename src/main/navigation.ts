/**
 * Where a Wivo window may go, and what may be handed to the operating system
 * (2.2.5, docs/SECURITY-REVIEW-2026-11.md A2, A3).
 *
 * - **A new window** (`window.open`, a link with target="_blank") never opens
 *   inside Wivo. An https, mailto or tel address goes to the system's own app
 *   (the browser, the mail program, the phone); anything else (file:, smb:,
 *   a Windows protocol handler) is dropped. Before 2.2.5 every address went
 *   to `shell.openExternal`, which on Windows is a known road to running code.
 * - **The window itself** stays on Wivo: a navigation away from the app's own
 *   page (a link without a target, a redirect) is stopped, and an allowed
 *   address is opened outside instead. A page loaded into Wivo's window would
 *   get Wivo's preload.
 *
 * Pure, so it is tested without Electron (navigation.test.ts).
 */
const EXTERNAL_SCHEMES = new Set(['https:', 'mailto:', 'tel:'])

/** May this address be given to the operating system to open? */
export function externalAllowed(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Is this the app's own page? In development the dev server's origin
 * (ELECTRON_RENDERER_URL); packaged, the renderer's own file.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
  try {
    const to = new URL(url)
    const app = new URL(appUrl)
    if (app.protocol === 'file:') return to.protocol === 'file:' && to.pathname === app.pathname
    return to.origin === app.origin
  } catch {
    return false
  }
}
