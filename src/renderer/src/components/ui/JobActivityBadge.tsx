/**
 * The small "new" mark on a job card: something someone else did since I
 * last opened the job (sql/136). One kind: its icon; several: how many.
 * The tooltip says it in words: "2 new: file, note · by Anna".
 */
import { FileText, MessageSquare, StickyNote, ArrowRightCircle } from 'lucide-react'
import { activitySummary, type ActivityKind, type JobActivity } from '../../lib/jobActivity'

const ICON: Record<ActivityKind, typeof FileText> = {
  file: FileText, note: StickyNote, message: MessageSquare, stage: ArrowRightCircle,
}

export function JobActivityBadge({ activity, size = 'sm' }: { activity: JobActivity | undefined; size?: 'sm' | 'lg' }) {
  const s = activitySummary(activity)
  if (!s) return null
  const Icon = s.only ? ICON[s.only] : null
  const big = size === 'lg'
  return (
    <span title={s.text} aria-label={s.text} role="status"
      className={`inline-flex items-center gap-0.5 rounded-full bg-sky-500 text-white font-bold shadow-sm ${big ? 'h-7 min-w-7 px-2 text-sm' : 'h-5 min-w-5 px-1.5 text-[11px]'}`}>
      {Icon ? <Icon size={big ? 15 : 12} aria-hidden="true" /> : null}
      {(!Icon || s.total > 1) && <span>{s.total}</span>}
    </span>
  )
}
