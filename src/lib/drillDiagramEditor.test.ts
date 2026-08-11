import { describe, expect, it } from 'vitest'
import {
  initEditor,
  editorReducer,
  isDirty,
  selectedElement,
  canAddElement,
  type DiagramEditorState,
  type DiagramAction,
} from './drillDiagramEditor'
import {
  MAX_DIAGRAM_ELEMENTS,
  MAX_PLAYER_LABEL,
  MAX_TEXT_LENGTH,
  MIN_ZONE_SIZE,
  diagramSignature,
  emptyDiagram,
  parseDrillDiagram,
  serializeDrillDiagram,
  type ArrowElement,
  type DiagramElement,
  type DrillDiagram,
  type GoalElement,
  type PlayerElement,
  type TextElement,
  type ZoneElement,
} from './drillDiagram'

// The reducer is where every geometry change happens. It is pure, so a drag, a
// resize and an arrow endpoint edit are all provable without a DOM, which this
// project does not have under test.

function run(state: DiagramEditorState, ...actions: DiagramAction[]): DiagramEditorState {
  return actions.reduce(editorReducer, state)
}

function fresh(): DiagramEditorState {
  return initEditor(null)
}

function withOne(type: DiagramElement['type'], at = { x: 0.5, y: 0.5 }): DiagramEditorState {
  return run(fresh(), { op: 'add', element: type, at })
}

const only = (s: DiagramEditorState) => s.diagram.elements[0]

describe('starting the editor', () => {
  it('opens clean on a drill with no diagram', () => {
    const s = fresh()
    expect(s.diagram.elements).toEqual([])
    expect(s.selectedId).toBeNull()
    expect(isDirty(s)).toBe(false)
  })

  it('opens clean on a drill that already has one', () => {
    const stored: DrillDiagram = { ...emptyDiagram(), elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.2, colour: 'orange' }] }
    const s = initEditor(stored)
    expect(s.diagram.elements).toHaveLength(1)
    expect(isDirty(s)).toBe(false)
  })

  it('opens clean on a diagram loaded straight from storage, so nothing looks unsaved on arrival', () => {
    const stored = parseDrillDiagram(
      serializeDrillDiagram({ ...emptyDiagram(), elements: [{ type: 'ball', id: 'ball-1', x: 1 / 3, y: 2 / 3 }] }),
    )
    expect(isDirty(initEditor(stored))).toBe(false)
  })
})

