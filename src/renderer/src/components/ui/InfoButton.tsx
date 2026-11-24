/**
 * The round "i" next to a heading: the long explanation lives behind it, so
 * the screen itself carries only the short words.
 *
 * Opens on click (not hover: a hover tooltip is gone before an older reader
 * has finished reading it), closes on a second click, Escape or a click
 * anywhere else. The text is in the page while open, so a screen reader reads
 * it in order.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Info } from 'lucide-react'

export function InfoButton({ label, text, align = 'left' }: {
  /** What the button is about, for the screen reader: "Help: patient". */
  label: string
  text: string
  /** Which edge of the button the bubble lines up with. */
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <span ref={box} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          open ? 'border-accent bg-accent/10 text-accent' : 'border-ink-faint/40 bg-bg-card text-ink-muted hover:text-ink hover:border-ink-faint'
        }`}
      >
        <Info size={16} aria-hidden="true" />
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={`absolute top-10 z-30 w-72 max-w-[80vw] rounded-xl border border-ink-faint/25 bg-bg-card shadow-card p-3 text-sm leading-relaxed text-ink-soft font-normal normal-case tracking-normal whitespace-normal ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
