/**
 * What a sweep on a chart may do, and how its one change reaches the caller —
 * shared by the 2D arch and the 3D jaw so the two cannot drift apart. The
 * sweep itself is toothDrag.ts.
 *
 * The caller hears the whole sweep at once through `onPaintTeeth` /
 * `onPaintImplants` when it gives them (the new-job form and the Network
 * order form do: one change, one undo). A caller that gives only the
 * one-tooth callbacks gets them one tooth at a time, each flushed before the
 * next, so a handler that reads its own state between two teeth sees the
 * tooth before.
 */
import { flushSync } from 'react-dom'
import type { ToothPickerProps } from './toothPickerProps'
import type { ToothOwner } from './odontogramState'
import { decideToothClick, ownsTooth, type MarkMode } from './toothInteraction'
import type { DragResult, DragStart, ToothDragOptions } from './toothDrag'

export interface LiveChart {
  props: ToothPickerProps
  owners: Map<string, ToothOwner>
  implants: Set<string>
  markMode: MarkMode | null
}

/**
 * The controller's rules, read from the chart as it is at each event.
 * A press on a tooth another work holds starts no sweep: it goes to
 * `onToggleTooth` as a click, so the caller can say why it was refused.
 */
export function chartDragRules(live: () => LiveChart): Pick<ToothDragOptions, 'begin' | 'eligible'> {
  return {
    begin: tooth => {
      const { props, owners, implants, markMode } = live()
      const ctx = { owners, activeItemId: props.activeItemId, markMode, disabled: props.disabled }
      switch (decideToothClick(tooth, ctx)) {
        case 'toggle': {
          const owner = owners.get(String(tooth))
          if (owner && owner.itemId !== props.activeItemId) { props.onToggleTooth(tooth); return null }
          return { mode: 'teeth', paint: owner ? 'remove' : 'add' }
        }
        case 'implant':
          return props.onToggleImplant ? { mode: 'implant', paint: implants.has(String(tooth)) ? 'remove' : 'add' } : null
        case 'design':
          props.onToggleDesign?.(tooth)
          return null
        default:
          return null
      }
    },
    eligible: (tooth: number, s: DragStart) => {
      const { props, owners, implants } = live()
      const mine = ownsTooth(owners, tooth, props.activeItemId)
      if (s.mode === 'teeth') return s.paint === 'add' ? !owners.has(String(tooth)) : mine
      return mine && (s.paint === 'add' ? !implants.has(String(tooth)) : implants.has(String(tooth)))
    },
  }
}

/** The sweep's one change, to the caller. */
export function commitSweep(r: DragResult, live: () => LiveChart): void {
  const { props } = live()
  if (r.mode === 'teeth') {
    if (props.onPaintTeeth) { props.onPaintTeeth(r.teeth, r.paint); return }
    for (const tooth of r.teeth) flushSync(() => live().props.onToggleTooth(tooth))
    return
  }
  if (props.onPaintImplants) { props.onPaintImplants(r.teeth, r.paint === 'add'); return }
  for (const tooth of r.teeth) flushSync(() => live().props.onToggleImplant?.(tooth))
}
