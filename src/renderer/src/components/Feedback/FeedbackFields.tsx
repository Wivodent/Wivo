/**
 * The pieces of a feedback form shared by the clinic's job page and the
 * Network client's order page (sql/144): 1–5 stars, and the reason and text
 * of a "Needs adjustment". No database here: the network-only build
 * (app.wivodent.com) uses them too and must not carry the clinic's client.
 */
import { Star } from 'lucide-react'
import { REVISION_REASONS, revisionReasonText } from '../../types/job'
import { t } from '@/lib/i18n'

/** 1–5, as buttons; the value is a whole number or null. */
export function Stars({ value, onChange, label, disabled }: { value: number | null; onChange: (n: number) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('feedback.nOfFive', { n })} disabled={disabled}
          onClick={() => onChange(n)} className="h-10 w-10 rounded-lg hover:bg-bg-sidebar disabled:opacity-50">
          <Star size={22} className={`mx-auto ${value !== null && n <= value ? 'fill-amber-400 text-amber-400' : 'text-ink-faint'}`} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}

/** The reason (one of the remake reasons) and what to change; both required. */
export function AdjustFields({ reason, note, onReason, onNote }: { reason: string; note: string; onReason: (r: string) => void; onNote: (n: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block"><span className="label">{t('feedback.reason')}</span>
        <select className="input h-11 text-base" value={reason} onChange={e => onReason(e.target.value)}>
          <option value="">{t('feedback.chooseReason')}</option>
          {REVISION_REASONS.map(r => <option key={r} value={r}>{revisionReasonText(r)}</option>)}
        </select>
      </label>
      <label className="block"><span className="label">{t('feedback.whatToChange')}</span>
        <textarea className="input min-h-20 text-base" maxLength={4000} value={note} onChange={e => onNote(e.target.value)} />
      </label>
    </div>
  )
}
