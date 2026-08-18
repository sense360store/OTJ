// How large a saved diagram is allowed to be on each surface that shows one.
//
// WHY THIS IS TYPESCRIPT RATHER THAN CSS, which is where a cap would normally
// live. A diagram surface is a box with an aspect ratio, and bounding it needs
// BOTH a height cap and the width that cap implies: width:100% plus an aspect
// ratio plus a max-height cannot all hold, so a height cap on its own leaves
// the box the whole column with the pitch drawn small in the middle of it. That
// is the letterboxing the editor canvas already fixed once
// (DrillDiagramEditor.css), and it is the defect this module exists to keep
// fixed.
//
// The width that a height cap implies is `cap x ratio`, and that multiplication
// has to happen somewhere. It used to happen in the stylesheet, as
//
//   max-width: calc(var(--dd-cap) * var(--dd-ratio, 1))
//
// and a review of #189 was right that this is not a safe thing to ship: it
// multiplies two custom properties inside calc(), and the declaration is
// dropped whole on any engine that will not do that arithmetic, including iOS
// Safari 18.x and Chromium before 140. Dropped, the height cap survives alone,
// which is precisely the letterboxed wide-grass box the cap was added to
// prevent. So the multiplication moved here, where it is ordinary arithmetic on
// a number, and the renderer emits a PLAIN LENGTH that every engine understands.
//
// The caps therefore have exactly one source, and it is this file. The
// stylesheet declares no cap and does no arithmetic.

// A cap is a CSS length: a number and a unit, and nothing else. px for a fixed
// card, vh where the hazard is the phone's viewport rather than a fixed size.
const CAP = /^(-?\d*\.?\d+)([a-z]+)$/

// Session day, preparing before the session. The card is the width of the
// column, so the bound that matters is height: a setup card should show the
// shape of the drill without pushing the next activity off the screen.
//
// Live delivery is the tightest case and the one that matters most: the timer,
// the transport controls and Mark done & next stay the primary things on the
// screen. Bounded in vh rather than px because the hazard is the phone's
// viewport. A portrait full pitch is 680 by 1050 view units, so uncapped on a
// 560px live stage it is roughly 865px tall, taller than most phone screens,
// and a coach would scroll past the drill to reach anything under it.
export const DIAGRAM_HEIGHT_CAP = {
  sessionDay: '340px',
  live: '42vh',
} as const

export type DiagramHeightCap = (typeof DIAGRAM_HEIGHT_CAP)[keyof typeof DIAGRAM_HEIGHT_CAP]

// The width a height cap implies, as a plain CSS length in the cap's own unit.
//
// Returns undefined for anything it cannot compute, and the renderer then emits
// NEITHER cap. That direction is deliberate: a height cap without its width is
// the letterboxed box, so failing towards an uncapped diagram shows the coach a
// large picture rather than a small one adrift in a field of grass.
export function diagramWidthCap(cap: string, ratio: number): string | undefined {
  const m = CAP.exec(cap.trim())
  if (!m) return undefined
  const size = Number(m[1])
  if (!Number.isFinite(size) || size <= 0) return undefined
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined
  // Four decimals is well under a device pixel for px, and under a tenth of a
  // pixel for vh on any real viewport, while keeping the emitted value short
  // enough to read in devtools.
  return `${Number((size * ratio).toFixed(4))}${m[2]}`
}