describe('adding an element', () => {
  it('adds each of the seven types, selected and dirty', () => {
    for (const type of ['player', 'cone', 'ball', 'goal', 'arrow', 'zone', 'text'] as const) {
      const s = withOne(type)
      expect(s.diagram.elements).toHaveLength(1)
      expect(only(s).type).toBe(type)
      expect(s.selectedId).toBe(only(s).id)
      expect(isDirty(s)).toBe(true)
    }
  })

  it('places the new element where the coach tapped', () => {
    const s = withOne('cone', { x: 0.25, y: 0.75 })
    expect(only(s)).toMatchObject({ x: 0.25, y: 0.75 })
  })

  it('clamps a tap outside the surface onto it', () => {
    const s = withOne('cone', { x: -0.5, y: 2 })
    expect(only(s)).toMatchObject({ x: 0, y: 1 })
  })

  it('gives a new arrow two distinct endpoints, so it has a direction from birth', () => {
    const a = only(withOne('arrow', { x: 0.5, y: 0.5 })) as ArrowElement
    expect(a.x1 === a.x2 && a.y1 === a.y2).toBe(false)
  })

  it('gives a new arrow endpoints that are already on the surface', () => {
    const a = only(withOne('arrow', { x: 0.02, y: 0.98 })) as ArrowElement
    for (const n of [a.x1, a.y1, a.x2, a.y2]) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(1)
    }
  })

  it('gives a new zone a grabbable size that sits on the surface', () => {
    const z = only(withOne('zone', { x: 0.95, y: 0.95 })) as ZoneElement
    expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.h).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.x + z.w).toBeLessThanOrEqual(1)
    expect(z.y + z.h).toBeLessThanOrEqual(1)
  })

  it('gives a new label placeholder text, so an empty label never persists', () => {
    const t = only(withOne('text')) as TextElement
    expect(t.text.length).toBeGreaterThan(0)
  })

  it('gives every element a distinct id, however many are added', () => {
    let s = fresh()
    for (let i = 0; i < 12; i++) s = run(s, { op: 'add', element: 'cone', at: { x: 0.1, y: 0.1 } })
    expect(new Set(s.diagram.elements.map((e) => e.id)).size).toBe(12)
  })

  it('never reissues the id of a live element after a delete', () => {
    // The failure an array index walks into: delete the middle, add, collide.
    let s = fresh()
    for (let i = 0; i < 3; i++) s = run(s, { op: 'add', element: 'cone', at: { x: 0.1, y: 0.1 } })
    const middle = s.diagram.elements[1].id
    s = run(s, { op: 'delete', id: middle }, { op: 'add', element: 'ball', at: { x: 0.4, y: 0.4 } })
    expect(new Set(s.diagram.elements.map((e) => e.id)).size).toBe(s.diagram.elements.length)
  })

  it('adds on top, so draw order follows the order the coach placed things', () => {
    const s = run(fresh(), { op: 'add', element: 'zone', at: { x: 0.2, y: 0.2 } }, { op: 'add', element: 'player', at: { x: 0.3, y: 0.3 } })
    expect(s.diagram.elements.map((e) => e.type)).toEqual(['zone', 'player'])
  })

  it('refuses to add past the element limit and leaves the diagram exactly as it was', () => {
    let s = fresh()
    for (let i = 0; i < MAX_DIAGRAM_ELEMENTS; i++) s = run(s, { op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    expect(canAddElement(s)).toBe(false)
    const before = diagramSignature(s.diagram)
    const after = run(s, { op: 'add', element: 'cone', at: { x: 0.5, y: 0.5 } })
    expect(after.diagram.elements).toHaveLength(MAX_DIAGRAM_ELEMENTS)
    expect(diagramSignature(after.diagram)).toBe(before)
  })

  it('says there is room while the diagram is under the limit', () => {
    expect(canAddElement(fresh())).toBe(true)
  })
})

describe('selection', () => {
  it('selects an element that exists', () => {
    const s = run(withOne('cone'), { op: 'select', id: null })
    const id = only(s).id
    expect(run(s, { op: 'select', id }).selectedId).toBe(id)
  })

  it('resolves the selected element, and nothing when there is no selection', () => {
    const s = withOne('goal')
    expect(selectedElement(s)?.type).toBe('goal')
    expect(selectedElement(run(s, { op: 'select', id: null }))).toBeNull()
  })

  it('clears the selection on a tap in empty space', () => {
    expect(run(withOne('cone'), { op: 'select', id: null }).selectedId).toBeNull()
  })

  it('refuses to select an id that is not on the diagram, rather than holding a ghost', () => {
    expect(run(withOne('cone'), { op: 'select', id: 'cone-999' }).selectedId).toBeNull()
  })

  it('does not make the diagram dirty', () => {
    const s = initEditor({ ...emptyDiagram(), elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.2, colour: 'orange' }] })
    expect(isDirty(run(s, { op: 'select', id: 'cone-1' }, { op: 'select', id: null }))).toBe(false)
  })

  it('survives the element being moved', () => {
    const s = withOne('cone')
    const id = only(s).id
    expect(run(s, { op: 'move', id, x: 0.9, y: 0.9 }).selectedId).toBe(id)
  })

  it('is cleared when the selected element is deleted, so no action lands on a ghost', () => {
    const s = withOne('cone')
    expect(run(s, { op: 'delete', id: only(s).id }).selectedId).toBeNull()
  })

  it('is kept when a different element is deleted', () => {
    let s = run(fresh(), { op: 'add', element: 'cone', at: { x: 0.1, y: 0.1 } })
    const first = only(s).id
    s = run(s, { op: 'add', element: 'ball', at: { x: 0.4, y: 0.4 } }, { op: 'select', id: first })
    const second = s.diagram.elements[1].id
    expect(run(s, { op: 'delete', id: second }).selectedId).toBe(first)
  })
})

