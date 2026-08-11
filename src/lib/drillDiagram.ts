// The drill diagram: one versioned model for a coaching exercise drawn on a
// pitch, and the only place a stored diagram is read or written.
//
// WHAT THIS IS NOT. It is not the tactics board. A board seats a TEAM: real
// players, shirt numbers, a formation, and a playerId reference that resolves
// to a child's name at render time (src/lib/tacticsBoard.ts). A drill diagram
// is a REUSABLE EXERCISE: generic players, cones, balls, goals, arrows, zones
// and short labels, attached to a drill that any coach runs with any group. It
// carries no person, and it never will. The two share the interaction
// primitives (clampFraction, isDrag) and nothing else.
//
// THE IDENTITY BOUNDARY, and why it is structural rather than a rule. The
// parser and the serialiser both REBUILD each element from an allow-list of
// known fields; neither ever spreads an input object. So a playerId, a name, a
// Spond member id or a guardian's phone number cannot survive a read or a
// write even if one reached the column by some other path. Migration
// 0046_drill_diagram.sql states the same key allow-list as a check constraint,
// so the database refuses it too, from any client including service_role. That
// is the same shape 0028 gave the board tokens, for the same reason.
//
// COORDINATES ARE FRACTIONS, NEVER PIXELS. Every position is 0 to 1 across the
// surface, so one stored diagram reads on a phone, on a desktop and in print
// without a second copy, and a renderer change can never invalidate saved work.
// serializeDrillDiagram rounds them to a fixed precision, so a float that
// drifted in the last bit does not present as an unsaved change.
//
// DEFENSIVE ON READ, CANONICAL ON WRITE. The column is plain jsonb, so a read
// treats it as untrusted: unknown fields go, corrupt numbers drop their
// element, out of range numbers are clamped, and only an unknown VERSION
// discards the diagram whole (reading a future shape as version 1 would draw it
// wrongly and then save it back flattened, which is worse than showing nothing).
// Everything else fails towards keeping the coach's work on screen, the same
// asymmetry the training classifier and the session lifecycle rules use.

import { clampFraction } from './tacticsBoard'
import { BIB_COLOURS } from './bibs'

export const DRILL_DIAGRAM_VERSION = 1

// The bounds. Deliberately generous enough for a real exercise and small
// enough that a diagram is never a payload: sixty elements is roughly three
// times the busiest grassroots drill anyone has drawn on a whiteboard.
export const MAX_DIAGRAM_ELEMENTS = 60
// A coaching label is a word or two ("Press", "3v2", "Rotate"), not a
// paragraph. The cap is what fits legibly on a phone sized surface.
export const MAX_TEXT_LENGTH = 24
// The badge inside a player disc: a number or an initial, nothing more.
export const MAX_PLAYER_LABEL = 3
// A zone smaller than this is invisible and impossible to grab back, so it is
// grown rather than stored.
export const MIN_ZONE_SIZE = 0.04
export const MIN_GOAL_WIDTH = 0.06
export const MAX_GOAL_WIDTH = 0.6
// Fractions are stored to four decimal places: finer than any screen resolves,
// and coarse enough that the stored form is stable.
const COORD_DP = 4

// ---- Vocabulary ---------------------------------------------------------

export type DiagramSurfaceKind = 'full_pitch' | 'half_pitch' | 'blank'
export type DiagramOrientation = 'portrait' | 'landscape'

export const SURFACE_KINDS: readonly DiagramSurfaceKind[] = ['full_pitch', 'half_pitch', 'blank']
export const ORIENTATIONS: readonly DiagramOrientation[] = ['portrait', 'landscape']

export const SURFACE_LABEL: Record<DiagramSurfaceKind, string> = {
  full_pitch: 'Full pitch',
  half_pitch: 'Half pitch',
  blank: 'Blank area',
}

// The colours a coach picks from, in the club's bib words. A deliberate subset
// of the bib vocabulary (src/lib/bibs.ts): a coach setting up a drill thinks in
// bibs, so a diagram uses the same names and the same swatches rather than
// inventing a second colour language. drillDiagram.invariant.test.ts fails the
// build if the two drift apart.
export type DiagramColour = 'blue' | 'red' | 'yellow' | 'green' | 'orange' | 'white' | 'black'

export const DIAGRAM_COLOURS: readonly DiagramColour[] = [
  'blue',
  'red',
  'yellow',
  'green',
  'orange',
  'white',
  'black',
]

const DEFAULT_COLOUR: DiagramColour = 'blue'

export function diagramSwatch(colour: DiagramColour): string {
  return BIB_COLOURS.find((b) => b.value === colour)?.swatch ?? '#1f43d6'
}

