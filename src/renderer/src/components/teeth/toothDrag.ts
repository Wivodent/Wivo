/**
 * Dragging across teeth, with a mouse or a finger — one controller for every
 * chart (the 2D arch, the 3D jaw, the new-job form and the Network order form).
 *
 * Press on a tooth and sweep: every tooth the pointer crosses is taken, or,
 * when the press began on a chosen tooth, let go of. Crossing works over the
 * midline (16 → 26) and in each row on its own; a fast sweep that skips teeth
 * between two reports still takes the teeth in between, along the row.
 *
 * While the pointer is down nothing changes: the swept teeth are a PREVIEW
 * (`onPreview`), drawn lightly. On release the whole sweep is ONE change
 * (`onCommit`), so an undo takes all of it back. A tap is a sweep of one.
 *
 * In the implant mode a sweep marks implants the same way (or unmarks them,
 * when it began on a marked one), on the active work's own teeth only. The
 * design mode is a single click: design pay is per tooth, and nobody asked to
 * sweep it.
 *
 * Framework-free on purpose: the charts give it what is under the pointer
 * (`hitTest`) and draw what it says, and the tests drive it with pointer
 * events and no DOM.
 */

export const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] as const
export const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] as const

export type PaintMode = 'teeth' | 'implant'
export type Paint = 'add' | 'remove'

/** The teeth from `from` to `to` along their row, `to` last; a different row (or none) is just `to`. */
export function teethBetween(from: number | null, to: number): number[] {
  if (from === null || from === to) return [to]
  for (const row of [UPPER_ROW, LOWER_ROW] as readonly (readonly number[])[]) {
    const a = row.indexOf(from)
    const b = row.indexOf(to)
    if (a >= 0 && b >= 0) {
      const step = b > a ? 1 : -1
      const out: number[] = []
      for (let i = a + step; step > 0 ? i <= b : i >= b; i += step) out.push(row[i])
      return out
    }
  }
  return [to]
}

/** The part of a pointer event the controller reads (a real PointerEvent has all of it). */
export interface PointerLike {
  pointerId: number
  pointerType: string
  button: number
  clientX: number
  clientY: number
}

export interface DragStart { mode: PaintMode; paint: Paint }
export interface DragResult { mode: PaintMode; paint: Paint; teeth: number[] }

export interface ToothDragOptions {
  /** The tooth under a point, or null. */
  hitTest: (x: number, y: number) => number | null
  /** What a press on this tooth starts, or null when it starts no sweep (the chart handles it as a click). */
  begin: (tooth: number) => DragStart | null
  /** Whether this sweep may take this tooth (add: not chosen yet and free; remove: chosen). */
  eligible: (tooth: number, start: DragStart) => boolean
  onPreview?: (teeth: ReadonlySet<number>, start: DragStart | null) => void
  onCommit: (result: DragResult) => void
}

export interface ToothDrag {
  /** A press. `tooth` when the chart already knows it (the element pressed); else from `hitTest`. True when a sweep began. */
  pointerDown: (e: PointerLike, tooth?: number | null) => boolean
  pointerMove: (e: PointerLike) => void
  pointerUp: (e: PointerLike) => void
  /** The system took the pointer (a call, a scroll gesture elsewhere): nothing is changed. */
  pointerCancel: (e: PointerLike) => void
  readonly active: boolean
}

export function createToothDrag(o: ToothDragOptions): ToothDrag {
  let pointerId: number | null = null
  let start: DragStart | null = null
  let last: number | null = null
  let swept: number[] = []

  const reset = () => {
    pointerId = null; start = null; last = null; swept = []
    o.onPreview?.(new Set(), null)
  }
  const take = (tooth: number) => {
    for (const t of teethBetween(last, tooth)) {
      if (!swept.includes(t) && start && o.eligible(t, start)) swept.push(t)
    }
    last = tooth
    o.onPreview?.(new Set(swept), start)
  }

  return {
    get active() { return pointerId !== null },
    pointerDown(e, tooth) {
      // Only the main button of a mouse; any touch or pen. A second finger while one sweeps is ignored.
      if (pointerId !== null) return false
      if (e.pointerType === 'mouse' && e.button !== 0) return false
      const t = tooth ?? o.hitTest(e.clientX, e.clientY)
      if (t === null) return false
      const s = o.begin(t)
      if (!s) return false
      pointerId = e.pointerId
      start = s
      last = null
      swept = []
      take(t)
      return true
    },
    pointerMove(e) {
      if (pointerId === null || e.pointerId !== pointerId) return
      const t = o.hitTest(e.clientX, e.clientY)
      if (t !== null && t !== last) take(t)
    },
    pointerUp(e) {
      if (pointerId === null || e.pointerId !== pointerId) return
      const result: DragResult | null = start && swept.length ? { mode: start.mode, paint: start.paint, teeth: [...swept] } : null
      reset()
      if (result) o.onCommit(result)
    },
    pointerCancel(e) {
      if (pointerId === null || e.pointerId !== pointerId) return
      reset()
    },
  }
}

/** A list of teeth with a sweep applied: added (once each) or removed. */
export function applyPaint(current: readonly number[], teeth: readonly number[], paint: Paint): number[] {
  if (paint === 'remove') { const gone = new Set(teeth); return current.filter(t => !gone.has(t)) }
  const have = new Set(current)
  return [...current, ...teeth.filter(t => !have.has(t))]
}
