/**
 * An order's conversation folds: "Conversation · 6 messages · last 18:42".
 *
 *  - It opens by itself when the other side wrote something this person has
 *    not seen yet (unread); otherwise it follows this person's last choice,
 *    closed until they choose.
 *  - "Seen" is the newest message's time once the conversation was open; the
 *    choice is kept per person. Both live in this device's storage (a viewer
 *    convenience, nothing anyone else reads): with none, it simply starts
 *    closed, or open with unread messages.
 *
 * Pure apart from the storage helpers, which never throw.
 */
import { format, isSameDay, type Locale } from 'date-fns'

export interface FoldMessage { from_client: boolean; created_at: string }

/** Messages from the other side newer than what this person has seen. */
export function unreadCount(messages: readonly FoldMessage[], side: 'clinic' | 'client', seenAt: string | null): number {
  const theirs = messages.filter(m => (side === 'clinic' ? m.from_client : !m.from_client))
  if (!seenAt) return theirs.length
  const seen = new Date(seenAt).getTime()
  return theirs.filter(m => new Date(m.created_at).getTime() > seen).length
}

/** Open with unread messages; else the person's last choice; else closed. */
export const startsOpen = (unread: number, choice: boolean | null): boolean => (unread > 0 ? true : choice ?? false)

/** The newest message's time, for "seen". */
export function newestAt(messages: readonly FoldMessage[]): string | null {
  let best: string | null = null
  for (const m of messages) if (!best || new Date(m.created_at).getTime() > new Date(best).getTime()) best = m.created_at
  return best
}

/** The last message's time as the heading says it: the hour today, else the day and the hour. */
export function lastLabel(iso: string | null, now: Date = new Date(), locale?: Locale): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return isSameDay(d, now) ? format(d, 'HH:mm') : format(d, 'd MMM HH:mm', locale ? { locale } : undefined)
}

const choiceKey = (who: string) => `wivo.thread.open.${who}`
const seenKey = (who: string, orderId: string) => `wivo.thread.seen.${who}.${orderId}`

function read(key: string): string | null {
  try { return globalThis.localStorage?.getItem(key) ?? null } catch { return null }
}
function write(key: string, value: string): void {
  try { globalThis.localStorage?.setItem(key, value) } catch { /* storage refused: nothing kept, nothing breaks */ }
}

export const readChoice = (who: string): boolean | null => {
  const v = read(choiceKey(who))
  return v === '1' ? true : v === '0' ? false : null
}
export const writeChoice = (who: string, open: boolean): void => write(choiceKey(who), open ? '1' : '0')
export const readSeen = (who: string, orderId: string): string | null => read(seenKey(who, orderId))
export const writeSeen = (who: string, orderId: string, at: string): void => write(seenKey(who, orderId), at)