export function colourLabel(colour: DiagramColour): string {
  return BIB_COLOURS.find((b) => b.value === colour)?.label ?? colour
}

// The three arrow meanings, in the notation a coach already reads on a
// whiteboard: a run is a plain line, a pass is dashed, a dribble is wavy. The
// LINE STYLE carries the meaning, never the colour alone, so the three stay
// apart for anyone who does not see colour and in a black and white print.
export type ArrowKind = 'run' | 'pass' | 'dribble'
export const ARROW_KINDS: readonly ArrowKind[] = ['run', 'pass', 'dribble']
export const ARROW_LABEL: Record<ArrowKind, string> = {
  run: 'Run',
  pass: 'Pass',
  dribble: 'Dribble',
}

export type GoalFacing = 'up' | 'down' | 'left' | 'right'
const FACINGS: readonly GoalFacing[] = ['up', 'down', 'left', 'right']

// ---- Elements -----------------------------------------------------------
// Seven types, each an exact field set. NOTHING carries a person.

export interface PlayerElement {
  type: 'player'
  id: string
  x: number
  y: number
  colour: DiagramColour
  // A badge, not a name: a number or an initial, capped at three characters.
  // There is nowhere here to put a child, and the cap is enforced on read and
  // on write.
  label: string
}

export interface ConeElement {
  type: 'cone'
  id: string
  x: number
  y: number
  colour: DiagramColour
}

export interface BallElement {
  type: 'ball'
  id: string
  x: number
  y: number
}

export interface GoalElement {
  type: 'goal'
  id: string
  x: number
  y: number
  // Fraction of the surface width the mouth spans.
  width: number
  facing: GoalFacing
}

export interface ArrowElement {
  type: 'arrow'
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  arrow: ArrowKind
}

export interface ZoneElement {
  type: 'zone'
  id: string
  // Top left corner plus size, all fractions. Never inverted: a resize that
  // would flip the rectangle is normalised before it is stored.
  x: number
  y: number
  w: number
  h: number
  colour: DiagramColour
}

export interface TextElement {
  type: 'text'
  id: string
  x: number
  y: number
  text: string
}

export type DiagramElement =
  | PlayerElement
  | ConeElement
  | BallElement
  | GoalElement
  | ArrowElement
  | ZoneElement
  | TextElement

export type DiagramElementType = DiagramElement['type']

export const ELEMENT_TYPES: readonly DiagramElementType[] = [
  'player',
  'cone',
  'ball',
  'goal',
  'arrow',
  'zone',
  'text',
]

export const ELEMENT_LABEL: Record<DiagramElementType, string> = {
  player: 'Player',
  cone: 'Cone',
  ball: 'Ball',
  goal: 'Goal',
  arrow: 'Arrow',
  zone: 'Zone',
  text: 'Label',
}

export interface DiagramSurface {
  kind: DiagramSurfaceKind
  orientation: DiagramOrientation
}

export interface DrillDiagram {
  version: number
  surface: DiagramSurface
  // Draw order: later elements paint over earlier ones, so the order is part
  // of the diagram and part of its signature.
  elements: DiagramElement[]
}

export function emptyDiagram(): DrillDiagram {
  return { version: DRILL_DIAGRAM_VERSION, surface: { kind: 'full_pitch', orientation: 'portrait' }, elements: [] }
}

export function diagramIsEmpty(d: DrillDiagram | null | undefined): boolean {
  return !d || d.elements.length === 0
}

// ---- Identity -----------------------------------------------------------

// The next id for a new element: one past the highest numeric suffix anywhere
// in the diagram, whatever type carries it. Counting across the WHOLE diagram
// rather than per type means a delete followed by an add can never reissue an
// id that another element still holds, which is the failure an array index (or
// a per type counter) walks straight into.
export function nextElementId(type: DiagramElementType, elements: readonly DiagramElement[]): string {
  const taken = new Set(elements.map((e) => e.id))
  let highest = 0
  for (const e of elements) {
    const m = /-(\d+)$/.exec(e.id)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > highest) highest = n
    }
  }
  let n = highest + 1
  // Counting alone is not quite enough: a stored suffix at or above 2^53 makes
  // `highest + 1` equal `highest`, and the "new" id is one an element already
  // holds. Checking closes it for good, whatever arrives in the column.
  let candidate = `${type}-${n}`
  while (taken.has(candidate)) candidate = `${type}-${++n}-${taken.size}`
  return candidate
}

// ---- Reading ------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// A finite number, or null. A string that happens to look like a number is
// NOT accepted: the column is written by this module alone, so a string there
// is corruption rather than a shape to be lenient about.
function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// A finite fraction pulled onto the surface, or null when there is no honest
// number to pull. Out of range is clamped (a stale value, keep the element);
// NaN, Infinity and a non number are rejected (corruption, drop the element).
function fraction(v: unknown): number | null {
  const n = finite(v)
  return n === null ? null : clampFraction(n)
}

