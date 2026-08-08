import { describe, expect, it } from 'vitest'
import {
  AREA_MAX_METRES,
  AREA_MIN_METRES,
  areaFits,
  areaFitScale,
  LAYOUT_ENTITY_KINDS,
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_ARROWS_PER_FRAME,
  LAYOUT_MAX_ENTITIES_PER_FRAME,
  LAYOUT_MAX_FRAMES,
  LAYOUT_MAX_ZONES_PER_FRAME,
  LAYOUT_NOTE_MAX,
  LAYOUT_ZONE_LABEL_MAX,
  layoutEntityCounts,
  layoutKitLines,
  layoutProblems,
  parseDrillLayout,
  type DrillLayout,
  type LayoutEntity,
} from './drillLayout'
import {
  FIXTURE_ONE_V_ONE,
  FIXTURE_PASSING_SQUARE,
  FIXTURE_SMALL_SIDED_GAME,
  LAYOUT_FIXTURES,
} from './drillLayoutFixtures'

// The layout model's validation and geometry. Every rule the editor and the
// stored jsonb rely on gets a failing case here; the fixtures are the
// passing cases and double as the renderer's examples. The database's
// drill_layout_ok (0047) mirrors only the outer shape rules (version, area
// bounds, frame and array caps), so those cases pin what both gates refuse.

const base = (): DrillLayout => structuredClone(FIXTURE_PASSING_SQUARE)

const entity = (id: string, over: Partial<LayoutEntity> = {}): LayoutEntity => ({
  id,
  kind: 'cone',
  x: 1,
  y: 1,
  ...over,
})

describe('layoutProblems on the fixtures', () => {
  it('every shipped fixture validates clean', () => {
    for (const fixture of LAYOUT_FIXTURES) {
      expect(layoutProblems(fixture)).toEqual([])
    }
  })

  it('a minimal empty layout validates clean', () => {
    expect(
      layoutProblems({ version: 1, area: { width: 10, length: 10 }, frames: [{ entities: [], zones: [], arrows: [] }] }),
    ).toEqual([])
  })
})

describe('layoutProblems outer shape (mirrored by drill_layout_ok)', () => {
  it('refuses non objects', () => {
    expect(layoutProblems(null)).toEqual(['The layout is not an object.'])
    expect(layoutProblems('layout')).toEqual(['The layout is not an object.'])
    expect(layoutProblems([1, 2])).toEqual(['The layout is not an object.'])
  })

  it('refuses a wrong version', () => {
    const layout = base() as unknown as Record<string, unknown>
    layout.version = 2
    expect(layoutProblems(layout)).toContain('The layout version is not 1.')
  })

  it('refuses an area outside the metre bounds or malformed', () => {
    const message = `The area needs a width and length between ${AREA_MIN_METRES} and ${AREA_MAX_METRES} metres.`
    for (const area of [
      undefined,
      'big',
      { width: AREA_MIN_METRES - 1, length: 10 },
      { width: 10, length: AREA_MAX_METRES + 1 },
      { width: Number.NaN, length: 10 },
      { width: 10 },
    ]) {
      const layout = base() as unknown as Record<string, unknown>
      layout.area = area
      expect(layoutProblems(layout)).toContain(message)
    }
  })

  it('requires one to four phases', () => {
    const message = `A layout holds 1 to ${LAYOUT_MAX_FRAMES} phases.`
    const none = base()
    none.frames = []
    expect(layoutProblems(none)).toEqual([message])
    const five = base()
    five.frames = Array.from({ length: LAYOUT_MAX_FRAMES + 1 }, () => structuredClone(five.frames[0]))
    expect(layoutProblems(five)).toEqual([message])
    const notArray = base() as unknown as Record<string, unknown>
    notArray.frames = {}
    expect(layoutProblems(notArray)).toEqual([message])
  })

  it('caps pieces, zones and arrows per phase', () => {
    const pieces = base()
    pieces.frames[0].entities = Array.from({ length: LAYOUT_MAX_ENTITIES_PER_FRAME + 1 }, (_, i) => entity(`e${i}`))
    expect(layoutProblems(pieces)).toEqual([`Phase 1 holds at most ${LAYOUT_MAX_ENTITIES_PER_FRAME} pieces.`])

    const zones = base()
    zones.frames[0].zones = Array.from({ length: LAYOUT_MAX_ZONES_PER_FRAME + 1 }, (_, i) => ({
      id: `z${i}`,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }))
    expect(layoutProblems(zones)).toContain(`Phase 1 holds at most ${LAYOUT_MAX_ZONES_PER_FRAME} zones.`)

    const arrows = base()
    arrows.frames[0].arrows = Array.from({ length: LAYOUT_MAX_ARROWS_PER_FRAME + 1 }, (_, i) => ({
      id: `a${i}`,
      kind: 'pass' as const,
      from: { x: 1, y: 1 },
      to: { x: 2, y: 2 },
    }))
    expect(layoutProblems(arrows)).toContain(`Phase 1 holds at most ${LAYOUT_MAX_ARROWS_PER_FRAME} arrows.`)
  })

  it('caps the phase note', () => {
    const layout = base()
    layout.frames[0].note = 'x'.repeat(LAYOUT_NOTE_MAX + 1)
    expect(layoutProblems(layout)).toContain("Phase 1's note is too long.")
    layout.frames[0].note = 'x'.repeat(LAYOUT_NOTE_MAX)
    expect(layoutProblems(layout)).toEqual([])
  })
})

