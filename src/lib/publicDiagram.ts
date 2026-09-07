// The drill diagram as it arrives in a PUBLIC snapshot (DRILL-02b).
//
// The server projects a saved Drill Maker diagram through a positive allow
// list (projectDrillDiagram in supabase/functions/_shared/share.ts) and the
// browser re-checks the result here before anything renders. The two are kept
// in step deliberately: the server is the authority, this is the client's
// independent re-check, and publicShare.invariant.test.ts fails the build if
// the element shapes drift apart.
//
// THE PUBLIC SHAPE IS NARROWER THAN THE STORED ONE. A public element carries
// no `id`, and the diagram carries no `version`: the snapshot version pins the
// shape. So a public diagram is not a DrillDiagram, and the one adapter that
// makes it one (toDrillDiagram, below) mints render only ids by position so
// the canonical renderer can key its elements. Nothing here parses a stored
// column: parseDrillDiagram stays the one reader of drills.diagram, and this
// module never sees that column.
//
// FAIL CLOSED. A diagram that is not exactly the projected shape (an unknown
// element type, a key outside its type's set, a non finite or out of range
// number, a label or text over its cap, an empty element list) makes the
// whole snapshot invalid, and the page renders the neutral unavailable state.
// That is the same rule the board tokens have had since PR 3, and it is the
// right direction: a public page that draws part of a payload it could not
// validate is a page that draws things nobody reviewed.
//
// ABSENCE IS NOT MALFORMATION. A snapshot frozen before DRILL-02b carries no
// `diagram` key on its drill fields at all, and every existing link keeps
// serving exactly what it froze. The validators treat an absent key as "no
// diagram" and the renderer shows none, until the link's owner rebuilds it.

import {
  ARROW_KINDS,
  DIAGRAM_COLOURS,
  DRILL_DIAGRAM_VERSION,
  ELEMENT_TYPES,
  MAX_DIAGRAM_ELEMENTS,
  MAX_PLAYER_LABEL,
  MAX_TEXT_LENGTH,
  ORIENTATIONS,
  SURFACE_KINDS,
  type DiagramElement,
  type DiagramElementType,
  type DiagramSurface,
  type DrillDiagram,
} from './drillDiagram'

// A public element is a stored element without its id.
export type PublicDiagramElement = DiagramElement extends infer E ? (E extends unknown ? Omit<E, 'id'> : never) : never

export interface PublicDrillDiagram {
  surface: DiagramSurface
  elements: PublicDiagramElement[]
}

// The exact key set per element type, WITHOUT id. Mirrors
// DIAGRAM_ELEMENT_ALLOWED in the server module; the invariant test compares
// the two.
export const PUBLIC_DIAGRAM_ELEMENT_KEYS: Record<DiagramElementType, readonly string[]> = {
  player: ['type', 'x', 'y', 'colour', 'label'],
  cone: ['type', 'x', 'y', 'colour'],
  ball: ['type', 'x', 'y'],
  goal: ['type', 'x', 'y', 'width', 'facing'],
  arrow: ['type', 'x1', 'y1', 'x2', 'y2', 'arrow'],
  zone: ['type', 'x', 'y', 'w', 'h', 'colour'],
  text: ['type', 'x', 'y', 'text'],
}
const DIAGRAM_KEYS = new Set(['surface', 'elements'])
const SURFACE_KEYS = new Set(['kind', 'orientation'])
const FACINGS: readonly string[] = ['up', 'down', 'left', 'right']
// A lone surrogate, which the server never emits: refused so a half character
// cannot reach an SVG text node. Kept in step with LONE_SURROGATE in share.ts.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function keysWithin(obj: Record<string, unknown>, allowed: ReadonlySet<string> | readonly string[]): boolean {
  const set = allowed instanceof Set ? allowed : new Set(allowed as readonly string[])
  return Object.keys(obj).every((k) => set.has(k))
}

