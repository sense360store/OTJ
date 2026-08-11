// The drill diagram editor's state, as a pure reducer.
//
// WHY IT IS PURE. Every geometry change a coach can make (a drag, an arrow
// endpoint, a zone corner, a colour, a delete) happens here and nowhere else,
// so each one is provable in a unit test. This project has no DOM under test:
// component tests render to static markup (react-dom/server), so behaviour that
// lives inside a pointer handler is behaviour nobody can prove. Keeping the
// maths out of the component is what makes "a resize can never invert a zone"
// a test rather than a hope. The screen is left holding only the pointer
// plumbing, which is the part a browser has to run anyway.
//
// NOTHING HERE PERSISTS. The reducer edits a local draft. A drag produces a
// stream of move actions and not one network call; the save is an explicit
// action on the screen, and the only thing that marks the draft clean is a
// 'saved' carrying the signature the DATABASE confirmed, compared against what
// is on screen now. That is what lets an edit made during an in-flight save
// survive: the confirmed signature is of the older diagram, so the editor stays
// dirty and the coach's later change is still there to be saved.

import {
  MAX_DIAGRAM_ELEMENTS,
  MAX_PLAYER_LABEL,
  MAX_TEXT_LENGTH,
  MIN_ZONE_SIZE,
  diagramSignature,
  emptyDiagram,
  nextElementId,
  type ArrowKind,
  type DiagramColour,
  type DiagramElement,
  type DiagramElementType,
  type DiagramOrientation,
  type DiagramSurfaceKind,
  type DrillDiagram,
  type GoalFacing,
  type ZoneElement,
} from './drillDiagram'
import { clampFraction } from './tacticsBoard'

export interface DiagramEditorState {
  diagram: DrillDiagram
  selectedId: string | null
  // The canonical signature of the diagram the database is known to hold. Not
  // a boolean: a boolean cannot tell "saved, then edited again" from "saved"
  // once a save lands late.
  savedSignature: string
}

export type DiagramAction =
  | { op: 'add'; element: DiagramElementType; at: { x: number; y: number } }
  | { op: 'select'; id: string | null }
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'moveArrowEnd'; id: string; end: 'start' | 'end'; x: number; y: number }
  | { op: 'resizeZone'; id: string; corner: 'start' | 'end'; x: number; y: number }
  | { op: 'delete'; id: string }
  | { op: 'setColour'; id: string; colour: DiagramColour }
  | { op: 'setLabel'; id: string; text: string }
  | { op: 'setArrowKind'; id: string; arrow: ArrowKind }
  | { op: 'setGoalFacing'; id: string; facing: GoalFacing }
  | { op: 'setSurface'; surface: DiagramSurfaceKind }
  | { op: 'setOrientation'; orientation: DiagramOrientation }
  | { op: 'saved'; signature: string }

// New element defaults, in fractions. A zone and a goal open at a size a thumb
// can grab straight away, so the first thing a coach does is move it rather
// than hunt for a handle.
const NEW_ZONE = 0.24
const NEW_GOAL_WIDTH = 0.24
const NEW_ARROW_DX = 0.1
const NEW_ARROW_DY = 0.08
const NEW_TEXT = 'Label'

export function initEditor(diagram: DrillDiagram | null): DiagramEditorState {
  const d = diagram ?? emptyDiagram()
  return { diagram: d, selectedId: null, savedSignature: diagramSignature(d) }
}

export function isDirty(state: DiagramEditorState): boolean {
  return diagramSignature(state.diagram) !== state.savedSignature
}

export function canAddElement(state: DiagramEditorState): boolean {
  return state.diagram.elements.length < MAX_DIAGRAM_ELEMENTS
}