function clampTo(n: number, lo: number, hi: number): number {
  if (n < lo) return lo
  if (n > hi) return hi
  return n
}

function colour(v: unknown): DiagramColour {
  return typeof v === 'string' && (DIAGRAM_COLOURS as readonly string[]).includes(v)
    ? (v as DiagramColour)
    : DEFAULT_COLOUR
}

function shortText(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function id(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed.slice(0, 64)
}

// One element, rebuilt field by field from an allow-list. Returns null to drop
// it. This function is the identity boundary: it never spreads its input, so
// no key it does not name can leave it.
function parseElement(raw: unknown): DiagramElement | null {
  if (!isObject(raw)) return null
  const elId = id(raw.id)
  if (!elId) return null

  switch (raw.type) {
    case 'player': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      return { type: 'player', id: elId, x, y, colour: colour(raw.colour), label: shortText(raw.label, MAX_PLAYER_LABEL) }
    }
    case 'cone': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      return { type: 'cone', id: elId, x, y, colour: colour(raw.colour) }
    }
    case 'ball': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      return { type: 'ball', id: elId, x, y }
    }
    case 'goal': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      const w = finite(raw.width)
      return {
        type: 'goal',
        id: elId,
        x,
        y,
        width: clampTo(w === null ? 0.24 : w, MIN_GOAL_WIDTH, MAX_GOAL_WIDTH),
        facing: typeof raw.facing === 'string' && (FACINGS as readonly string[]).includes(raw.facing)
          ? (raw.facing as GoalFacing)
          : 'up',
      }
    }
    case 'arrow': {
      const x1 = fraction(raw.x1)
      const y1 = fraction(raw.y1)
      const x2 = fraction(raw.x2)
      const y2 = fraction(raw.y2)
      // An arrow with a missing end has no direction to draw, so it goes.
      if (x1 === null || y1 === null || x2 === null || y2 === null) return null
      return {
        type: 'arrow',
        id: elId,
        x1,
        y1,
        x2,
        y2,
        arrow: typeof raw.arrow === 'string' && (ARROW_KINDS as readonly string[]).includes(raw.arrow)
          ? (raw.arrow as ArrowKind)
          : 'run',
      }
    }
    case 'zone': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      const rawW = finite(raw.w)
      const rawH = finite(raw.h)
      // A negative size is an inverted rectangle; its magnitude is the honest
      // reading, and the minimum keeps a zero from becoming an ungrabbable
      // sliver.
      const w = clampTo(rawW === null ? MIN_ZONE_SIZE : Math.abs(rawW), MIN_ZONE_SIZE, 1)
      const h = clampTo(rawH === null ? MIN_ZONE_SIZE : Math.abs(rawH), MIN_ZONE_SIZE, 1)
      return {
        type: 'zone',
        id: elId,
        // Pull the corner back so the whole rectangle stays on the surface.
        x: clampTo(x, 0, 1 - w),
        y: clampTo(y, 0, 1 - h),
        w,
        h,
        colour: colour(raw.colour),
      }
    }
    case 'text': {
      const x = fraction(raw.x)
      const y = fraction(raw.y)
      if (x === null || y === null) return null
      const t = shortText(raw.text, MAX_TEXT_LENGTH)
      // A label with nothing in it draws nothing and cannot be tapped back
      // open, so it is dropped rather than stored as an invisible element.
      if (t === '') return null
      return { type: 'text', id: elId, x, y, text: t }
    }
    default:
      return null
  }
}

function parseSurface(raw: unknown): DiagramSurface {
  if (!isObject(raw)) return { kind: 'full_pitch', orientation: 'portrait' }
  return {
    kind: typeof raw.kind === 'string' && (SURFACE_KINDS as readonly string[]).includes(raw.kind)
      ? (raw.kind as DiagramSurfaceKind)
      : 'full_pitch',
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
  }
}

// Read a stored diagram. Returns null for "there is no diagram here", which is
// what the absent column, a null, and an unreadable shape all mean to a screen.
export function parseDrillDiagram(value: unknown): DrillDiagram | null {
  if (!isObject(value)) return null
  // The one whole-diagram refusal. See the header.
  if (value.version !== DRILL_DIAGRAM_VERSION) return null
  if (!Array.isArray(value.elements)) return null

  const elements: DiagramElement[] = []
  const seen = new Set<string>()
  for (const raw of value.elements) {
    if (elements.length >= MAX_DIAGRAM_ELEMENTS) break
    const el = parseElement(raw)
    if (!el) continue
    // Two elements under one id would make selection, move and delete act on
    // whichever the search reached first. The first wins; the later one goes.
    if (seen.has(el.id)) continue
    seen.add(el.id)
    elements.push(el)
  }

  return { version: DRILL_DIAGRAM_VERSION, surface: parseSurface(value.surface), elements }
}

