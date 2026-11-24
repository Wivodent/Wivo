/**
 * The drawings behind WorkKindIcon: the 15 kinds of work, as line art in a
 * 48×48 box. Each is a list of strokes (paths and circles), no fill: one
 * line, one width, round ends, so the gradient reads the same on all of them.
 *
 * The few base outlines (a crown, a molar, a screw, an arch tray) are drawn
 * once in a 100×100 box and placed by `place`, which maps their numbers. No
 * SVG transform: a transform would stretch the line and shift the gradient,
 * and the set has to look like one hand drew it.
 */

export type WorkKind =
  | 'implantCrown' | 'implantBridge' | 'crown' | 'bridge' | 'veneer' | 'laminate'
  | 'inlay' | 'onlay' | 'filling' | 'denture' | 'allOnX' | 'nightGuard'
  | 'retainer' | 'ibt' | 'surgicalGuide' | 'tooth'

export type Stroke = { d: string } | { cx: number; cy: number; r: number }

/** The 15 kinds in the order of the reference sheet, then the plain tooth for anything else. */
export const WORK_KINDS: readonly WorkKind[] = [
  'implantCrown', 'implantBridge', 'crown', 'bridge', 'veneer', 'laminate', 'inlay', 'onlay',
  'filling', 'denture', 'allOnX', 'nightGuard', 'retainer', 'ibt', 'surgicalGuide', 'tooth',
]

const r1 = (n: number): string => String(Math.round(n * 100) / 100)

/** Map a path drawn in a 100×100 box into the rectangle x, y, w, h. Absolute M/C/L/Z only. */
export function place(d: string, x: number, y: number, w: number, h: number): string {
  return d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_, a: string, b: string) =>
    `${r1(x + (Number(a) * w) / 100)} ${r1(y + (Number(b) * h) / 100)}`)
}

// ── Base outlines, 100×100 ─────────────────────────────────────────────────────

/** A crown seen from the side: two cusps on top, a flat seat below. */
const CROWN = 'M50 14 C41 4 26 0 15 4 C3 9 -1 30 2 55 C4 75 6 90 14 96 C18 99 24 100 30 100 L70 100 C76 100 82 99 86 96 C94 90 96 75 98 55 C101 30 97 9 85 4 C74 0 59 4 50 14 Z'

/** A molar with two roots. */
const MOLAR = 'M50 12 C42 3 28 0 18 3 C6 7 1 20 3 35 C5 47 11 54 14 64 C17 75 18 88 22 97 C24 101 29 101 31 97 C34 88 37 74 50 74 C63 74 66 88 69 97 C71 101 76 101 78 97 C82 88 83 75 86 64 C89 54 95 47 97 35 C99 20 94 7 82 3 C72 0 58 3 50 12 Z'

/** The molar below a crown's margin: both sides from the margin down, and the roots. */
const MOLAR_BELOW_MARGIN = 'M10 52 C11 56 13 60 14 64 C17 75 18 88 22 97 C24 101 29 101 31 97 C34 88 37 74 50 74 C63 74 66 88 69 97 C71 101 76 101 78 97 C82 88 83 75 86 64 C87 60 89 56 90 52'

/** A crown that sits over the top of the molar, a little wider than the tooth, ending at its margin. */
const CAP = 'M50 9 C42 -1 26 -5 14 -1 C0 4 -4 22 0 41 C1 45 3 47 6 48 C24 53 76 53 94 48 C97 47 99 45 100 41 C104 22 100 4 86 -1 C74 -5 58 -1 50 9 Z'

/** A full upper tray (a denture's gum, a guard): a scalloped top, round ends. */
const TRAY_TOP = 'M2 60 C0 30 14 16 30 22 C38 25 44 30 50 30 C56 30 62 25 70 22 C86 16 100 30 98 60'

// ── Small parts ────────────────────────────────────────────────────────────────

/** An implant screw: the body tapering to a point, and its threads. */
function screw(cx: number, top: number, bottom: number, w: number): Stroke[] {
  const half = w / 2
  const body = `M${r1(cx - half * 0.62)} ${r1(top)} L${r1(cx - half * 0.5)} ${r1(bottom - w * 0.55)} L${r1(cx)} ${r1(bottom)} L${r1(cx + half * 0.5)} ${r1(bottom - w * 0.55)} L${r1(cx + half * 0.62)} ${r1(top)}`
  const threads: Stroke[] = []
  const n = Math.max(2, Math.round((bottom - top) / 5.5))
  for (let i = 0; i < n; i++) {
    const y = top + ((bottom - top - w * 0.6) * (i + 0.6)) / n
    const k = 1 - (i / n) * 0.35
    threads.push({ d: `M${r1(cx - half * k)} ${r1(y)} L${r1(cx + half * k)} ${r1(y)}` })
  }
  return [{ d: body }, ...threads]
}

