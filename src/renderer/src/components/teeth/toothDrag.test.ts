/**
 * The sweep across teeth, driven by pointer events (mouse and touch) on a fake
 * chart: each tooth is a 10 px cell, the upper row at y = 0, the lower at y = 20.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createToothDrag, teethBetween, applyPaint, UPPER_ROW, LOWER_ROW, type DragResult, type DragStart } from './toothDrag'

const at = (tooth: number) => {
  const u = UPPER_ROW.indexOf(tooth as never)
  if (u >= 0) return { clientX: u * 10 + 5, clientY: 5 }
  return { clientX: LOWER_ROW.indexOf(tooth as never) * 10 + 5, clientY: 25 }
}
const hitTest = (x: number, y: number): number | null => {
  const row = y < 10 ? UPPER_ROW : y >= 20 && y < 30 ? LOWER_ROW : null
  const i = Math.floor(x / 10)
  return row && i >= 0 && i < 16 ? row[i] : null
}
const ev = (type: 'mouse' | 'touch', tooth: number | null, id = 1, button = 0) =>
  ({ pointerId: id, pointerType: type, button, ...(tooth === null ? { clientX: 500, clientY: 500 } : at(tooth)) })

/** A chart: the chosen teeth and implants, and what the controller asked of it. */
function chart(chosen: number[] = [], implants: number[] = [], mode: 'teeth' | 'implant' = 'teeth', taken: number[] = []) {
  const on = new Set(chosen)
  const imp = new Set(implants)
  const commits: DragResult[] = []
  const previews: number[][] = []
  const drag = createToothDrag({
    hitTest,
    begin: tooth => {
      if (mode === 'implant') return on.has(tooth) ? { mode, paint: imp.has(tooth) ? 'remove' : 'add' } : null
      if (taken.includes(tooth)) return null
      return { mode, paint: on.has(tooth) ? 'remove' : 'add' }
    },
    eligible: (tooth, s: DragStart) => s.mode === 'implant'
      ? on.has(tooth) && (s.paint === 'add' ? !imp.has(tooth) : imp.has(tooth))
      : !taken.includes(tooth) && (s.paint === 'add' ? !on.has(tooth) : on.has(tooth)),
    onPreview: teeth => previews.push([...teeth]),
    onCommit: r => commits.push(r),
  })
  return { drag, commits, previews }
}

describe('teethBetween', () => {
  it('runs along the row, across the midline, in the direction swept', () => {
    expect(teethBetween(16, 26)).toEqual([15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26])
    expect(teethBetween(23, 21)).toEqual([22, 21])
    expect(teethBetween(36, 33)).toEqual([35, 34, 33])
    expect(teethBetween(null, 11)).toEqual([11])
  })
  it('never crosses from one row to the other', () => {
    expect(teethBetween(16, 46)).toEqual([46])
  })
})

