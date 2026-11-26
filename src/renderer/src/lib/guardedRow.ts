/**
 * One table row behind shared/concurrency/guardedSave: written only where its
 * `updated_at` is still the one this person started from (2.2.3).
 *
 * `updated_at` is stamped here as well as by a trigger where there is one
 * (jobs): worker_rates and workflow_template have no trigger, and every
 * writer of theirs stamps it from the app, this one included, so the
 * condition holds for them too. No migration.
 */
import type { GuardedIo, Row } from '@shared/concurrency/guardedSave'
import { supabase } from './supabase'

export function rowIo<R extends Row>(
  table: string,
  id: string,
  opts: { idColumn?: string; select?: string } = {},
): GuardedIo<R> {
  const idColumn = opts.idColumn ?? 'id'
  const select = opts.select ?? '*'
  return {
    async write(patch, expected) {
      const q = supabase.from(table)
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq(idColumn, id)
      const { data, error } = await (expected == null ? q.is('updated_at', null) : q.eq('updated_at', expected))
        .select(select)
      if (error) throw error
      return ((data as unknown as R[] | null) ?? [])[0] ?? null
    },
    async read() {
      const { data, error } = await supabase.from(table).select(select).eq(idColumn, id).maybeSingle()
      if (error) throw error
      return (data as unknown as R | null) ?? null
    },
  }
}