/** A front tooth seen from the front: straight sides, rounded edge, open at the top. */
function frontTooth(x0: number, x1: number, top: number, bottom: number): string {
  const r = Math.min((x1 - x0) / 2, 3.2)
  return `M${r1(x0)} ${r1(top)} L${r1(x0)} ${r1(bottom - r)} C${r1(x0)} ${r1(bottom)} ${r1(x0 + r * 0.4)} ${r1(bottom + 0.2)} ${r1(x0 + r)} ${r1(bottom + 0.2)} L${r1(x1 - r)} ${r1(bottom + 0.2)} C${r1(x1 - r * 0.4)} ${r1(bottom + 0.2)} ${r1(x1)} ${r1(bottom)} ${r1(x1)} ${r1(bottom - r)} L${r1(x1)} ${r1(top)}`
}

/** A row of front teeth hanging from y = top, between x0 and x1; the middle ones longest. */
function toothRow(x0: number, x1: number, top: number, bottoms: number[]): Stroke[] {
  const n = bottoms.length
  const w = (x1 - x0) / n
  return bottoms.map((b, i) => ({ d: frontTooth(x0 + i * w, x0 + (i + 1) * w, top, b) }))
}

/** A scalloped line: the lower edges of teeth seen inside a tray. */
function scallops(x0: number, x1: number, y: number, depth: number, n: number): string {
  const w = (x1 - x0) / n
  let d = `M${r1(x0)} ${r1(y)}`
  for (let i = 0; i < n; i++) {
    const a = x0 + i * w
    const b = a + w
    d += ` C${r1(a)} ${r1(y + depth)} ${r1(b)} ${r1(y + depth)} ${r1(b)} ${r1(y)}`
  }
  return d
}

/** A small rounded square, for a bracket. */
function square(cx: number, cy: number, s: number): string {
  const h = s / 2
  return `M${r1(cx - h)} ${r1(cy - h)} L${r1(cx + h)} ${r1(cy - h)} L${r1(cx + h)} ${r1(cy + h)} L${r1(cx - h)} ${r1(cy + h)} Z`
}

// ── The kinds ─────────────────────────────────────────────────────────────────

