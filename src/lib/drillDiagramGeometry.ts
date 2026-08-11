// The geometry the drill diagram editor and its read only view SHARE.
//
// WHY IT IS ONE MODULE. A drill diagram is drawn twice: once on the editor's
// canvas and once, read only, on the drill page (and, from C2, wherever a
// session shows its drills). Two SVG implementations would drift, and the drift
// would be invisible until a coach found their saved diagram looked different
// from the one they drew. So everything that turns a stored fraction into
// something on screen lives here, both surfaces import it, and the tests above
// pin the conversion rather than either component.
//
// UNITS. A diagram stores fractions (0 to 1). This module converts them into
// the SVG viewBox units the surface declares. The viewBox is a fixed size per
// surface and orientation, and the SVG scales to whatever width the page gives
// it, so the same numbers serve a phone and a desktop with no branching.
//
// ORIENTATION IS THE PLAYING DIRECTION, NOT THE SCREEN SHAPE. 'portrait' means
// the play runs up and down the screen, with the goals top and bottom;
// 'landscape' means it runs across, goals left and right. A half pitch is a
// wide shape when the play runs up the screen, which is right: that is what a
// half pitch looks like from behind the goal.
//
// NO STATE, NO REACT, NO DOM. This project's component tests render to static
// markup with no DOM, so anything computed inside a component is untestable.
// The markings are returned as data for exactly that reason.

import { clampFraction } from './tacticsBoard'
import type { DiagramSurface, GoalElement } from './drillDiagram'

// The pitch, in metres, at the proportions the Laws give. The full pitch box is
// the same 680 by 1050 the tactics board uses, so the two read as the same
// club's pitch.
const PITCH_ACROSS = 680
const PITCH_ALONG = 1050
const BLANK_ACROSS = 700
const BLANK_ALONG = 1000
// The grass margin outside the touchlines, so a token on the line still reads.
const MARGIN = 30

export interface SurfaceSize {
  width: number
  height: number
}

// The playing area in "along by across" terms, before orientation is applied.
function naturalSize(kind: DiagramSurface['kind']): { along: number; across: number } {
  switch (kind) {
    case 'full_pitch':
      return { along: PITCH_ALONG, across: PITCH_ACROSS }
    case 'half_pitch':
      return { along: PITCH_ALONG / 2, across: PITCH_ACROSS }
    case 'blank':
      return { along: BLANK_ALONG, across: BLANK_ACROSS }
  }
}

export function surfaceSize(surface: DiagramSurface): SurfaceSize {
  const { along, across } = naturalSize(surface.kind)
  return surface.orientation === 'landscape' ? { width: along, height: across } : { width: across, height: along }
}

export function surfaceAspect(surface: DiagramSurface): string {
  const { width, height } = surfaceSize(surface)
  return `${width} / ${height}`
}

export function viewBox(surface: DiagramSurface): string {
  const { width, height } = surfaceSize(surface)
  return `0 0 ${width} ${height}`
}

// A stored fraction placed on the surface. Clamped on the way through, so even
// a value that reached the model by some path the parser never saw lands on the
// pitch rather than off the edge of the SVG.
export function toView(surface: DiagramSurface, x: number, y: number): { x: number; y: number } {
  const { width, height } = surfaceSize(surface)
  return { x: clampFraction(x) * width, y: clampFraction(y) * height }
}

// The inverse of toView: where a finger is, as a fraction of the surface.
//
// WHY THIS IS NOT A DIVISION BY THE ELEMENT'S BOX. An SVG with the default
// preserveAspectRatio ("xMidYMid meet") draws its viewBox as large as fits
// INSIDE its element and centres it, leaving bars on two sides when the element
// is a different shape. The editor's canvas is capped by both a maximum width
// and a maximum height, so on a short viewport (a phone held sideways) the
// element is wider than the pitch and the pitch is letterboxed inside it.
// Dividing by the element's own box then reads every press as further right
// than it was, by more the shorter the screen, and elements land away from the
// finger. Doing the letterbox arithmetic here means no CSS change can move the
// mapping again, and it is a pure function so the arithmetic is tested rather
// than assumed.
//
// Returns null when the box has not measured yet, so a gesture that fires
// before layout is ignored rather than guessed at.
export function pointerFraction(
  surface: DiagramSurface,
  box: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  if (!(box.width > 0) || !(box.height > 0)) return null
  const size = surfaceSize(surface)
  const scale = Math.min(box.width / size.width, box.height / size.height)
  const drawnW = size.width * scale
  const drawnH = size.height * scale
  const originX = box.left + (box.width - drawnW) / 2
  const originY = box.top + (box.height - drawnH) / 2
  const x = (clientX - originX) / drawnW
  const y = (clientY - originY) / drawnH
  // A press on a letterbox bar clamps onto the nearest edge of the pitch, which
  // is what a coach aiming just outside the touchline meant.
  return { x: clampFraction(Number.isFinite(x) ? x : 0.5), y: clampFraction(Number.isFinite(y) ? y : 0.5) }
}