describe('moving an element', () => {
  it('moves a player to where the finger went', () => {
    const s = withOne('player')
    const moved = run(s, { op: 'move', id: only(s).id, x: 0.8, y: 0.2 })
    expect(only(moved)).toMatchObject({ x: 0.8, y: 0.2 })
  })

  it('clamps a drag past the edge back onto the surface', () => {
    const s = withOne('cone')
    const moved = run(s, { op: 'move', id: only(s).id, x: 5, y: -5 })
    expect(only(moved)).toMatchObject({ x: 1, y: 0 })
  })

  it('never produces a coordinate that is not a number', () => {
    const s = withOne('cone')
    const moved = run(s, { op: 'move', id: only(s).id, x: Number.NaN, y: Number.POSITIVE_INFINITY })
    const c = only(moved) as { x: number; y: number }
    expect(Number.isFinite(c.x)).toBe(true)
    expect(Number.isFinite(c.y)).toBe(true)
  })

  it('keeps the element identity, so a drag moves rather than duplicates', () => {
    const s = withOne('cone')
    const id = only(s).id
    const moved = run(s, { op: 'move', id, x: 0.1, y: 0.1 }, { op: 'move', id, x: 0.2, y: 0.2 })
    expect(moved.diagram.elements).toHaveLength(1)
    expect(only(moved).id).toBe(id)
  })

  it('leaves every other element untouched', () => {
    let s = run(fresh(), { op: 'add', element: 'cone', at: { x: 0.1, y: 0.1 } }, { op: 'add', element: 'ball', at: { x: 0.4, y: 0.4 } })
    const ballBefore = JSON.stringify(s.diagram.elements[1])
    s = run(s, { op: 'move', id: s.diagram.elements[0].id, x: 0.9, y: 0.9 })
    expect(JSON.stringify(s.diagram.elements[1])).toBe(ballBefore)
  })

  it('ignores a move aimed at an id that is not there, and does not dirty the diagram', () => {
    const s = initEditor({ ...emptyDiagram(), elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.2, colour: 'orange' }] })
    const after = run(s, { op: 'move', id: 'nope', x: 0.9, y: 0.9 })
    expect(isDirty(after)).toBe(false)
  })

  it('moves a zone by its centre and keeps it wholly on the surface', () => {
    const s = withOne('zone', { x: 0.5, y: 0.5 })
    const z = only(run(s, { op: 'move', id: only(s).id, x: 0.99, y: 0.99 })) as ZoneElement
    expect(z.x + z.w).toBeLessThanOrEqual(1)
    expect(z.y + z.h).toBeLessThanOrEqual(1)
    expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
  })

  it('moves an arrow whole, keeping its length and direction', () => {
    const s = withOne('arrow', { x: 0.5, y: 0.5 })
    const before = only(s) as ArrowElement
    const dx = before.x2 - before.x1
    const dy = before.y2 - before.y1
    const after = only(run(s, { op: 'move', id: before.id, x: 0.3, y: 0.4 })) as ArrowElement
    expect(after.x2 - after.x1).toBeCloseTo(dx, 6)
    expect(after.y2 - after.y1).toBeCloseTo(dy, 6)
  })

  it('keeps both arrow endpoints on the surface when it is dragged into a corner', () => {
    const s = withOne('arrow', { x: 0.5, y: 0.5 })
    const a = only(run(s, { op: 'move', id: only(s).id, x: 1.4, y: -0.4 })) as ArrowElement
    for (const n of [a.x1, a.y1, a.x2, a.y2]) {
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(1)
    }
  })
})

