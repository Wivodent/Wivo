/**
 * Inputs that keep what is being typed in local state and hand it on only on
 * blur or Enter. A field wired straight to a shared store re-renders the
 * whole card on every letter; anything about that card that changes with the
 * value (a key, a sort, a cleaned-up number) then fights the person typing.
 *
 * While the field has the focus it never takes a new value from its props;
 * once it loses it, it shows the prop again (another window's save, a reset).
 */
import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>

function useDraft(shown: string) {
  const [draft, setDraft] = useState(shown)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(shown) }, [shown])
  return { draft, setDraft, focused }
}

export function DraftTextInput({ value, onCommit, ...rest }: Base & {
  value: string
  onCommit: (v: string) => void
}) {
  const { draft, setDraft, focused } = useDraft(value)
  const commit = () => { if (draft !== value) onCommit(draft) }
  return (
    <input
      {...rest}
      type="text"
      value={draft}
      onFocus={e => { focused.current = true; rest.onFocus?.(e) }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { focused.current = false; commit() }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        rest.onKeyDown?.(e)
      }}
    />
  )
}

/**
 * `value` undefined shows an empty field. `allowEmpty` commits an emptied field
 * as undefined; without it an emptied field commits 0.
 */
export function DraftNumberInput({ value, onCommit, allowEmpty = false, ...rest }: Base & {
  value: number | undefined
  onCommit: (v: number | undefined) => void
  allowEmpty?: boolean
}) {
  const shown = value == null ? '' : String(value)
  const { draft, setDraft, focused } = useDraft(shown)
  const commit = () => {
    const raw = draft.trim().replace(',', '.')
    if (raw === '') {
      const next = allowEmpty ? undefined : 0
      if (next !== value) onCommit(next)
      if (!allowEmpty) setDraft('0')
      return
    }
    const n = parseFloat(raw)
    if (Number.isNaN(n)) { setDraft(shown); return }
    if (n !== value) onCommit(n)
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={e => { focused.current = true; rest.onFocus?.(e) }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { focused.current = false; commit() }}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        rest.onKeyDown?.(e)
      }}
    />
  )
}