describe('layoutProblems per piece rules', () => {
  it('refuses a missing, empty or over long id', () => {
    for (const id of [undefined, '', 'x'.repeat(41), 7]) {
      const layout = base()
      layout.frames[0].entities[0] = { ...layout.frames[0].entities[0], id: id as string }
      expect(layoutProblems(layout).some((p) => p.includes('has no usable id'))).toBe(true)
    }
  })

  it('refuses a duplicate id, including across entities, zones and arrows', () => {
    const twice = base()
    twice.frames[0].entities[1] = { ...twice.frames[0].entities[1], id: 'c1' }
    expect(layoutProblems(twice)).toContain('Phase 1 piece 2 repeats the id c1.')

    const zoneClash = base()
    zoneClash.frames[0].zones = [{ id: 'c1', x: 0, y: 0, width: 2, height: 2 }]
    expect(layoutProblems(zoneClash)).toContain('Phase 1 zone 1 repeats the id c1.')

    const arrowClash = base()
    arrowClash.frames[0].arrows[0] = { ...arrowClash.frames[0].arrows[0], id: 'b1' }
    expect(layoutProblems(arrowClash)).toContain('Phase 1 arrow 1 repeats the id b1.')
  })

  it('refuses an unknown entity kind and an unknown arrow kind', () => {
    const layout = base()
    layout.frames[0].entities[0] = entity('c1', { kind: 'flag' as never })
    expect(layoutProblems(layout)).toContain('Phase 1 piece 1 has an unknown kind.')

    const arrow = base()
    arrow.frames[0].arrows[0] = { ...arrow.frames[0].arrows[0], kind: 'teleport' as never }
    expect(layoutProblems(arrow)).toContain('Phase 1 arrow 1 has an unknown kind.')
  })

  it('keeps every coordinate inside the declared area', () => {
    const east = base()
    east.frames[0].entities[0] = entity('c1', { x: east.area.width + 0.1 })
    expect(layoutProblems(east)).toContain('Phase 1 piece 1 x is outside the area')

    const north = base()
    north.frames[0].entities[0] = entity('c1', { y: -0.1 })
    expect(layoutProblems(north)).toContain('Phase 1 piece 1 y is outside the area')

    const arrow = base()
    arrow.frames[0].arrows[0] = { id: 'a1', kind: 'pass', from: { x: -1, y: 1 }, to: { x: 1, y: 99 } }
    const problems = layoutProblems(arrow)
    expect(problems).toContain('Phase 1 arrow 1 start x is outside the area')
    expect(problems).toContain('Phase 1 arrow 1 end y is outside the area')
  })

  it('bounds rotation to 0 up to but not including 360', () => {
    for (const rotation of [-1, 360, Number.NaN]) {
      const layout = base()
      layout.frames[0].entities[0] = entity('c1', { rotation })
      expect(layoutProblems(layout)).toContain('Phase 1 piece 1 has an unusable rotation.')
    }
    const fine = base()
    fine.frames[0].entities[0] = entity('c1', { rotation: 359.5 })
    expect(layoutProblems(fine)).toEqual([])
  })

  it('allows a team on players only, and only a known one', () => {
    const cone = base()
    cone.frames[0].entities[0] = entity('c1', { team: 'attack' })
    expect(layoutProblems(cone)).toContain('Phase 1 piece 1 carries a team but is not a player.')

    const unknown = base()
    unknown.frames[0].entities[4] = { ...unknown.frames[0].entities[4], team: 'bibs' as never }
    expect(layoutProblems(unknown)).toContain('Phase 1 piece 5 has an unknown team.')
  })

  it('caps the piece label at three characters so it can never hold a name', () => {
    const layout = base()
    layout.frames[0].entities[4] = { ...layout.frames[0].entities[4], label: 'Jack' }
    expect(layoutProblems(layout)).toContain(`Phase 1 piece 5's label is over ${LAYOUT_LABEL_MAX} characters.`)
  })

  it('keeps zones inside the area and caps their label', () => {
    const outside = base()
    outside.frames[0].zones = [{ id: 'z1', x: 6, y: 0, width: 7, height: 2 }]
    expect(layoutProblems(outside)).toContain('Phase 1 zone 1 does not fit inside the area.')

    const flat = base()
    flat.frames[0].zones = [{ id: 'z1', x: 0, y: 0, width: 0, height: 2 }]
    expect(layoutProblems(flat)).toContain('Phase 1 zone 1 does not fit inside the area.')

    const label = base()
    label.frames[0].zones = [{ id: 'z1', x: 0, y: 0, width: 2, height: 2, label: 'x'.repeat(LAYOUT_ZONE_LABEL_MAX + 1) }]
    expect(layoutProblems(label)).toContain(`Phase 1 zone 1's label is over ${LAYOUT_ZONE_LABEL_MAX} characters.`)
  })
})

