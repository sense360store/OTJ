import { describe, expect, it } from 'vitest'
import {
  DRILL_DIAGRAM_VERSION,
  MAX_DIAGRAM_ELEMENTS,
  MAX_TEXT_LENGTH,
  MAX_PLAYER_LABEL,
  MIN_ZONE_SIZE,
  emptyDiagram,
  parseDrillDiagram,
  serializeDrillDiagram,
  diagramSignature,
  diagramIsEmpty,
  nextElementId,
  type DrillDiagram,
  type DiagramElement,
  type ArrowElement,
  type BallElement,
  type ConeElement,
  type GoalElement,
  type PlayerElement,
  type TextElement,
  type ZoneElement,
} from './drillDiagram'

// The model is the seam every other part of Drill Maker stands on: the editor
// mutates it, the renderer draws it, the save writes exactly what serialize
// returns and compares the readback with the same function. So the rules that
// matter are pinned here, not at the screen.

function diagram(elements: DiagramElement[], over: Partial<DrillDiagram> = {}): DrillDiagram {
  return { ...emptyDiagram(), elements, ...over }
}

const player = (id = 'player-1'): PlayerElement => ({ type: 'player', id, x: 0.5, y: 0.5, colour: 'blue', label: '' })
const cone = (id = 'cone-1'): ConeElement => ({ type: 'cone', id, x: 0.2, y: 0.3, colour: 'orange' })
const ball = (id = 'ball-1'): BallElement => ({ type: 'ball', id, x: 0.4, y: 0.6 })
const goal = (id = 'goal-1'): GoalElement => ({ type: 'goal', id, x: 0.5, y: 0.1, width: 0.24, facing: 'up' })
const arrow = (id = 'arrow-1'): ArrowElement => ({ type: 'arrow', id, x1: 0.1, y1: 0.1, x2: 0.6, y2: 0.7, arrow: 'pass' })
const zone = (id = 'zone-1'): ZoneElement => ({ type: 'zone', id, x: 0.1, y: 0.1, w: 0.4, h: 0.3, colour: 'yellow' })
const text = (id = 'text-1'): TextElement => ({ type: 'text', id, x: 0.5, y: 0.9, text: 'Press' })

const ALL_SEVEN: DiagramElement[] = [player(), cone(), ball(), goal(), arrow(), zone(), text()]

describe('the empty diagram', () => {
  it('is version 1 on a blank area with no elements', () => {
    // A new diagram opens on a blank area: most drills are a grid, a channel
    // or a box rather than a game on a full pitch, and a pitch is one tap away
    // from the surface selector.
    const d = emptyDiagram()
    expect(d.version).toBe(1)
    expect(DRILL_DIAGRAM_VERSION).toBe(1)
    expect(d.surface.kind).toBe('blank')
    expect(d.surface.orientation).toBe('portrait')
    expect(d.elements).toEqual([])
  })

  it('reports itself empty, and stops doing so once an element lands', () => {
    expect(diagramIsEmpty(emptyDiagram())).toBe(true)
    expect(diagramIsEmpty(diagram([cone()]))).toBe(false)
  })

  it('mints a fresh object each call, so two editors never share elements', () => {
    const a = emptyDiagram()
    a.elements.push(cone())
    expect(emptyDiagram().elements).toEqual([])
  })
})