describe('editing an arrow', () => {
  it('moves the start point alone', () => {
    const s = withOne('arrow')
    const before = only(s) as ArrowElement
    const a = only(run(s, { op: 'moveArrowEnd', id: before.id, end: 'start', x: 0.1, y: 0.1 })) as ArrowElement
    expect([a.x1, a.y1]).toEqual([0.1, 0.1])
    expect([a.x2, a.y2]).toEqual([before.x2, before.y2])
  })

  it('moves the end point alone', () => {
    const s = withOne('arrow')
    const before = only(s) as ArrowElement
    const a = only(run(s, { op: 'moveArrowEnd', id: before.id, end: 'end', x: 0.9, y: 0.9 })) as ArrowElement
    expect([a.x2, a.y2]).toEqual([0.9, 0.9])
    expect([a.x1, a.y1]).toEqual([before.x1, before.y1])
  })

  it('clamps an endpoint dragged off the surface', () => {
    const s = withOne('arrow')
    const a = only(run(s, { op: 'moveArrowEnd', id: only(s).id, end: 'end', x: 3, y: -3 })) as ArrowElement
    expect([a.x2, a.y2]).toEqual([1, 0])
  })

  it('never lets an endpoint become NaN', () => {
    const s = withOne('arrow')
    const a = only(run(s, { op: 'moveArrowEnd', id: only(s).id, end: 'end', x: Number.NaN, y: Number.NaN })) as ArrowElement
    expect(Number.isFinite(a.x2) && Number.isFinite(a.y2)).toBe(true)
  })

  it('changes the arrow meaning without touching its geometry', () => {
    const s = withOne('arrow')
    const before = only(s) as ArrowElement
    const a = only(run(s, { op: 'setArrowKind', id: before.id, arrow: 'dribble' })) as ArrowElement
    expect(a.arrow).toBe('dribble')
    expect([a.x1, a.y1, a.x2, a.y2]).toEqual([before.x1, before.y1, before.x2, before.y2])
  })

  it('ignores an arrow edit aimed at something that is not an arrow', () => {
    const s = withOne('cone')
    const before = diagramSignature(s.diagram)
    expect(diagramSignature(run(s, { op: 'moveArrowEnd', id: only(s).id, end: 'end', x: 0.9, y: 0.9 }).diagram)).toBe(before)
  })
})

describe('resizing a zone', () => {
  function zoneState() {
    let s = withOne('zone', { x: 0.5, y: 0.5 })
    const id = only(s).id
    // Start from a known rectangle so the corner maths is readable.
    s = run(s, { op: 'resizeZone', id, corner: 'start', x: 0.2, y: 0.2 }, { op: 'resizeZone', id, corner: 'end', x: 0.7, y: 0.6 })
    return { s, id }
  }

  it('drags the far corner out', () => {
    const { s } = zoneState()
    const z = only(s) as ZoneElement
    expect(z.x).toBeCloseTo(0.2, 6)
    expect(z.y).toBeCloseTo(0.2, 6)
    expect(z.w).toBeCloseTo(0.5, 6)
    expect(z.h).toBeCloseTo(0.4, 6)
  })

  it('drags the near corner in, moving the origin', () => {
    const { s, id } = zoneState()
    const z = only(run(s, { op: 'resizeZone', id, corner: 'start', x: 0.4, y: 0.3 })) as ZoneElement
    expect(z.x).toBeCloseTo(0.4, 6)
    expect(z.y).toBeCloseTo(0.3, 6)
    expect(z.x + z.w).toBeCloseTo(0.7, 6)
    expect(z.y + z.h).toBeCloseTo(0.6, 6)
  })

  it('never inverts when a corner is dragged past the other one', () => {
    const { s, id } = zoneState()
    const z = only(run(s, { op: 'resizeZone', id, corner: 'end', x: 0.05, y: 0.02 })) as ZoneElement
    expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.h).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.x).toBeGreaterThanOrEqual(0)
    expect(z.y).toBeGreaterThanOrEqual(0)
  })

  it('never collapses a zone to nothing', () => {
    const { s, id } = zoneState()
    const z = only(run(s, { op: 'resizeZone', id, corner: 'end', x: 0.2, y: 0.2 })) as ZoneElement
    expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.h).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
  })

  it('keeps the zone on the surface when a corner is dragged off it', () => {
    const { s, id } = zoneState()
    const z = only(run(s, { op: 'resizeZone', id, corner: 'end', x: 4, y: 4 })) as ZoneElement
    expect(z.x + z.w).toBeLessThanOrEqual(1)
    expect(z.y + z.h).toBeLessThanOrEqual(1)
  })

  it('ignores a resize aimed at something that is not a zone', () => {
    const s = withOne('cone')
    const before = diagramSignature(s.diagram)
    expect(diagramSignature(run(s, { op: 'resizeZone', id: only(s).id, corner: 'end', x: 0.9, y: 0.9 }).diagram)).toBe(before)
  })
})

