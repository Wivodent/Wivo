/**
 * The new-job form's client reference, filled in by the clinic (sql/140):
 * TF-DE-261127-001 for the chosen client. Only a preview: the job's insert
 * gives it out (the jobs trigger), and gives the next number if someone took
 * this one in the meantime.
 *
 * It never writes over what a person typed: it fills an empty field, or
 * replaces the reference it filled itself (another client was chosen). The
 * owner switches it off in Settings (`automaatneViide`). A database without
 * sql/140 has no preview, and nothing is said.
 */
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/** Whether the field may take the clinic's reference: empty, or still the one filled in before. */
export const mayFillReference = (current: string, filledBefore: string | null): boolean =>
  current.trim() === '' || (filledBefore !== null && current === filledBefore)

export function useAutoClientReference(opts: {
  on: boolean
  customer: string | null
  current: string
  set: (ref: string) => void
}): void {
  const filled = useRef<string | null>(null)
  const { on, customer, current, set } = opts
  const live = useRef({ current, set })
  live.current = { current, set }

  useEffect(() => {
    if (!on) return
    if (!customer) {
      // The client was taken away: so is the reference that was theirs.
      if (filled.current !== null && live.current.current === filled.current) live.current.set('')
      filled.current = null
      return
    }
    if (!mayFillReference(live.current.current, filled.current)) return
    let stale = false
    void (async () => {
      const { data, error } = await supabase.rpc('preview_order_reference', { p_customer: customer })
      if (stale || error || typeof data !== 'string' || !data) return
      if (!mayFillReference(live.current.current, filled.current)) return
      filled.current = data
      live.current.set(data)
    })()
    return () => { stale = true }
  }, [on, customer])
}