// The point a `move` action sets: the exact fraction the element ends up
// anchored at. Exported so a drag can hold the offset between where the finger
// landed and where the element actually is.
//
// WITHOUT THIS A DRAG JUMPS. Hit targets are deliberately generous, an arrow is
// grabbed anywhere along its length and a zone anywhere on its border, so the
// finger is usually nowhere near the anchor. Dispatching the raw pointer
// position as the new anchor teleports the element under the thumb the instant
// the drag threshold is crossed, and the coach then drags from wherever it
// landed. Subtracting the offset captured at press keeps the element under the
// finger where it was picked up.
export function elementAnchor(el: DiagramElement): { x: number; y: number } {
  switch (el.type) {
    case 'zone':
      return { x: el.x + el.w / 2, y: el.y + el.h / 2 }
    case 'arrow':
      return { x: (el.x1 + el.x2) / 2, y: (el.y1 + el.y2) / 2 }
    default:
      return { x: el.x, y: el.y }
  }
}

export function selectedElement(state: DiagramEditorState): DiagramElement | null {
  if (!state.selectedId) return null
  return state.diagram.elements.find((e) => e.id === state.selectedId) ?? null
}

// A pointer position turned into a fraction on the surface. A value off the
// surface is pulled back onto it; a value that is not a number at all (a
// gesture that fired before the surface measured) falls back to the middle
// rather than poisoning the element with NaN.
function pt(n: number): number {
  return Number.isFinite(n) ? clampFraction(n) : 0.5
}

function withElements(state: DiagramEditorState, elements: DiagramElement[]): DiagramEditorState {
  return { ...state, diagram: { ...state.diagram, elements } }
}

// Replace one element by id, leaving every other untouched and the array order
// (which is draw order) unchanged. Returns the state unchanged when the id
// matches nothing, so a stale gesture never dirties the diagram.
function mapElement(
  state: DiagramEditorState,
  id: string,
  fn: (el: DiagramElement) => DiagramElement | null,
): DiagramEditorState {
  const i = state.diagram.elements.findIndex((e) => e.id === id)
  if (i === -1) return state
  const next = fn(state.diagram.elements[i])
  if (next === null) return deleteElement(state, id)
  if (next === state.diagram.elements[i]) return state
  const elements = state.diagram.elements.slice()
  elements[i] = next
  return withElements(state, elements)
}

function deleteElement(state: DiagramEditorState, id: string): DiagramEditorState {
  const elements = state.diagram.elements.filter((e) => e.id !== id)
  if (elements.length === state.diagram.elements.length) return state
  return {
    ...state,
    diagram: { ...state.diagram, elements },
    // A selection pointing at an element that is gone would let Delete, a
    // colour change or a label edit act on nothing, or worse on whatever later
    // took the id.
    selectedId: state.selectedId === id ? null : state.selectedId,
  }
}

// A rectangle from two corners in any order: never inverted, never smaller
// than a thumb can grab, never off the surface. Used when a rectangle is being
// created, where either corner may be given first.
function rectFrom(ax: number, ay: number, bx: number, by: number): Pick<ZoneElement, 'x' | 'y' | 'w' | 'h'> {
  const w = Math.max(Math.abs(bx - ax), MIN_ZONE_SIZE)
  const h = Math.max(Math.abs(by - ay), MIN_ZONE_SIZE)
  const x = Math.min(Math.min(ax, bx), 1 - w)
  const y = Math.min(Math.min(ay, by), 1 - h)
  return { x: Math.max(x, 0), y: Math.max(y, 0), w, h }
}

// A rectangle from an anchor the coach is NOT holding and a corner they are.
//
// THE ANCHOR NEVER MOVES, and that is the whole point. A drag is a stream of
// resize actions, and each one re-derives the anchor from the CURRENT
// rectangle. With a sorting rule (rectFrom) the moment the finger passed the
// fixed corner the rectangle flipped, the anchor became wherever the finger
// was, and every later step dragged against the new anchor: the zone collapsed
// to its minimum and walked away from where it started. One action at a time
// looked perfectly correct, which is why single-action tests never saw it.
//
// So the dragged corner is CLAMPED to stay on its own side of the anchor rather
// than being allowed past it. Dragging the bottom right handle up past the top
// left stops at the minimum size instead of flipping the rectangle, which is
// also the behaviour anyone expects from a resize handle.
function rectFromAnchor(
  anchorX: number,
  anchorY: number,
  cornerX: number,
  cornerY: number,
  towardsOrigin: boolean,
): Pick<ZoneElement, 'x' | 'y' | 'w' | 'h'> {
  const limit = (anchor: number, corner: number) =>
    towardsOrigin ? Math.min(corner, anchor - MIN_ZONE_SIZE) : Math.max(corner, anchor + MIN_ZONE_SIZE)
  const cx = limit(anchorX, cornerX)
  const cy = limit(anchorY, cornerY)
  const x = Math.max(Math.min(anchorX, cx), 0)
  const y = Math.max(Math.min(anchorY, cy), 0)
  return {
    x,
    y,
    w: Math.min(Math.abs(cx - anchorX), 1 - x),
    h: Math.min(Math.abs(cy - anchorY), 1 - y),
  }
}

