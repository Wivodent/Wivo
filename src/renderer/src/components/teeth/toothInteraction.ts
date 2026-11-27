/**
 * What a click on a tooth MEANS — one rule, however many charts draw it.
 *
 * This lived inside `MultiOdontogramPicker.handlePointerDown`. It is moving out
 * for the same reason `deriveOdontogramState` did, only with more at stake: a
 * marking click does not change how the chart looks, it changes what gets
 * billed and who gets paid. An implant mark puts hardware on an invoice and a
 * design mark puts a tooth on somebody's payslip.
 *
 * Two charts each carrying their own copy of "may this click land" would
 * eventually disagree, and the disagreement would be about money and would show
 * up as a number nobody can explain rather than as a visibly broken chart.
 */
import type { ToothOwner } from './odontogramState'

/** Which of the two marking modes the chart is in. `null` = picking teeth. */
export type MarkMode = 'implant' | 'design'

export interface ClickContext {
  /** From `deriveOdontogramState`. Keyed by FDI as a STRING. */
  owners: Map<string, ToothOwner>
  /** Which item receives clicks. `null` makes every click a no-op. */
  activeItemId: string | null
  markMode: MarkMode | null
  disabled?: boolean
}

export type ToothAction = 'none' | 'toggle' | 'implant' | 'design'

/**
 * Is this tooth part of the item currently being edited?
 *
 * Not "does anybody own it" — a tooth belonging to a DIFFERENT item on the same
 * job is somebody else's unit, and marking it would attach hardware or design
 * pay to work this item is not doing.
 */
export function ownsTooth(
  owners: Map<string, ToothOwner>,
  tooth: number,
  activeItemId: string | null,
): boolean {
  if (activeItemId === null) return false
  return owners.get(String(tooth))?.itemId === activeItemId
}

/**
 * Decides what a press on `tooth` should do.
 *
 * The marking modes retarget the SAME click rather than adding a second chart
 * or a modifier key: one doubles the drawing, the other is invisible.
 *
 * A mark is refused on a tooth this item does not have. An implant under a unit
 * that does not exist, or design pay for a tooth nobody is making, is not a
 * fact about this job — so the click does nothing rather than inventing one.
 */
export function decideToothClick(tooth: number, ctx: ClickContext): ToothAction {
  if (ctx.disabled || ctx.activeItemId === null) return 'none'
  if (ctx.markMode === null) return 'toggle'
  if (!ownsTooth(ctx.owners, tooth, ctx.activeItemId)) return 'none'
  return ctx.markMode
}

/**
 * Decides what dragging ACROSS `tooth` should do, once a drag is under way.
 *
 * SUPERSEDED for the charts by the sweep in toothDrag.ts / toothDragRules.ts
 * (2026-11-27), which no chart calls this any more. Two things changed there,
 * on purpose: a sweep is a preview until release and then ONE change (so an
 * undo takes it all back, and nothing moves money mid-gesture), and in the
 * implant mode a sweep marks implants too, on the active work's own teeth only
 * (Kevin's call). The design mark is still never swept. Kept for its tests and
 * as the record of the old rule.
 */
export function decideDragPaint(
  tooth: number,
  ctx: ClickContext,
  painting: 'add' | 'remove' | null,
): ToothAction {
  if (painting === null || ctx.markMode !== null) return 'none'
  if (ctx.disabled || ctx.activeItemId === null) return 'none'
  const owned = ownsTooth(ctx.owners, tooth, ctx.activeItemId)
  if (painting === 'add' && !owned) return 'toggle'
  if (painting === 'remove' && owned) return 'toggle'
  return 'none'
}