describe('a sweep with pointer events', () => {
  it('a tap is one tooth, one change', () => {
    const { drag, commits } = chart()
    expect(drag.pointerDown(ev('mouse', 16))).toBe(true)
    drag.pointerUp(ev('mouse', 16))
    expect(commits).toEqual([{ mode: 'teeth', paint: 'add', teeth: [16] }])
  })

  it('16 → 26 across the midline: every tooth crossed, even those a fast move skipped; one change on release', () => {
    const { drag, commits, previews } = chart()
    drag.pointerDown(ev('touch', 16))
    drag.pointerMove(ev('touch', 13))
    drag.pointerMove(ev('touch', 22))
    expect(commits).toEqual([])
    expect(previews.at(-1)).toEqual([16, 15, 14, 13, 12, 11, 21, 22])
    drag.pointerMove(ev('touch', 26))
    drag.pointerUp(ev('touch', 26))
    expect(commits).toEqual([{ mode: 'teeth', paint: 'add', teeth: [16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26] }])
    expect(previews.at(-1)).toEqual([])
  })

  it('begun on a chosen tooth it lets go, of chosen teeth only', () => {
    const { drag, commits } = chart([14, 13, 12])
    drag.pointerDown(ev('mouse', 14))
    drag.pointerMove(ev('mouse', 11))
    drag.pointerUp(ev('mouse', 11))
    expect(commits).toEqual([{ mode: 'teeth', paint: 'remove', teeth: [14, 13, 12] }])
  })

  it('adding passes over teeth already chosen and teeth another work holds', () => {
    const { drag, commits } = chart([14], [], 'teeth', [12])
    drag.pointerDown(ev('mouse', 15))
    drag.pointerMove(ev('mouse', 11))
    drag.pointerUp(ev('mouse', 11))
    expect(commits[0].teeth).toEqual([15, 13, 11])
  })

  it('upper and lower rows each on their own; back over a tooth takes it once', () => {
    const { drag, commits } = chart()
    drag.pointerDown(ev('touch', 16))
    drag.pointerMove(ev('touch', 15))
    drag.pointerMove(ev('touch', 46))
    drag.pointerMove(ev('touch', 44))
    drag.pointerMove(ev('touch', 46))
    drag.pointerMove(ev('touch', null))
    drag.pointerUp(ev('touch', null))
    expect(commits[0].teeth).toEqual([16, 15, 46, 45, 44])
  })

  it('the implant mode marks the active work\'s own teeth the same way, and unmarks from a marked one', () => {
    const add = chart([16, 15, 14, 13], [], 'implant')
    add.drag.pointerDown(ev('mouse', 17))  // not this work's tooth: no sweep
    expect(add.drag.active).toBe(false)
    add.drag.pointerDown(ev('mouse', 16))
    add.drag.pointerMove(ev('mouse', 11))
    add.drag.pointerUp(ev('mouse', 11))
    expect(add.commits).toEqual([{ mode: 'implant', paint: 'add', teeth: [16, 15, 14, 13] }])
    const remove = chart([16, 15, 14], [15, 14], 'implant')
    remove.drag.pointerDown(ev('touch', 15))
    remove.drag.pointerMove(ev('touch', 16))
    remove.drag.pointerMove(ev('touch', 13))
    remove.drag.pointerUp(ev('touch', 13))
    expect(remove.commits[0]).toEqual({ mode: 'implant', paint: 'remove', teeth: [15, 14] })
  })

  it('a second finger, another pointer\'s events, a right click: ignored', () => {
    const { drag, commits } = chart()
    expect(drag.pointerDown(ev('mouse', 16, 1, 2))).toBe(false)
    drag.pointerDown(ev('touch', 16, 7))
    expect(drag.pointerDown(ev('touch', 26, 8))).toBe(false)
    drag.pointerMove(ev('touch', 11, 8))
    drag.pointerUp(ev('touch', 11, 8))
    expect(commits).toEqual([])
    drag.pointerUp(ev('touch', 16, 7))
    expect(commits).toEqual([{ mode: 'teeth', paint: 'add', teeth: [16] }])
  })

  it('a cancelled pointer changes nothing; a press beside the teeth starts nothing (the page scrolls)', () => {
    const { drag, commits, previews } = chart()
    drag.pointerDown(ev('touch', 16))
    drag.pointerMove(ev('touch', 13))
    drag.pointerCancel(ev('touch', 13))
    drag.pointerUp(ev('touch', 13))
    expect(commits).toEqual([])
    expect(previews.at(-1)).toEqual([])
    expect(drag.pointerDown(ev('touch', null))).toBe(false)
    expect(drag.active).toBe(false)
  })
})

describe('applyPaint: a sweep\'s one change on a list of teeth', () => {
  it('adds each once, removes what was swept, keeps the rest', () => {
    expect(applyPaint([11, 21], [21, 22, 23], 'add')).toEqual([11, 21, 22, 23])
    expect(applyPaint([11, 21, 22], [21, 22, 36], 'remove')).toEqual([11])
  })
})

describe('the charts that use it (read from the source)', () => {
  const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8')
  it('the 2D chart: tooth buttons carry their number and do not scroll the page when a sweep starts on them', () => {
    const src = read('../JobDetail/MultiOdontogramPicker.tsx')
    expect(src).toContain('data-fdi={num}')
    expect(src).toContain("touchAction: 'none'")
    expect(src).toContain('onPointerDown={e => handlePointerDown(e, num)}')
    expect(src).not.toMatch(/onMouseEnter=\{\(\) => handlePointerEnter/)
  })
  it('the 2D and 3D charts share the controller and its rules', () => {
    for (const rel of ['../JobDetail/MultiOdontogramPicker.tsx', './Odontogram3D.tsx']) {
      const src = read(rel)
      expect(src).toContain('createToothDrag(')
      expect(src).toContain('chartDragRules(')
      expect(src).toContain('commitSweep(')
    }
  })
  it('the new-job form and the Network order form draw the same chart and take a sweep as one change', () => {
    const wizard = read('../NewJobWizard/steps/StepTeeth.tsx')
    expect(wizard).toContain('onPaintTeeth={paintTeeth}')
    expect(wizard).toMatch(/onPaintImplants=\{activeType \?/)
    expect(read('../NewJobWizard/teeth/WizardOdontogram.tsx')).toContain('<ToothPicker')
    const phone = read('../../mobile/network/NetworkApp.tsx')
    expect(phone).toContain("import { ToothPicker } from '../../components/teeth/ToothPicker'")
    expect(phone).toContain('onPaintTeeth={(teeth, paint) =>')
  })
})