describe('deleting', () => {
  it('removes the element and nothing else', () => {
    let s = run(fresh(), { op: 'add', element: 'cone', at: { x: 0.1, y: 0.1 } }, { op: 'add', element: 'ball', at: { x: 0.4, y: 0.4 } })
    s = run(s, { op: 'delete', id: s.diagram.elements[0].id })
    expect(s.diagram.elements.map((e) => e.type)).toEqual(['ball'])
  })

  it('ignores an id that is not there and leaves the diagram clean', () => {
    const s = initEditor({ ...emptyDiagram(), elements: [{ type: 'ball', id: 'ball-1', x: 0.2, y: 0.2 }] })
    const after = run(s, { op: 'delete', id: 'ball-9' })
    expect(after.diagram.elements).toHaveLength(1)
    expect(isDirty(after)).toBe(false)
  })
})

describe('editing text and colour', () => {
  it('edits a coaching label', () => {
    const s = withOne('text')
    expect((only(run(s, { op: 'setLabel', id: only(s).id, text: 'Press' })) as TextElement).text).toBe('Press')
  })

  it('caps a coaching label at the maximum length', () => {
    const s = withOne('text')
    const t = only(run(s, { op: 'setLabel', id: only(s).id, text: 'x'.repeat(200) })) as TextElement
    expect(t.text).toHaveLength(MAX_TEXT_LENGTH)
  })

  it('removes a label the coach has emptied, so no invisible element is stored', () => {
    // The parser drops an empty label on read. If the reducer kept one the
    // screen would stay Unsaved for ever, because the readback could never
    // match what was sent.
    const s = withOne('text')
    const after = run(s, { op: 'setLabel', id: only(s).id, text: '   ' })
    expect(after.diagram.elements).toHaveLength(0)
    expect(after.selectedId).toBeNull()
  })

  it('caps a player badge much shorter than a coaching label', () => {
    const s = withOne('player')
    const p = only(run(s, { op: 'setLabel', id: only(s).id, text: 'Jonathan' })) as PlayerElement
    expect(p.label).toHaveLength(MAX_PLAYER_LABEL)
  })

  it('keeps a player whose badge is cleared, because the disc is the element', () => {
    const s = withOne('player')
    const after = run(s, { op: 'setLabel', id: only(s).id, text: '' })
    expect(after.diagram.elements).toHaveLength(1)
    expect((only(after) as PlayerElement).label).toBe('')
  })

  it('changes the colour of a player, a cone and a zone', () => {
    for (const type of ['player', 'cone', 'zone'] as const) {
      const s = withOne(type)
      const after = only(run(s, { op: 'setColour', id: only(s).id, colour: 'red' })) as { colour: string }
      expect(after.colour).toBe('red')
    }
  })

  it('ignores a colour change on an element that has no colour', () => {
    const s = withOne('ball')
    const before = diagramSignature(s.diagram)
    expect(diagramSignature(run(s, { op: 'setColour', id: only(s).id, colour: 'red' }).diagram)).toBe(before)
  })

  it('turns a goal to face another way', () => {
    const s = withOne('goal')
    expect((only(run(s, { op: 'setGoalFacing', id: only(s).id, facing: 'left' })) as GoalElement).facing).toBe('left')
  })
})