function newElement(type: DiagramElementType, id: string, x: number, y: number): DiagramElement {
  switch (type) {
    case 'player':
      return { type: 'player', id, x, y, colour: 'blue', label: '' }
    case 'cone':
      // Orange by default: a cone on a training pitch is orange, so the first
      // one a coach places already looks like the thing it is.
      return { type: 'cone', id, x, y, colour: 'orange' }
    case 'ball':
      return { type: 'ball', id, x, y }
    case 'goal':
      return { type: 'goal', id, x, y, width: NEW_GOAL_WIDTH, facing: 'up' }
    case 'arrow':
      // Born with two distinct ends, so it reads as an arrow before it is
      // touched. The offsets are wider than the clamp can close, so the two
      // ends can never land on the same point in a corner.
      return {
        type: 'arrow',
        id,
        x1: clampFraction(x - NEW_ARROW_DX),
        y1: clampFraction(y + NEW_ARROW_DY),
        x2: clampFraction(x + NEW_ARROW_DX),
        y2: clampFraction(y - NEW_ARROW_DY),
        arrow: 'run',
      }
    case 'zone':
      return { type: 'zone', id, ...rectFrom(x - NEW_ZONE / 2, y - NEW_ZONE / 2, x + NEW_ZONE / 2, y + NEW_ZONE / 2), colour: 'yellow' }
    case 'text':
      // Never born empty: an empty label draws nothing, so it could not be
      // tapped back open, and the parser drops it on read.
      return { type: 'text', id, x, y, text: NEW_TEXT }
  }
}