describe('parsing a stored diagram', () => {
  it('reads back every one of the seven element types', () => {
    const parsed = parseDrillDiagram(serializeDrillDiagram(diagram(ALL_SEVEN)))
    expect(parsed?.elements.map((e) => e.type)).toEqual([
      'player',
      'cone',
      'ball',
      'goal',
      'arrow',
      'zone',
      'text',
    ])
  })

  it('treats null and undefined as no diagram at all, not as an error', () => {
    expect(parseDrillDiagram(null)).toBeNull()
    expect(parseDrillDiagram(undefined)).toBeNull()
  })

  it('reads an empty diagram back as an empty diagram, not as null', () => {
    const parsed = parseDrillDiagram(serializeDrillDiagram(emptyDiagram()))
    expect(parsed).not.toBeNull()
    expect(parsed!.elements).toEqual([])
  })

  it('refuses anything that is not an object', () => {
    for (const bad of ['{}', 42, true, [], [{ type: 'cone' }]]) {
      expect(parseDrillDiagram(bad)).toBeNull()
    }
  })

  it('refuses a version it does not implement, rather than guessing', () => {
    // A future shape read as version 1 would render wrongly and then be saved
    // back in the older shape, so an unknown version loses the whole diagram
    // deliberately. This is the ONE case where partial data is worse than none.
    expect(parseDrillDiagram({ version: 2, surface: { kind: 'blank' }, elements: [] })).toBeNull()
    expect(parseDrillDiagram({ version: 0, surface: { kind: 'blank' }, elements: [] })).toBeNull()
    expect(parseDrillDiagram({ surface: { kind: 'blank' }, elements: [] })).toBeNull()
    expect(parseDrillDiagram({ version: '1', surface: { kind: 'blank' }, elements: [] })).toBeNull()
  })

  it('refuses a diagram whose elements are not an array', () => {
    expect(parseDrillDiagram({ version: 1, surface: { kind: 'blank' }, elements: {} })).toBeNull()
    expect(parseDrillDiagram({ version: 1, surface: { kind: 'blank' } })).toBeNull()
  })

  it('falls back to a full pitch when the surface is missing or unknown', () => {
    // Deliberately NOT emptyDiagram's default. That one answers "what does a
    // coach start on"; this one answers "how was this row drawn", and a stored
    // diagram has to come back the way it was saved whatever the other moves
    // to. The two are asserted apart on purpose, so changing the new diagram
    // default can never quietly redraw work already in the column.
    const missing = parseDrillDiagram({ version: 1, elements: [] })
    expect(missing?.surface.kind).toBe('full_pitch')
    const unknown = parseDrillDiagram({ version: 1, surface: { kind: 'moon' }, elements: [] })
    expect(unknown?.surface.kind).toBe('full_pitch')
    expect(emptyDiagram().surface.kind).not.toBe('full_pitch')
  })

  it('reads a stored diagram back on the surface it was saved on', () => {
    // The acceptance rule for the change of default, stated as behaviour: a
    // diagram saved on a full pitch is still a full pitch after a read, and
    // nothing about it is rewritten on the way through.
    const stored = { version: 1, surface: { kind: 'full_pitch', orientation: 'landscape' }, elements: [cone()] }
    const parsed = parseDrillDiagram(stored)
    expect(parsed?.surface).toEqual({ kind: 'full_pitch', orientation: 'landscape' })
    expect(serializeDrillDiagram(parsed!)).toEqual(stored)
  })

  it('keeps each of the three surfaces and both orientations', () => {
    for (const kind of ['full_pitch', 'half_pitch', 'blank'] as const) {
      expect(parseDrillDiagram({ version: 1, surface: { kind, orientation: 'landscape' }, elements: [] })?.surface)
        .toEqual({ kind, orientation: 'landscape' })
    }
  })

  it('drops an element whose type it does not know, and keeps the rest', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank', orientation: 'portrait' },
      elements: [{ type: 'wormhole', id: 'w1', x: 0.5, y: 0.5 }, { type: 'cone', id: 'cone-1', x: 0.2, y: 0.3, colour: 'orange' }],
    })
    expect(parsed?.elements.map((e) => e.type)).toEqual(['cone'])
  })

  it('drops an element that is not an object', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [null, 'cone', 7, cone()],
    })
    expect(parsed?.elements).toHaveLength(1)
  })

  it('drops an element with no usable id', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'cone', x: 0.2, y: 0.2, colour: 'orange' }, { type: 'cone', id: '', x: 0.2, y: 0.2 }, cone()],
    })
    expect(parsed?.elements.map((e) => e.id)).toEqual(['cone-1'])
  })

  it('keeps the first of two elements sharing an id and drops the second', () => {
    // Two elements under one id would break selection, move and delete: the
    // reducer would act on whichever the search found first.
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ ...cone('dup'), x: 0.11 }, { ...ball('dup'), x: 0.99 }],
    })
    expect(parsed?.elements).toHaveLength(1)
    expect(parsed?.elements[0].type).toBe('cone')
  })

  it('drops an element whose coordinates are NaN or Infinity', () => {
    // A number that is not a number is corruption: there is no honest value to
    // clamp it to, so the element goes.
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [
        { ...cone('c1'), x: Number.NaN },
        { ...cone('c2'), y: Number.POSITIVE_INFINITY },
        { ...cone('c3'), x: Number.NEGATIVE_INFINITY },
        { ...ball('b1'), x: 'left' },
        cone('keep'),
      ],
    })
    expect(parsed?.elements.map((e) => e.id)).toEqual(['keep'])
  })

  it('clamps a coordinate below zero or above one instead of dropping it', () => {
    // Out of range is a stale value, not corruption, so it is pulled back onto
    // the surface. Losing the element would lose the coach's work.
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ ...cone('c1'), x: -3, y: 4 }],
    })
    const c = parsed!.elements[0] as Extract<DiagramElement, { type: 'cone' }>
    expect(c.x).toBe(0)
    expect(c.y).toBe(1)
  })

  it('clamps both ends of an arrow', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'arrow', id: 'a1', x1: -1, y1: -1, x2: 9, y2: 9, arrow: 'run' }],
    })
    const a = parsed!.elements[0] as Extract<DiagramElement, { type: 'arrow' }>
    expect([a.x1, a.y1, a.x2, a.y2]).toEqual([0, 0, 1, 1])
  })

  it('drops an arrow missing an endpoint', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'arrow', id: 'a1', x1: 0.2, y1: 0.2, arrow: 'run' }, arrow('keep')],
    })
    expect(parsed?.elements.map((e) => e.id)).toEqual(['keep'])
  })

  it('falls back to a known arrow kind when the stored one is unknown', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'arrow', id: 'a1', x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.4, arrow: 'teleport' }],
    })
    expect((parsed!.elements[0] as Extract<DiagramElement, { type: 'arrow' }>).arrow).toBe('run')
  })

  it('grows a zone smaller than the minimum rather than storing a sliver', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'zone', id: 'z1', x: 0.4, y: 0.4, w: 0, h: -0.5, colour: 'yellow' }],
    })
    const z = parsed!.elements[0] as Extract<DiagramElement, { type: 'zone' }>
    expect(z.w).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
    expect(z.h).toBeGreaterThanOrEqual(MIN_ZONE_SIZE)
  })

  it('keeps a zone inside the surface after clamping its size', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'zone', id: 'z1', x: 0.9, y: 0.9, w: 0.8, h: 0.8, colour: 'yellow' }],
    })
    const z = parsed!.elements[0] as Extract<DiagramElement, { type: 'zone' }>
    expect(z.x + z.w).toBeLessThanOrEqual(1)
    expect(z.y + z.h).toBeLessThanOrEqual(1)
    expect(z.x).toBeGreaterThanOrEqual(0)
    expect(z.y).toBeGreaterThanOrEqual(0)
  })

  it('never returns an inverted zone', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'zone', id: 'z1', x: 0.6, y: 0.6, w: -0.4, h: -0.4, colour: 'yellow' }],
    })
    const z = parsed!.elements[0] as Extract<DiagramElement, { type: 'zone' }>
    expect(z.w).toBeGreaterThan(0)
    expect(z.h).toBeGreaterThan(0)
  })

  it('truncates the stored text to the maximum length', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'text', id: 't1', x: 0.5, y: 0.5, text: 'x'.repeat(500) }],
    })
    expect((parsed!.elements[0] as Extract<DiagramElement, { type: 'text' }>).text).toHaveLength(MAX_TEXT_LENGTH)
  })

  it('drops a text element with nothing to say', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'text', id: 't1', x: 0.5, y: 0.5, text: '   ' }, text('keep')],
    })
    expect(parsed?.elements.map((e) => e.id)).toEqual(['keep'])
  })

  it('truncates a player label to the short badge length', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'player', id: 'p1', x: 0.5, y: 0.5, colour: 'blue', label: 'Archibald' }],
    })
    expect((parsed!.elements[0] as Extract<DiagramElement, { type: 'player' }>).label).toHaveLength(MAX_PLAYER_LABEL)
  })

  it('falls back to a known colour when the stored one is unknown', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank' },
      elements: [{ type: 'player', id: 'p1', x: 0.5, y: 0.5, colour: 'chartreuse' }],
    })
    expect((parsed!.elements[0] as Extract<DiagramElement, { type: 'player' }>).colour).toBe('blue')
  })

  it('keeps at most the maximum number of elements', () => {
    const many = Array.from({ length: MAX_DIAGRAM_ELEMENTS + 25 }, (_, i) => cone(`cone-${i}`))
    const parsed = parseDrillDiagram({ version: 1, surface: { kind: 'blank' }, elements: many })
    expect(parsed?.elements).toHaveLength(MAX_DIAGRAM_ELEMENTS)
  })

  it('mints the next id past every element already present, whatever the type', () => {
    // Ids are minted from the highest suffix across the WHOLE diagram, so a
    // delete followed by an add can never reissue a live id.
    expect(nextElementId('player', [])).toBe('player-1')
    expect(nextElementId('cone', [cone('cone-1'), ball('ball-7')])).toBe('cone-8')
    expect(nextElementId('zone', [text('text-40')])).toBe('zone-41')
  })

  it('mints an id that no element already carries, even from odd stored ids', () => {
    const odd: DiagramElement[] = [cone('imported'), ball('ball-')]
    const id = nextElementId('cone', odd)
    expect(odd.some((e) => e.id === id)).toBe(false)
  })
})

