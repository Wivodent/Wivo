/**
 * The fold of an order's conversation (lib/threadFold), for the clinic's
 * order dialog and job page and the client's /network. No database here: the
 * network-only build uses it too.
 */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'
import { unreadCount, startsOpen, newestAt, lastLabel, readChoice, writeChoice, readSeen, writeSeen, type FoldMessage } from '../../lib/threadFold'
import { t, dateLocale } from '@/lib/i18n'

/**
 * Open or closed, decided once the messages have loaded: open with unread
 * messages from the other side, else the person's last choice (closed until
 * they choose). While open, what is shown counts as seen.
 */
export function useThreadFold(who: string | null, orderId: string, side: 'clinic' | 'client', messages: readonly FoldMessage[], loaded: boolean) {
  const key = who ?? 'device'
  const seen = useMemo(() => readSeen(key, orderId), [key, orderId])
  const unread = unreadCount(messages, side, seen)
  const [open, setOpen] = useState<boolean | null>(null)
  useEffect(() => {
    if (loaded && open === null) setOpen(startsOpen(unread, readChoice(key)))
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const newest = newestAt(messages)
  useEffect(() => {
    if (open && newest) writeSeen(key, orderId, newest)
  }, [open, newest, key, orderId])
  const toggle = () => {
    const next = !(open ?? false)
    setOpen(next)
    writeChoice(key, next)
  }
  return { open: open ?? false, toggle, unread: open ? 0 : unread }
}

/** "Conversation · 6 messages · last 18:42", with "2 new" while closed. */
export function ThreadHeader({ count, last, unread, open, onToggle, compact }: {
  count: number; last: string | null; unread: number; open: boolean; onToggle: () => void; compact?: boolean
}) {
  const lastText = lastLabel(last, new Date(), dateLocale)
  const parts = [
    t('thread.conversation'),
    count === 0 ? t('thread.noMessages') : count === 1 ? t('thread.oneMessage') : t('thread.nMessages', { n: count }),
    ...(lastText ? [t('thread.last', { time: lastText })] : []),
  ]
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
      className={`flex w-full items-center gap-2 rounded-xl text-left ${compact ? 'min-h-11 px-1 text-sm' : 'min-h-10 text-base'} font-semibold text-ink hover:bg-bg-sidebar/60`}>
      {open ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronRight size={18} aria-hidden="true" />}
      <MessageSquare size={16} className="text-ink-muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{parts.join(' · ')}</span>
      {!open && unread > 0 && <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-white">{t('thread.nNew', { n: unread })}</span>}
    </button>
  )
}