export function shapesOf(kind: WorkKind): Stroke[] {
  switch (kind) {
    case 'implantCrown':
      return [
        { d: place(CROWN, 11, 5, 26, 16) },
        { d: 'M18.5 21 L19.6 24.5 L28.4 24.5 L29.5 21' },
        ...screw(24, 24.5, 43.5, 11),
      ]

    case 'implantBridge':
      return [
        { d: place(CROWN, 3, 9, 14, 13) },
        { d: place(CROWN, 17, 10, 14, 11.5) },
        { d: place(CROWN, 31, 9, 14, 13) },
        ...screw(10, 22.5, 39, 7.2),
        ...screw(38, 22.5, 39, 7.2),
      ]

    case 'crown':
      // Kevin: a tooth with a cap on its top, not a king's crown.
      return [
        { d: place(CAP, 9, 7, 30, 35) },
        { d: place(MOLAR_BELOW_MARGIN, 9, 7, 30, 35) },
      ]

    case 'bridge':
      return [
        { d: place(MOLAR, 3, 11, 14, 27) },
        { d: place(CROWN, 17, 12, 14, 12) },
        { d: place(MOLAR, 31, 11, 14, 27) },
      ]

    case 'veneer':
      return [
        { d: place(MOLAR, 9, 6, 30, 37) },
        // The shell over the front half, its inner edge across the tooth.
        { d: place('M52 8 C60 -1 75 -4 87 0 C101 5 106 21 103 37 C101 50 95 58 91 69 C80 67 71 60 65 50 C57 37 53 23 52 8 Z', 9, 6, 30, 37) },
      ]

    case 'laminate':
      return [
        { d: place(MOLAR, 9, 6, 30, 37) },
        // A thin shell hugging the front, nothing across the tooth.
        { d: place('M78 -1 C95 2 106 18 103 37 C101 51 95 61 90 73 L86 64', 9, 6, 30, 37) },
      ]

    case 'inlay':
      return [
        { d: place(MOLAR, 9, 6, 30, 37) },
        { d: place('M33 2 L36 26 C36.5 30 39 32 43 32 L57 32 C61 32 63.5 30 64 26 L67 2', 9, 6, 30, 37) },
      ]

    case 'onlay':
      return [
        { d: place(MOLAR, 9, 6, 30, 37) },
        { d: place('M3 36 C18 28 32 44 50 36 C68 28 82 42 97 35', 9, 6, 30, 37) },
      ]

    case 'filling':
      return [
        { d: place(MOLAR, 9, 6, 30, 37) },
        { cx: 31, cy: 15.5, r: 2.6 },
      ]

    case 'denture':
      return [
        { d: place(TRAY_TOP, 3, 8, 42, 26) },
        { d: 'M3.8 23.6 L44.2 23.6' },
        ...toothRow(6.5, 41.5, 23.6, [32.5, 35, 37, 37, 35, 32.5]),
      ]

    case 'allOnX':
      return [
        { d: place(CROWN, 3, 9, 8.4, 12) },
        { d: place(CROWN, 11.4, 8.5, 8.4, 12.5) },
        { d: place(CROWN, 19.8, 8, 8.4, 13) },
        { d: place(CROWN, 28.2, 8.5, 8.4, 12.5) },
        { d: place(CROWN, 36.6, 9, 8.4, 12) },
        ...screw(9, 21.5, 37.5, 5.4),
        ...screw(19.3, 21.5, 40.5, 5.4),
        ...screw(28.7, 21.5, 40.5, 5.4),
        ...screw(39, 21.5, 37.5, 5.4),
      ]

    case 'nightGuard':
      // A smooth guard over the arch, the teeth's edges showing through.
      return [
        { d: 'M4 19 C3 12 9 9.5 15 11.5 C19 12.8 21.5 14.5 24 14.5 C26.5 14.5 29 12.8 33 11.5 C39 9.5 45 12 44 19 L43 27 C42 34 35 38.5 24 38.5 C13 38.5 6 34 5 27 Z' },
        { d: scallops(8.5, 39.5, 21.5, 8.5, 5) },
      ]

    case 'retainer':
      // The front teeth, the wire across them, a clasp at each end.
      return [
        { d: 'M4 17 C3 11 9 9 15 11 C19 12.3 21.5 14 24 14 C26.5 14 29 12.3 33 11 C39 9 45 11 44 17 C43 30 35 37.5 24 37.5 C13 37.5 5 30 4 17 Z' },
        ...toothRow(12, 36, 15.5, [31, 33, 33, 31]),
        { d: 'M7 25 L41 25' },
        { d: 'M7 25 C5 25 5 28.6 7 28.6' },
        { d: 'M41 25 C43 25 43 28.6 41 28.6' },
      ]

    case 'ibt':
      return [
        { d: 'M4 17 C3 11 9 9 15 11 C19 12.3 21.5 14 24 14 C26.5 14 29 12.3 33 11 C39 9 45 11 44 17 C43 30 35 37.5 24 37.5 C13 37.5 5 30 4 17 Z' },
        { d: 'M7.5 24.5 C14 29 34 29 40.5 24.5' },
        { d: square(12.5, 26.2, 3.6) },
        { d: square(20, 27.8, 3.6) },
        { d: square(28, 27.8, 3.6) },
        { d: square(35.5, 26.2, 3.6) },
      ]

    case 'surgicalGuide':
      return [
        { d: 'M4 26 L4 18 C3.5 11 9.5 9 15.5 11 C19.5 12.3 21.8 14 24 14 C26.2 14 28.5 12.3 32.5 11 C38.5 9 44.5 11 44 18 L44 26 Z' },
        { cx: 11.5, cy: 19.5, r: 2.4 },
        { cx: 20, cy: 20.2, r: 2.4 },
        { cx: 28, cy: 20.2, r: 2.4 },
        { cx: 36.5, cy: 19.5, r: 2.4 },
        { d: scallops(6, 42, 26, 10, 6) },
      ]

    case 'tooth':
    default:
      return [{ d: place(MOLAR, 9, 6, 30, 37) }]
  }
}