// ---- Writing ------------------------------------------------------------

function round(n: number): number {
  const f = 10 ** COORD_DP
  // clampFraction first, so a value that never went through the parser still
  // cannot leave this module outside 0 to 1.
  return Math.round(clampFraction(n) * f) / f
}

// The exact object the jsonb column stores, rebuilt key by key in a fixed
// order. Deliberately NOT a pass-through of the live element: the stored shape
// is the one this module names and the one the check constraint allows, so a
// stray property on an element can never reach the database. This is the twin
// of parseElement, and the two allow-lists are the same list.
function serializeElement(el: DiagramElement): Record<string, unknown> {
  switch (el.type) {
    case 'player':
      // Trimmed HERE rather than in the reducer: the draft keeps what the coach
      // is typing, spaces and all, and the stored form is tidy. Both sides of
      // the saved comparison run through this function, so the two can never
      // disagree about a trailing space.
      return { type: 'player', id: el.id, x: round(el.x), y: round(el.y), colour: el.colour, label: el.label.trim().slice(0, MAX_PLAYER_LABEL) }
    case 'cone':
      return { type: 'cone', id: el.id, x: round(el.x), y: round(el.y), colour: el.colour }
    case 'ball':
      return { type: 'ball', id: el.id, x: round(el.x), y: round(el.y) }
    case 'goal':
      return {
        type: 'goal',
        id: el.id,
        x: round(el.x),
        y: round(el.y),
        width: round(clampTo(el.width, MIN_GOAL_WIDTH, MAX_GOAL_WIDTH)),
        facing: el.facing,
      }
    case 'arrow':
      return { type: 'arrow', id: el.id, x1: round(el.x1), y1: round(el.y1), x2: round(el.x2), y2: round(el.y2), arrow: el.arrow }
    case 'zone': {
      const w = round(clampTo(el.w, MIN_ZONE_SIZE, 1))
      const h = round(clampTo(el.h, MIN_ZONE_SIZE, 1))
      return { type: 'zone', id: el.id, x: round(clampTo(el.x, 0, 1 - w)), y: round(clampTo(el.y, 0, 1 - h)), w, h, colour: el.colour }
    }
    case 'text':
      return { type: 'text', id: el.id, x: round(el.x), y: round(el.y), text: el.text.trim().slice(0, MAX_TEXT_LENGTH) }
  }
}

// The canonical stored form: deterministic key order, rounded fractions, and
// nothing that is not on the allow-list. A save writes exactly this, and the
// screen compares the readback with exactly this, so "Saved" means the database
// holds the diagram on screen rather than merely that a request returned.
export function serializeDrillDiagram(d: DrillDiagram): unknown {
  return {
    version: DRILL_DIAGRAM_VERSION,
    surface: { kind: d.surface.kind, orientation: d.surface.orientation },
    elements: d.elements
      // A label with nothing in it is dropped on the way out as well as on the
      // way in. Writing one would make the readback differ from what was sent,
      // and the screen would report Unsaved for ever with nothing a coach could
      // do about it. The reducer already refuses to make one; this is the
      // second lock on the same door.
      .filter((el) => el.type !== 'text' || el.text.trim() !== '')
      .slice(0, MAX_DIAGRAM_ELEMENTS)
      .map(serializeElement),
  }
}

// The whole diagram flattened to a string, so a move, an add, a delete, a
// colour change, a reorder or a surface switch all register as a difference.
// Drives the unsaved indicator and the save readback comparison.
export function diagramSignature(d: DrillDiagram | null): string {
  return d === null ? '' : JSON.stringify(serializeDrillDiagram(d))
}

// ---- Describing a diagram ------------------------------------------------

// What the diagram holds, in words. A picture with no text alternative is a
// blank to anyone using a screen reader, and "Drill diagram" says nothing; a
// count per element type at least says what the exercise is made of. Lives with
// the model rather than the renderer so the editor and the read only view give
// the same description, and so it is testable without rendering anything.
export function describeDiagram(diagram: DrillDiagram): string {
  const counts = new Map<DiagramElementType, number>()
  for (const el of diagram.elements) counts.set(el.type, (counts.get(el.type) ?? 0) + 1)
  if (counts.size === 0) return 'Drill diagram, empty'
  const parts = [...counts.entries()].map(([type, n]) => {
    const noun = ELEMENT_LABEL[type].toLowerCase()
    return `${n} ${n === 1 ? noun : noun + 's'}`
  })
  return `Drill diagram: ${parts.join(', ')}`
}