// ---- Arrows -------------------------------------------------------------
// The head is computed rather than drawn with an SVG marker: a marker needs a
// document unique id (two diagrams on one page would collide) and scales with
// the stroke width. An explicit triangle is three points of pure maths, which
// is testable and cannot collide with anything.

export const ARROW_HEAD = 26

// The unit vector along the arrow, or a default pointing right when the two
// ends coincide. Without the fallback a zero length arrow divides by zero and
// every number downstream becomes NaN, which blanks the whole diagram.
function direction(x1: number, y1: number, x2: number, y2: number): { ux: number; uy: number; len: number } {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.hypot(dx, dy)
  if (!Number.isFinite(len) || len === 0) return { ux: 1, uy: 0, len: 0 }
  return { ux: dx / len, uy: dy / len, len }
}

// The three points of the head, tip last at the arrow's end.
export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size = ARROW_HEAD): { x: number; y: number }[] {
  const { ux, uy } = direction(x1, y1, x2, y2)
  // Perpendicular, for the two base corners.
  const px = -uy
  const py = ux
  const baseX = x2 - ux * size
  const baseY = y2 - uy * size
  const half = size * 0.42
  return [
    { x: baseX + px * half, y: baseY + py * half },
    { x: baseX - px * half, y: baseY - py * half },
    { x: x2, y: y2 },
  ]
}

// The shaft, stopped short of the head so the line does not show through the
// tip. A very short arrow keeps a shaft rather than reversing into itself.
export function arrowShaft(x1: number, y1: number, x2: number, y2: number, size = ARROW_HEAD): {
  x1: number
  y1: number
  x2: number
  y2: number
} {
  const { ux, uy, len } = direction(x1, y1, x2, y2)
  const back = Math.min(size * 0.8, len * 0.6)
  return { x1, y1, x2: x2 - ux * back, y2: y2 - uy * back }
}

// A dribble: a wave along the vector. The meaning is carried by the LINE SHAPE,
// not by colour, so a run, a pass and a dribble stay apart for a coach who does
// not see colour and on a black and white printout.
export function wavyPath(x1: number, y1: number, x2: number, y2: number, size = ARROW_HEAD): string {
  const shaft = arrowShaft(x1, y1, x2, y2, size)
  const { ux, uy, len } = direction(shaft.x1, shaft.y1, shaft.x2, shaft.y2)
  const px = -uy
  const py = ux
  const amplitude = 9
  const wavelength = 26
  const steps = Math.max(2, Math.round(len / (wavelength / 4)))
  const points: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len
    const offset = Math.sin((t / wavelength) * Math.PI * 2) * amplitude
    const x = shaft.x1 + ux * t + px * offset
    const y = shaft.y1 + uy * t + py * offset
    points.push(`${i === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`)
  }
  return points.join(' ')
}

function round(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

// ---- Goals --------------------------------------------------------------

// The depth of a goal from the line, in viewBox units. Fixed in C1: a goal is
// a recognisable object rather than a measured one, and one fewer handle on a
// phone is one fewer thing to catch with a thumb.
export const GOAL_DEPTH = 34

// The goal's box, centred on its stored point. width is a fraction of the
// surface WIDTH whichever way the goal faces, so the same stored number means
// the same real mouth however the diagram is turned.
export function goalRect(surface: DiagramSurface, goal: GoalElement): { x: number; y: number; w: number; h: number } {
  const size = surfaceSize(surface)
  const centre = toView(surface, goal.x, goal.y)
  const mouth = clampFraction(goal.width) * size.width
  const sideways = goal.facing === 'left' || goal.facing === 'right'
  const w = sideways ? GOAL_DEPTH : mouth
  const h = sideways ? mouth : GOAL_DEPTH
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h }
}

