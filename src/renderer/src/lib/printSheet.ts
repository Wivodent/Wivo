/**
 * The job sheet's print (JobReadView, 2.2.5, docs/SECURITY-REVIEW-2026-11.md A5).
 *
 * From a hidden frame in Wivo's own window. A new window (`window.open('')`)
 * is refused by Electron's handler (src/main/navigation.ts), so before 2.2.5
 * the desktop printed nothing, and the patient's name went into that window's
 * HTML unescaped.
 */
/** HTML special characters as entities, for text put into a document string. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/**
 * Print the job sheet from a hidden frame. `bodyHtml` is the read view's own
 * DOM (React already escaped every text in it); `title` is text and escaped.
 */
export function printJobSheet(bodyHtml: string, title: string): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>body{font-family:Inter,system-ui,sans-serif;padding:24px;font-size:13px;color:#1a1a1a}
    section{border:1px solid #e5e5e5;border-radius:8px;padding:12px;margin-bottom:12px}
    h3{font-size:11px;text-transform:uppercase;color:#0AB6C4;margin:0 0 8px}
    body{display:flex;flex-direction:column}.job-col{display:contents}
    .order-1{order:1}.order-2{order:2}.order-3{order:3}.order-4{order:4}
    </style></head><body>${bodyHtml}</body></html>`
  frame.onload = () => {
    const w = frame.contentWindow
    if (!w) { frame.remove(); return }
    w.addEventListener('afterprint', () => frame.remove(), { once: true })
    w.focus()
    w.print()
    // A print dialog that never reports back: the frame goes after a minute.
    setTimeout(() => frame.remove(), 60_000)
  }
  document.body.appendChild(frame)
}
