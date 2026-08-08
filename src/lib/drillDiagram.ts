// Pure geometry for the drill layout renderer (ADR-0008, PR 9). The SVG
// draws in viewBox units: metres times diagramScale, so positions stay
// scale true whatever the declared area measures, while glyphs keep a
// fixed unit size and read like map markers. Everything here is arithmetic
// on already scaled points, unit tested away from the component.
import type { LayoutArea, LayoutPoint } from './drillLayout'

// The longest side of any diagram in viewBox units. 600 keeps glyph sizes
// (a 13 unit player disc, a 9 unit cone) legible from a 10 metre grid up
// to a full pitch.
export const DIAGRAM_LONG_SIDE = 600

export function diagramScale(area: LayoutArea): number {
  return DIAGRAM_LONG_SIDE / Math.max(area.width, area.length)
}

// Pull an arrow's end back along its own line so the head finishes at
// the target instead of the shaft overshooting through it. A zero length
// or shorter than the pull back arrow stays put.
export function arrowShaft(from: LayoutPoint, to: LayoutPoint, pullBack: number): { from: LayoutPoint; to: LayoutPoint } {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0 || len <= pullBack) return { from, to }
  const t = (len - pullBack) / len
  return { from, to: { x: from.x + dx * t, y: from.y + dy * t } }
}

// The dribble's wavy line: quadratic half waves along the from to vector,
// control points offset alternately to either side, finishing with a
// short straight run into `to`. The straight tail matters for the marker:
// an auto oriented arrowhead takes the path's end tangent, and ending on
// a wave would point the head up to half a wave off the travel direction.
export function wavyPath(from: LayoutPoint, to: LayoutPoint, amplitude: number, wavelength: number): string {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return `M ${from.x} ${from.y}`
  // Unit vector along the line and its perpendicular.
  const ux = dx / len
  const uy = dy / len
  const px = -uy
  const py = ux
  const tail = Math.min(wavelength / 2, len / 4)
  const waved = len - tail
  const halves = Math.max(1, Math.round(waved / (wavelength / 2)))
  const step = waved / halves
  let d = `M ${round(from.x)} ${round(from.y)}`
  for (let i = 0; i < halves; i++) {
    const midAt = (i + 0.5) * step
    const endAt = (i + 1) * step
    const side = i % 2 === 0 ? 1 : -1
    const cx = from.x + ux * midAt + px * amplitude * side
    const cy = from.y + uy * midAt + py * amplitude * side
    const ex = from.x + ux * endAt
    const ey = from.y + uy * endAt
    d += ` Q ${round(cx)} ${round(cy)} ${round(ex)} ${round(ey)}`
  }
  d += ` L ${round(to.x)} ${round(to.y)}`
  return d
}

// Two decimal places keeps the markup stable and short; sub hundredth
// precision is invisible at these sizes.
function round(n: number): number {
  return Math.round(n * 100) / 100
}