describe('switching the surface', () => {
  it('changes the pitch under the drill', () => {
    const s = run(fresh(), { op: 'setSurface', surface: 'half_pitch' })
    expect(s.diagram.surface.kind).toBe('half_pitch')
    expect(isDirty(s)).toBe(true)
  })

  it('turns the surface without changing what is on it', () => {
    const s = run(withOne('cone', { x: 0.3, y: 0.7 }), { op: 'setOrientation', orientation: 'landscape' })
    expect(s.diagram.surface.orientation).toBe('landscape')
    expect(only(s)).toMatchObject({ x: 0.3, y: 0.7 })
  })

  it('leaves every element exactly where it was, because coordinates are fractions', () => {
    let s = fresh()
    for (const type of ['player', 'cone', 'ball', 'goal', 'arrow', 'zone', 'text'] as const) {
      s = run(s, { op: 'add', element: type, at: { x: 0.4, y: 0.6 } })
    }
    const before = JSON.stringify(s.diagram.elements)
    const after = run(s, { op: 'setSurface', surface: 'blank' }, { op: 'setOrientation', orientation: 'landscape' })
    expect(JSON.stringify(after.diagram.elements)).toBe(before)
  })

  it('keeps the selection through a surface switch', () => {
    const s = withOne('cone')
    expect(run(s, { op: 'setSurface', surface: 'blank' }).selectedId).toBe(only(s).id)
  })
})

describe('saving', () => {
  it('is dirty from the first change and clean once that exact diagram is confirmed stored', () => {
    const s = withOne('cone')
    expect(isDirty(s)).toBe(true)
    const saved = run(s, { op: 'saved', signature: diagramSignature(s.diagram) })
    expect(isDirty(saved)).toBe(false)
  })

  it('stays dirty when the confirmed diagram is not the one on screen', () => {
    // A readback that differs from what was sent must never read as Saved.
    const s = withOne('cone')
    const saved = run(s, { op: 'saved', signature: diagramSignature(emptyDiagram()) })
    expect(isDirty(saved)).toBe(true)
  })

  it('keeps an edit made while the save was in flight, and stays dirty for it', () => {
    const s = withOne('cone')
    const submitted = diagramSignature(s.diagram)
    // The coach adds a ball before the readback lands.
    const during = run(s, { op: 'add', element: 'ball', at: { x: 0.2, y: 0.2 } })
    const after = run(during, { op: 'saved', signature: submitted })
    expect(after.diagram.elements).toHaveLength(2)
    expect(isDirty(after)).toBe(true)
  })

  it('goes clean on the second save, which stores the later edit', () => {
    const s = withOne('cone')
    const submitted = diagramSignature(s.diagram)
    const during = run(s, { op: 'add', element: 'ball', at: { x: 0.2, y: 0.2 } })
    const after = run(during, { op: 'saved', signature: submitted })
    const second = run(after, { op: 'saved', signature: diagramSignature(after.diagram) })
    expect(isDirty(second)).toBe(false)
    expect(second.diagram.elements).toHaveLength(2)
  })

  it('never changes what is on screen when a save is confirmed', () => {
    const s = withOne('cone')
    const before = JSON.stringify(s.diagram)
    expect(JSON.stringify(run(s, { op: 'saved', signature: 'anything' }).diagram)).toBe(before)
  })

  it('is clean again when a change is undone by hand', () => {
    const s = initEditor({ ...emptyDiagram(), elements: [{ type: 'cone', id: 'cone-1', x: 0.2, y: 0.2, colour: 'orange' }] })
    const moved = run(s, { op: 'move', id: 'cone-1', x: 0.8, y: 0.8 })
    expect(isDirty(moved)).toBe(true)
    expect(isDirty(run(moved, { op: 'move', id: 'cone-1', x: 0.2, y: 0.2 }))).toBe(false)
  })
})

describe('the reducer is pure', () => {
  it('never mutates the state it is given', () => {
    const s = withOne('cone')
    const snapshot = JSON.stringify(s)
    run(s, { op: 'move', id: only(s).id, x: 0.9, y: 0.9 }, { op: 'delete', id: only(s).id })
    expect(JSON.stringify(s)).toBe(snapshot)
  })

  it('produces a diagram that always survives a storage round trip unchanged', () => {
    let s = fresh()
    for (const type of ['player', 'cone', 'ball', 'goal', 'arrow', 'zone', 'text'] as const) {
      s = run(s, { op: 'add', element: type, at: { x: 0.37, y: 0.63 } })
    }
    const stored = serializeDrillDiagram(s.diagram)
    expect(diagramSignature(parseDrillDiagram(stored))).toBe(diagramSignature(s.diagram))
  })
})
