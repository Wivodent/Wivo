import { describe, it, expect, vi, afterEach } from 'vitest'
import { escapeHtml, printJobSheet } from './printSheet'

afterEach(() => { vi.unstubAllGlobals() })

describe('the job sheet print (2.2.5, A5)', () => {
  it('escapes a name that tries to close the title', () => {
    expect(escapeHtml(`</title><script>alert("x")</script> & 'Mari'`))
      .toBe('&lt;/title&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Mari&#39;')
  })

  it('prints from a hidden frame in this window, never window.open; the title is text', () => {
    const frame = { setAttribute: vi.fn(), style: { cssText: '' }, srcdoc: '', onload: null as null | (() => void), remove: vi.fn(),
      contentWindow: { addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn() } }
    const appendChild = vi.fn()
    const open = vi.fn()
    vi.stubGlobal('document', { createElement: () => frame, body: { appendChild } })
    vi.stubGlobal('window', { open })
    printJobSheet('<section>Crown</section>', '</title><script>x()</script>')
    expect(appendChild).toHaveBeenCalledWith(frame)
    expect(frame.srcdoc).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>')
    expect(frame.srcdoc).toContain('<body><section>Crown</section></body>')
    frame.onload?.()
    expect(frame.contentWindow.print).toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })
})