export function editorReducer(state: DiagramEditorState, action: DiagramAction): DiagramEditorState {
  switch (action.op) {
    case 'add': {
      if (!canAddElement(state)) return state
      const id = nextElementId(action.element, state.diagram.elements)
      const el = newElement(action.element, id, pt(action.at.x), pt(action.at.y))
      // Appended, so the newest element paints on top and the array order is
      // the draw order.
      return { ...withElements(state, [...state.diagram.elements, el]), selectedId: id }
    }

    case 'select': {
      // Moving off an emptied label removes it. The element is KEPT while it is
      // selected, so clearing the field before retyping does not delete it
      // mid-edit, and it is pruned the moment the coach moves on, because the
      // serialiser will not store one: without this a blank chip sat on the
      // canvas, the editor said Saved, and reopening the drill made it vanish.
      const pruned = state.diagram.elements.filter(
        (e) => e.type !== 'text' || e.text.trim() !== '' || e.id === action.id,
      )
      const elements = pruned.length === state.diagram.elements.length ? state.diagram.elements : pruned
      if (action.id === null) return { ...withElements(state, elements), selectedId: null }
      // An id that is not on the diagram selects nothing rather than becoming
      // a ghost selection the delete control would point at.
      const exists = elements.some((e) => e.id === action.id)
      return { ...withElements(state, elements), selectedId: exists ? action.id : null }
    }

    case 'move': {
      const x = pt(action.x)
      const y = pt(action.y)
      return mapElement(state, action.id, (el) => {
        switch (el.type) {
          case 'zone': {
            // A zone is dragged by its body, so the pointer is its centre.
            return { ...el, ...rectFrom(x - el.w / 2, y - el.h / 2, x + el.w / 2, y + el.h / 2) }
          }
          case 'arrow': {
            // The whole arrow travels: the vector is preserved exactly and the
            // shift is limited to what keeps both ends on the surface, so a
            // drag into a corner never shortens or bends it.
            const midX = (el.x1 + el.x2) / 2
            const midY = (el.y1 + el.y2) / 2
            const loX = Math.min(el.x1, el.x2)
            const hiX = Math.max(el.x1, el.x2)
            const loY = Math.min(el.y1, el.y2)
            const hiY = Math.max(el.y1, el.y2)
            const dx = Math.min(Math.max(x - midX, -loX), 1 - hiX)
            const dy = Math.min(Math.max(y - midY, -loY), 1 - hiY)
            return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy }
          }
          default:
            return { ...el, x, y }
        }
      })
    }

    case 'moveArrowEnd': {
      const x = pt(action.x)
      const y = pt(action.y)
      return mapElement(state, action.id, (el) => {
        if (el.type !== 'arrow') return el
        return action.end === 'start' ? { ...el, x1: x, y1: y } : { ...el, x2: x, y2: y }
      })
    }

    case 'resizeZone': {
      const x = pt(action.x)
      const y = pt(action.y)
      return mapElement(state, action.id, (el) => {
        if (el.type !== 'zone') return el
        // The corner the coach is NOT holding stays exactly where it is for the
        // whole drag. See rectFromAnchor for what happened when it did not.
        const start = action.corner === 'start'
        const anchorX = start ? el.x + el.w : el.x
        const anchorY = start ? el.y + el.h : el.y
        return { ...el, ...rectFromAnchor(anchorX, anchorY, x, y, start) }
      })
    }

    case 'delete':
      return deleteElement(state, action.id)

    case 'setColour':
      return mapElement(state, action.id, (el) => {
        // Only the three elements that carry a colour take one. A ball and a
        // goal are the objects they are.
        if (el.type === 'player' || el.type === 'cone' || el.type === 'zone') return { ...el, colour: action.colour }
        return el
      })

    case 'setLabel':
      return mapElement(state, action.id, (el) => {
        // NOT trimmed here. The field is controlled, so trimming on every
        // keystroke means the space key does nothing and "Press high" can only
        // be typed as "Presshigh". The serialiser trims instead, and BOTH sides
        // of the saved comparison go through it, so a trailing space in the
        // draft never leaves the editor unsaved for ever.
        if (el.type === 'text') {
          // An emptied label KEEPS its element. Clearing the field is what a
          // coach does first when they mean to retype it; deleting the element
          // there took the chip off the pitch, unmounted the selection bar and
          // closed the keyboard mid-edit. The serialiser is what declines to
          // store an empty one, and it does so on both sides of the comparison,
          // so an empty label on screen is simply a label that is not saved.
          return { ...el, text: action.text.slice(0, MAX_TEXT_LENGTH) }
        }
        if (el.type === 'player') {
          // A player's badge is optional; the disc is the element, so clearing
          // the badge never removes the player.
          return { ...el, label: action.text.slice(0, MAX_PLAYER_LABEL) }
        }
        return el
      })

    case 'setArrowKind':
      return mapElement(state, action.id, (el) => (el.type === 'arrow' ? { ...el, arrow: action.arrow } : el))

    case 'setGoalFacing':
      return mapElement(state, action.id, (el) => (el.type === 'goal' ? { ...el, facing: action.facing } : el))

    case 'setSurface':
      // Elements are untouched: their coordinates are fractions of whatever
      // surface is underneath, so changing the pitch cannot move or corrupt
      // anything drawn on it.
      return { ...state, diagram: { ...state.diagram, surface: { ...state.diagram.surface, kind: action.surface } } }

    case 'setOrientation':
      return { ...state, diagram: { ...state.diagram, surface: { ...state.diagram.surface, orientation: action.orientation } } }

    case 'saved':
      // Only the record of what the database holds moves. The diagram on
      // screen is never replaced, so an edit made while the save was in flight
      // survives and correctly leaves the editor dirty.
      return { ...state, savedSignature: action.signature }
  }
}