describe('the identity boundary', () => {
  // A drill is a reusable exercise, so no element may ever carry a person. The
  // parser rebuilds each element from an allow-list of known fields, so an
  // identity key cannot survive a read even if one reached the column.
  const IDENTITY_KEYS = [
    'playerId',
    'player_id',
    'spondMemberId',
    'spond_member_id',
    'memberId',
    'name',
    'displayName',
    'display_name',
    'guardian',
    'guardianName',
    'email',
    'phone',
    'address',
    'shirtNumber',
  ]

  it('strips every identity-shaped key from every element type on read', () => {
    const contaminated = ALL_SEVEN.map((e) => {
      const extra: Record<string, unknown> = {}
      for (const k of IDENTITY_KEYS) extra[k] = 'Jamie Smith'
      return { ...e, ...extra }
    })
    const parsed = parseDrillDiagram({ version: 1, surface: { kind: 'blank' }, elements: contaminated })
    const json = JSON.stringify(parsed)
    for (const k of IDENTITY_KEYS) expect(json).not.toContain(k)
    expect(json).not.toContain('Jamie Smith')
    expect(parsed?.elements).toHaveLength(7)
  })

  it('strips an identity key on the way back out through serialize', () => {
    const sneaky = { ...player(), playerId: 'abc', name: 'Jamie' } as unknown as DiagramElement
    const json = JSON.stringify(serializeDrillDiagram(diagram([sneaky])))
    expect(json).not.toContain('playerId')
    expect(json).not.toContain('Jamie')
  })

  it('strips unknown keys from the diagram itself, not only its elements', () => {
    const parsed = parseDrillDiagram({
      version: 1,
      surface: { kind: 'blank', teamId: 't1' },
      elements: [],
      clubId: 'c1',
      roster: ['Jamie'],
    })
    const json = JSON.stringify(parsed)
    expect(json).not.toContain('roster')
    expect(json).not.toContain('clubId')
    expect(json).not.toContain('teamId')
  })
})

