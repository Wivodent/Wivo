/**
 * The fields of "Problem with delivery" (sql/145): a reason and what
 * happened, both required. Shared by the job page and the Network client's
 * order page. No database here: the network-only build (app.wivodent.com)
 * uses it too and must not carry the clinic's client.
 */
import { PROBLEM_REASONS, problemReasonText } from '../../lib/delivery'
import { t } from '@/lib/i18n'

export function ProblemFields({ reason, note, onReason, onNote }: { reason: string; note: string; onReason: (r: string) => void; onNote: (n: string) => void }) {
  return (
    <div className="space-y-2">
      <label className="block"><span className="label">{t('delivery.reason')}</span>
        <select className="input h-11 text-base" value={reason} onChange={e => onReason(e.target.value)}>
          <option value="">{t('delivery.chooseReason')}</option>
          {PROBLEM_REASONS.map(r => <option key={r} value={r}>{problemReasonText(r)}</option>)}
        </select>
      </label>
      <label className="block"><span className="label">{t('delivery.whatHappened')}</span>
        <textarea className="input min-h-20 text-base" maxLength={4000} value={note} onChange={e => onNote(e.target.value)} />
      </label>
    </div>
  )
}