describe('layoutProblems shared identity across phases', () => {
  const mismatch = 'Phase 2 does not carry the same pieces as phase 1; phases move pieces, never add or remove them.'

  it('a phase that drops a piece fails', () => {
    const layout = structuredClone(FIXTURE_ONE_V_ONE)
    layout.frames[1].entities = layout.frames[1].entities.slice(1)
    expect(layoutProblems(layout)).toContain(mismatch)
  })

  it('a phase that adds a piece fails', () => {
    const layout = structuredClone(FIXTURE_ONE_V_ONE)
    layout.frames[1].entities = [...layout.frames[1].entities, entity('extra')]
    expect(layoutProblems(layout)).toContain(mismatch)
  })

  it('a phase that swaps a piece for another id fails even at the same count', () => {
    const layout = structuredClone(FIXTURE_ONE_V_ONE)
    layout.frames[1].entities[0] = { ...layout.frames[1].entities[0], id: 'g2' }
    expect(layoutProblems(layout)).toContain(mismatch)
  })

  it('a phase that only moves the pieces passes', () => {
    const layout = structuredClone(FIXTURE_ONE_V_ONE)
    layout.frames[1].entities[2] = { ...layout.frames[1].entities[2], x: 9, y: 3 }
    expect(layoutProblems(layout)).toEqual([])
  })
})

describe('parseDrillLayout', () => {
  it('returns the layout unchanged when valid', () => {
    expect(parseDrillLayout(FIXTURE_SMALL_SIDED_GAME)).toBe(FIXTURE_SMALL_SIDED_GAME)
  })

  it('returns null for anything invalid, never throwing', () => {
    expect(parseDrillLayout(null)).toBeNull()
    expect(parseDrillLayout({})).toBeNull()
    const broken = base() as unknown as Record<string, unknown>
    broken.version = 99
    expect(parseDrillLayout(broken)).toBeNull()
  })

  it('survives a JSON round trip, the storage path', () => {
    const back = JSON.parse(JSON.stringify(FIXTURE_ONE_V_ONE)) as unknown
    expect(parseDrillLayout(back)).toEqual(FIXTURE_ONE_V_ONE)
  })
})

describe('layoutEntityCounts and layoutKitLines', () => {
  it('counts the passing square from phase 1', () => {
    expect(layoutEntityCounts(FIXTURE_PASSING_SQUARE)).toEqual({
      cone: 4,
      marker: 0,
      goal: 0,
      mini_goal: 0,
      mannequin: 0,
      player: 4,
      ball: 1,
    })
  })

  it('counts a multi phase drill once, from phase 1', () => {
    const counts = layoutEntityCounts(FIXTURE_ONE_V_ONE)
    expect(counts.mini_goal).toBe(1)
    expect(counts.player).toBe(3)
    expect(counts.ball).toBe(1)
  })

  it('covers every entity kind in the counts record', () => {
    const counts = layoutEntityCounts(FIXTURE_PASSING_SQUARE)
    expect(Object.keys(counts).sort()).toEqual([...LAYOUT_ENTITY_KINDS].sort())
  })

  it('kit lines pluralise, keep kind order and omit players and zero counts', () => {
    expect(layoutKitLines(FIXTURE_PASSING_SQUARE)).toEqual(['4 cones', '1 ball'])
    expect(layoutKitLines(FIXTURE_ONE_V_ONE)).toEqual(['1 mini goal', '1 ball'])
    expect(layoutKitLines(FIXTURE_SMALL_SIDED_GAME)).toEqual(['2 goals', '1 ball'])
  })
})

describe('areaFits and areaFitScale', () => {
  it('fits straight and turned ninety degrees', () => {
    expect(areaFits({ width: 12, length: 8 }, { width: 12, length: 8 })).toBe(true)
    expect(areaFits({ width: 12, length: 8 }, { width: 8, length: 12 })).toBe(true)
    expect(areaFits({ width: 12, length: 8 }, { width: 10, length: 10 })).toBe(false)
  })

  it('scale is the better of straight and turned', () => {
    // Straight doubles cleanly; turned would waste the box.
    expect(areaFitScale({ width: 12, length: 8 }, { width: 24, length: 16 })).toBe(2)
    // Only the turn fits at full size.
    expect(areaFitScale({ width: 12, length: 8 }, { width: 8, length: 12 })).toBe(1)
    // Too big either way: under 1 signals the composer's warning.
    expect(areaFitScale({ width: 30, length: 20 }, { width: 15, length: 10 })).toBe(0.5)
  })
})