describe('serializing a diagram', () => {
  it('writes only the allow-listed keys for each element type', () => {
    const stored = serializeDrillDiagram(diagram(ALL_SEVEN)) as unknown as {
      elements: Record<string, unknown>[]
    }
    const keysByType: Record<string, string[]> = {
      player: ['type', 'id', 'x', 'y', 'colour', 'label'],
      cone: ['type', 'id', 'x', 'y', 'colour'],
      ball: ['type', 'id', 'x', 'y'],
      goal: ['type', 'id', 'x', 'y', 'width', 'facing'],
      arrow: ['type', 'id', 'x1', 'y1', 'x2', 'y2', 'arrow'],
      zone: ['type', 'id', 'x', 'y', 'w', 'h', 'colour'],
      text: ['type', 'id', 'x', 'y', 'text'],
    }
    for (const el of stored.elements) {
      const allowed = keysByType[el.type as string]
      expect(allowed, `unknown stored type ${el.type}`).toBeTruthy()
      expect(Object.keys(el).sort()).toEqual([...allowed].sort())
    }
  })

  it('writes only the three top-level keys', () => {
    const stored = serializeDrillDiagram(diagram(ALL_SEVEN)) as unknown as Record<string, unknown>
    expect(Object.keys(stored).sort()).toEqual(['elements', 'surface', 'version'])
    expect(Object.keys(stored.surface as object).sort()).toEqual(['kind', 'orientation'])
  })

  it('drops a label with nothing in it, so the readback can always match', () => {
    const stored = serializeDrillDiagram(
      diagram([{ type: 'text', id: 't1', x: 0.5, y: 0.5, text: '  ' }, text('keep')]),
    ) as unknown as { elements: { id: string }[] }
    expect(stored.elements.map((e) => e.id)).toEqual(['keep'])
  })

  it('does not mutate the diagram it is given', () => {
    const d = diagram(ALL_SEVEN)
    const before = JSON.stringify(d)
    serializeDrillDiagram(d)
    expect(JSON.stringify(d)).toBe(before)
  })

  it('round trips a diagram unchanged, in one deterministic form', () => {
    const d = diagram(ALL_SEVEN, { surface: { kind: 'half_pitch', orientation: 'landscape' } })
    const once = serializeDrillDiagram(d)
    const twice = serializeDrillDiagram(parseDrillDiagram(once)!)
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
  })

  it('is stable under a third pass, so a save after a load never looks dirty', () => {
    const once = serializeDrillDiagram(diagram(ALL_SEVEN))
    const twice = serializeDrillDiagram(parseDrillDiagram(once)!)
    const thrice = serializeDrillDiagram(parseDrillDiagram(twice)!)
    expect(JSON.stringify(thrice)).toBe(JSON.stringify(twice))
  })

  it('rounds a coordinate to a fixed precision so a float never reads as a change', () => {
    const d = diagram([{ ...cone('c1'), x: 0.1 + 0.2, y: 1 / 3 }])
    const stored = serializeDrillDiagram(d) as unknown as { elements: { x: number; y: number }[] }
    expect(stored.elements[0].x).toBe(0.3)
    expect(String(stored.elements[0].y).length).toBeLessThanOrEqual(6)
  })

  it('never stores a pixel: every coordinate stays inside zero to one', () => {
    const stored = serializeDrillDiagram(diagram(ALL_SEVEN)) as unknown as {
      elements: Record<string, unknown>[]
    }
    for (const el of stored.elements) {
      for (const [k, v] of Object.entries(el)) {
        if (typeof v !== 'number') continue
        expect(v, `${el.type}.${k} is outside 0..1`).toBeGreaterThanOrEqual(0)
        expect(v, `${el.type}.${k} is outside 0..1`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('the diagram signature', () => {
  it('matches two diagrams that differ only by object identity', () => {
    expect(diagramSignature(diagram(ALL_SEVEN))).toBe(diagramSignature(diagram(ALL_SEVEN.map((e) => ({ ...e })))))
  })

  it('differs when an element moves', () => {
    const a = diagram([cone('c1')])
    const b = diagram([{ ...cone('c1'), x: 0.9 }])
    expect(diagramSignature(a)).not.toBe(diagramSignature(b))
  })

  it('differs when the surface changes', () => {
    const a = diagram([], { surface: { kind: 'full_pitch', orientation: 'portrait' } })
    const b = diagram([], { surface: { kind: 'half_pitch', orientation: 'portrait' } })
    expect(diagramSignature(a)).not.toBe(diagramSignature(b))
  })

  it('differs when element order changes, because order is draw order', () => {
    expect(diagramSignature(diagram([cone('c1'), ball('b1')]))).not.toBe(
      diagramSignature(diagram([ball('b1'), cone('c1')])),
    )
  })

  it('matches a diagram against its own stored readback', () => {
    const d = diagram(ALL_SEVEN)
    const readback = parseDrillDiagram(serializeDrillDiagram(d))!
    expect(diagramSignature(readback)).toBe(diagramSignature(d))
  })
})
