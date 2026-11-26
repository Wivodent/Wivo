/**
 * "Someone else changed this while you were editing" + Reload (2.2.3).
 *
 * Shown where a save was refused because another person saved the same thing
 * first. Nothing was written. `items` names what both changed, when known.
 */
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { t } from '@/lib/i18n'

export function ConflictBanner({ items = [], onReload, className = '', hint }: {
  items?: readonly string[]
  onReload: () => void
  className?: string
  /** What happened to the save; by default "Nothing was saved …". */
  hint?: string
}): JSX.Element {
  return (
    <div role="alert" className={`rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-start gap-3 ${className}`}>
      <AlertTriangle size={18} aria-hidden="true" className="text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-sm font-semibold text-ink">{t('conflict.someoneElseChanged')}</p>
        {items.length > 0 && (
          <p className="text-sm text-ink-soft">{t('conflict.changedBoth', { items: items.join(', ') })}</p>
        )}
        <p className="text-xs text-ink-muted">{hint ?? t('conflict.reloadHint')}</p>
      </div>
      <button type="button" onClick={onReload}
        className="min-h-[40px] px-3.5 rounded-xl bg-accent text-white text-sm font-bold flex items-center gap-1.5 hover:opacity-90 flex-shrink-0">
        <RotateCcw size={14} aria-hidden="true" /> {t('conflict.reload')}
      </button>
    </div>
  )
}