function isFraction(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

function inVocab(vocab: readonly string[], v: unknown): boolean {
  return typeof v === 'string' && vocab.includes(v)
}

// Whether a value is a well formed public diagram. null is a drill with
// nothing to show and is accepted; undefined is a frozen snapshot and is the
// CALLER's decision, so it is refused here to keep this predicate exact.
export function validatePublicDiagram(value: unknown): value is PublicDrillDiagram | null {
  if (value === null) return true
  if (!isObject(value) || !keysWithin(value, DIAGRAM_KEYS)) return false
  if (!isObject(value.surface) || !keysWithin(value.surface, SURFACE_KEYS)) return false
  if (!inVocab(SURFACE_KINDS, value.surface.kind)) return false
  if (!inVocab(ORIENTATIONS, value.surface.orientation)) return false
  if (!Array.isArray(value.elements)) return false
  if (value.elements.length === 0 || value.elements.length > MAX_DIAGRAM_ELEMENTS) return false
  for (const raw of value.elements as unknown[]) {
    if (!isObject(raw)) return false
    if (!inVocab(ELEMENT_TYPES, raw.type)) return false
    const type = raw.type as DiagramElementType
    if (!keysWithin(raw, PUBLIC_DIAGRAM_ELEMENT_KEYS[type])) return false
    switch (type) {
      case 'player':
        if (!isFraction(raw.x) || !isFraction(raw.y) || !inVocab(DIAGRAM_COLOURS, raw.colour)) return false
        if (typeof raw.label !== 'string' || raw.label.length > MAX_PLAYER_LABEL) return false
        if (LONE_SURROGATE.test(raw.label)) return false
        break
      case 'cone':
        if (!isFraction(raw.x) || !isFraction(raw.y) || !inVocab(DIAGRAM_COLOURS, raw.colour)) return false
        break
      case 'ball':
        if (!isFraction(raw.x) || !isFraction(raw.y)) return false
        break
      case 'goal':
        if (!isFraction(raw.x) || !isFraction(raw.y) || !isFraction(raw.width)) return false
        if (!inVocab(FACINGS, raw.facing)) return false
        break
      case 'arrow':
        if (!isFraction(raw.x1) || !isFraction(raw.y1) || !isFraction(raw.x2) || !isFraction(raw.y2)) return false
        if (!inVocab(ARROW_KINDS, raw.arrow)) return false
        break
      case 'zone':
        if (!isFraction(raw.x) || !isFraction(raw.y) || !isFraction(raw.w) || !isFraction(raw.h)) return false
        if (!inVocab(DIAGRAM_COLOURS, raw.colour)) return false
        break
      case 'text':
        if (!isFraction(raw.x) || !isFraction(raw.y)) return false
        if (typeof raw.text !== 'string' || raw.text.length === 0 || raw.text.length > MAX_TEXT_LENGTH) return false
        if (LONE_SURROGATE.test(raw.text)) return false
        break
    }
  }
  return true
}

// A validated public diagram as the canonical renderer's input. Ids are
// minted from the element's position, which is all a React key needs, and
// they never leave the render. Every other field is copied by name, never
// spread, so this adapter cannot carry a key the validator did not admit.
export function toDrillDiagram(diagram: PublicDrillDiagram): DrillDiagram {
  const elements: DiagramElement[] = diagram.elements.map((el, i) => {
    const id = `${el.type}-${i + 1}`
    switch (el.type) {
      case 'player':
        return { type: 'player', id, x: el.x, y: el.y, colour: el.colour, label: el.label }
      case 'cone':
        return { type: 'cone', id, x: el.x, y: el.y, colour: el.colour }
      case 'ball':
        return { type: 'ball', id, x: el.x, y: el.y }
      case 'goal':
        return { type: 'goal', id, x: el.x, y: el.y, width: el.width, facing: el.facing }
      case 'arrow':
        return { type: 'arrow', id, x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2, arrow: el.arrow }
      case 'zone':
        return { type: 'zone', id, x: el.x, y: el.y, w: el.w, h: el.h, colour: el.colour }
      case 'text':
        return { type: 'text', id, x: el.x, y: el.y, text: el.text }
    }
  })
  return {
    version: DRILL_DIAGRAM_VERSION,
    surface: { kind: diagram.surface.kind, orientation: diagram.surface.orientation },
    elements,
  }
}