// ---- Pitch markings -----------------------------------------------------
// Returned as data, not as JSX, so the layout is provable without a DOM and
// both surfaces draw exactly the same lines.

export type Marking =
  | { shape: 'rect'; x: number; y: number; w: number; h: number }
  | { shape: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { shape: 'circle'; cx: number; cy: number; r: number; clip?: boolean }
  | { shape: 'spot'; cx: number; cy: number; r: number }

// One place in "along by across" terms mapped onto the screen. Portrait runs
// the play down the screen (along is y); landscape runs it across (along is x).
// Every marking goes through this, so the two orientations cannot disagree
// about anything except which way round they are.
function place(surface: DiagramSurface, along: number, across: number): { x: number; y: number } {
  return surface.orientation === 'landscape' ? { x: along, y: across } : { x: across, y: along }
}

function rect(surface: DiagramSurface, along: number, across: number, alongLen: number, acrossLen: number): Marking {
  const p = place(surface, along, across)
  const landscape = surface.orientation === 'landscape'
  return { shape: 'rect', x: p.x, y: p.y, w: landscape ? alongLen : acrossLen, h: landscape ? acrossLen : alongLen }
}

function line(surface: DiagramSurface, a1: number, c1: number, a2: number, c2: number): Marking {
  const p1 = place(surface, a1, c1)
  const p2 = place(surface, a2, c2)
  return { shape: 'line', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
}

function circle(surface: DiagramSurface, along: number, across: number, r: number, clip = false): Marking {
  const p = place(surface, along, across)
  return { shape: 'circle', cx: p.x, cy: p.y, r, clip }
}

function spot(surface: DiagramSurface, along: number, across: number, r = 6): Marking {
  const p = place(surface, along, across)
  return { shape: 'spot', cx: p.x, cy: p.y, r }
}

// The markings, in the same proportions the tactics board draws, so the two
// read as the same pitch.
export function pitchMarkings(surface: DiagramSurface): Marking[] {
  if (surface.kind === 'blank') return []

  const { along, across } = naturalSize(surface.kind)
  const playAlong = along - MARGIN * 2
  const playAcross = across - MARGIN * 2
  const midAcross = across / 2

  // Penalty and goal areas, at the Laws' proportions of the pitch width.
  const penDepth = playAcross * 0.266
  const penWidth = playAcross * 0.581
  const goalAreaDepth = playAcross * 0.105
  const goalAreaWidth = playAcross * 0.29
  const penSpot = playAcross * 0.193
  const centreR = playAcross * 0.153
  const goalMouth = playAcross * 0.161
  const goalDepth = 18

  const out: Marking[] = []

  // The boundary. A half pitch is open at the halfway end, so its boundary
  // stops there and the halfway line closes it.
  out.push(rect(surface, MARGIN, MARGIN, playAlong, playAcross))

  // The attacking end, present on both surfaces.
  out.push(rect(surface, MARGIN, midAcross - penWidth / 2, penDepth, penWidth))
  out.push(rect(surface, MARGIN, midAcross - goalAreaWidth / 2, goalAreaDepth, goalAreaWidth))
  out.push(spot(surface, MARGIN + penSpot, midAcross))
  out.push(rect(surface, MARGIN - goalDepth, midAcross - goalMouth / 2, goalDepth, goalMouth))

  if (surface.kind === 'full_pitch') {
    const farLine = along - MARGIN
    out.push(line(surface, along / 2, MARGIN, along / 2, across - MARGIN))
    out.push(circle(surface, along / 2, midAcross, centreR))
    out.push(spot(surface, along / 2, midAcross))
    out.push(rect(surface, farLine - penDepth, midAcross - penWidth / 2, penDepth, penWidth))
    out.push(rect(surface, farLine - goalAreaDepth, midAcross - goalAreaWidth / 2, goalAreaDepth, goalAreaWidth))
    out.push(spot(surface, farLine - penSpot, midAcross))
    out.push(rect(surface, farLine, midAcross - goalMouth / 2, goalDepth, goalMouth))
  } else {
    // The halfway line closes the open end, with the centre circle clipped to
    // the pitch so it reads as the semicircle a half pitch actually shows.
    const edge = along - MARGIN
    out.push(line(surface, edge, MARGIN, edge, across - MARGIN))
    out.push(circle(surface, edge, midAcross, centreR, true))
    out.push(spot(surface, edge, midAcross))
  }

  return out
}
