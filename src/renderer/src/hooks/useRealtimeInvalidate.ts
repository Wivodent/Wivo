/**
 * Reload these queries whenever another computer changes a row of `table`
 * (Supabase realtime, postgres_changes; 2.2.4).
 *
 * Its own channel per table, never one shared with jobs: a channel naming a
 * table the database has not put in its publication (sql/131, 132) can be
 * refused as a whole, and the jobs list must not go deaf with it.
 *
 * The event's row is not read: what this person may see is decided by the
 * query that reloads (RLS, the job_files function), not by what an event
 * carries. A delete carries only the key, so the reload is by prefix.
 */
import { useEffect, useId } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export function useRealtimeInvalidate(table: string, keys: readonly (readonly unknown[])[], enabled = true): void {
  const qc = useQueryClient()
  const channelId = useId()
  const keyText = JSON.stringify(keys)
  useEffect(() => {
    if (!enabled) return
    const prefixes = JSON.parse(keyText) as unknown[][]
    const channel = supabase
      .channel(`${table}-realtime-${channelId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        for (const queryKey of prefixes) void qc.invalidateQueries({ queryKey })
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [qc, channelId, table, keyText, enabled])
}
