import { describe, expect, it } from 'vitest'
import { FLUSHDYKE, HAGGS_HILL } from './venueFixtures'
import { FIXTURE_PASSING_SQUARE, FIXTURE_SMALL_SIDED_GAME } from './drillLayoutFixtures'
import {
  addStation,
  areaFrame,
  emptySetup,
  moveStation,
  parseSessionSetup,
  pointInPolygon,
  removeStation,
  resizeStation,
  sessionKit,
  setStationDrill,
  schematicMetres,
  schematicProjection,
  setStationLabel,
  SETUP_LABEL_MAX,
  setupForArea,
  SETUP_MAX_STATIONS,
  setupProblems,
  stationFit,
  stationInsideBoundary,
  stationSummary,
  type SessionSetup,
  type SetupStation,
} from './sessionSetup'

// The composer's geometry against the club's two real areas, and the kit
// aggregation across a session's drills. Flushdyke is the tight one: a
// small sided game barely goes on it. Haggs Hill takes the same game with
// room to spare.

const station = (over: Partial<SetupStation> = {}): SetupStation => ({
  id: 's1',
  x: 5,
  y: 5,
  width: 10,
  length: 10,
  ...over,
})

describe('areaFrame', () => {
  it('puts the origin at the bounding box corner and measures the box in metres', () => {
    const flush = areaFrame(FLUSHDYKE)
    expect(Math.min(...flush.polygon.map((p) => p.x))).toBeCloseTo(0, 6)
    expect(Math.min(...flush.polygon.map((p) => p.y))).toBeCloseTo(0, 6)
    // Flushdyke measures roughly 65 by 57 metres across its box.
    expect(flush.width).toBeGreaterThan(55)
    expect(flush.width).toBeLessThan(80)
    expect(flush.length).toBeGreaterThan(45)
    expect(flush.length).toBeLessThan(70)
  })

  it('Haggs Hill is the larger field of the two', () => {
    const haggs = areaFrame(HAGGS_HILL)
    const flush = areaFrame(FLUSHDYKE)
    expect(haggs.width * haggs.length).toBeGreaterThan(flush.width * flush.length * 2)
  })
})

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]

  it('separates inside from outside', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
    expect(pointInPolygon({ x: 5, y: -1 }, square)).toBe(false)
  })

  it('handles a concave shape without leaking', () => {
    // An L, with the notch in the top right.
    const ell = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 4, y: 4 },
      { x: 4, y: 10 },
      { x: 0, y: 10 },
    ]
    expect(pointInPolygon({ x: 2, y: 8 }, ell)).toBe(true)
    expect(pointInPolygon({ x: 8, y: 8 }, ell)).toBe(false)
  })
})

describe('stationInsideBoundary', () => {
  it('a station in the middle of Haggs Hill is inside, one pushed out is not', () => {
    const frame = areaFrame(HAGGS_HILL)
    const middle = station({ x: frame.width / 2 - 10, y: frame.length / 2 - 10, width: 20, length: 20 })
    expect(stationInsideBoundary(middle, frame)).toBe(true)
    // The bounding box corner lies outside the drawn polygon: the field is
    // a rotated quadrilateral, not a rectangle.
    const corner = station({ x: 0, y: 0, width: 8, length: 8 })
    expect(stationInsideBoundary(corner, frame)).toBe(false)
  })

  it('crossing the boundary is only ever a warning: the value stays valid', () => {
    const frame = areaFrame(FLUSHDYKE)
    const crossing = station({ x: 0, y: 0, width: 6, length: 6 })
    const setup: SessionSetup = { version: 1, stations: [crossing] }
    expect(stationInsideBoundary(crossing, frame)).toBe(false)
    expect(setupProblems(setup)).toEqual([])
  })
})

describe('stationFit', () => {
  it('a small sided game is a clean fit on Haggs Hill', () => {
    const fit = stationFit(station({ width: 40, length: 30 }), FIXTURE_SMALL_SIDED_GAME.area)
    expect(fit.fits).toBe(true)
    expect(fit.scale).toBeGreaterThan(1)
  })

  it('the same game is a tight fit in a Flushdyke sized station', () => {
    // 30 by 20 will not go in 25 by 18 either way round.
    const fit = stationFit(station({ width: 25, length: 18 }), FIXTURE_SMALL_SIDED_GAME.area)
    expect(fit.fits).toBe(false)
    expect(fit.scale).toBeLessThan(1)
  })

  it('reports the turn when only the ninety degree fit works', () => {
    const fit = stationFit(station({ width: 14, length: 32 }), FIXTURE_SMALL_SIDED_GAME.area)
    expect(fit.fits).toBe(false)
    expect(fit.turned).toBe(true)
  })

  it('summarises a station with and without a bound drill', () => {
    expect(stationSummary(station({ width: 12, length: 12 }), null)).toBe('12 × 12 m')
    expect(stationSummary(station({ width: 12, length: 12 }), FIXTURE_PASSING_SQUARE.area)).toContain('fits')
    expect(stationSummary(station({ width: 8, length: 8 }), FIXTURE_PASSING_SQUARE.area)).toContain('tighter')
  })
})

describe('setupProblems', () => {
  it('accepts an empty setup and a placed one', () => {
    expect(setupProblems(emptySetup())).toEqual([])
    expect(setupProblems({ version: 1, stations: [station({ label: 'Warm up grid', drillId: 'd1' })] })).toEqual([])
  })

  it('refuses a wrong version, a non object and unknown fields', () => {
    expect(setupProblems(null)).toEqual(['The setup is not an object.'])
    expect(setupProblems({ version: 2, stations: [] })).toContain('The setup version is not 1.')
    expect(setupProblems({ version: 1, stations: [], areaId: 'x' })).toContain(
      'The setup carries an unknown field areaId.',
    )
    expect(setupProblems({ version: 1, stations: [{ ...station(), colour: 'red' }] })).toContain(
      'Station 1 carries an unknown field colour.',
    )
  })

  it('caps the station count, the label and the size', () => {
    const many = { version: 1, stations: Array.from({ length: SETUP_MAX_STATIONS + 1 }, (_, i) => station({ id: `s${i}` })) }
    expect(setupProblems(many)).toContain(`A setup holds at most ${SETUP_MAX_STATIONS} stations.`)
    expect(setupProblems({ version: 1, stations: [station({ label: 'x'.repeat(SETUP_LABEL_MAX + 1) })] })).toContain(
      `Station 1's label is over ${SETUP_LABEL_MAX} characters.`,
    )
    expect(setupProblems({ version: 1, stations: [station({ width: 0.5 })] })).toContain(
      "Station 1 needs a size between 1 and 150 metres.",
    )
    expect(setupProblems({ version: 1, stations: [station({ x: -1 })] })).toContain(
      "Station 1 sits outside the area's own frame.",
    )
  })

  it('refuses duplicate ids and an unusable drill reference', () => {
    expect(setupProblems({ version: 1, stations: [station(), station()] })).toContain('Station 2 repeats the id s1.')
    expect(setupProblems({ version: 1, stations: [station({ drillId: '' })] })).toContain(
      'Station 1 has an unusable drill reference.',
    )
  })

  it('parses clean values and refuses the rest, never throwing', () => {
    expect(parseSessionSetup(emptySetup())).toEqual(emptySetup())
    expect(parseSessionSetup({ version: 1, stations: [{ id: {} }] })).toBeNull()
    expect(parseSessionSetup('setup')).toBeNull()
  })
})

describe('editing', () => {
  const frame = areaFrame(HAGGS_HILL)

  it("a placed station centres on the tap and takes the drill's own area", () => {
    const setup = addStation(emptySetup(), frame, { x: 30, y: 30 }, { id: 'd1', area: { width: 12, length: 12 } })!
    expect(setup.stations[0]).toMatchObject({ id: 's1', width: 12, length: 12, drillId: 'd1' })
    expect(setup.stations[0].x).toBeCloseTo(24, 1)
    expect(setupProblems(setup)).toEqual([])
  })

  it('a station without a drill takes a plain grid, and ids never collide', () => {
    let setup = addStation(emptySetup(), frame, { x: 20, y: 20 })!
    setup = addStation(setup, frame, { x: 40, y: 20 })!
    setup = removeStation(setup, 's1')
    setup = addStation(setup, frame, { x: 10, y: 10 })!
    expect(setup.stations.map((s) => s.id)).toEqual(['s2', 's3'])
    expect(setup.stations[0].drillId).toBeUndefined()
  })

  it('refuses past the station cap', () => {
    let setup = emptySetup()
    for (let i = 0; i < SETUP_MAX_STATIONS; i++) setup = addStation(setup, frame, { x: 10, y: 10 })!
    expect(addStation(setup, frame, { x: 10, y: 10 })).toBeNull()
  })

  it('moves, resizes, labels and binds without ever leaving the value invalid', () => {
    let setup = addStation(emptySetup(), frame, { x: 20, y: 20 })!
    setup = moveStation(setup, 's1', { x: 12.34567, y: -5 })
    expect(setup.stations[0]).toMatchObject({ x: 12.3, y: 0 })
    setup = resizeStation(setup, 's1', 999, 0)
    expect(setup.stations[0]).toMatchObject({ width: 150, length: 1 })
    setup = setStationLabel(setup, 's1', 'Rondo grid')
    expect(setup.stations[0].label).toBe('Rondo grid')
    setup = setStationLabel(setup, 's1', '')
    expect(setup.stations[0].label).toBeUndefined()
    setup = setStationDrill(setup, 's1', 'd9')
    expect(setup.stations[0].drillId).toBe('d9')
    setup = setStationDrill(setup, 's1', null)
    expect(setup.stations[0].drillId).toBeUndefined()
    expect(setupProblems(setup)).toEqual([])
  })

  it('clips a label without splitting a surrogate pair', () => {
    let setup = addStation(emptySetup(), frame, { x: 20, y: 20 })!
    setup = setStationLabel(setup, 's1', '\u{1F44D}'.repeat(20))
    expect(setupProblems(setup)).toEqual([])
    expect(() => JSON.parse(JSON.stringify(setup))).not.toThrow()
  })
})

describe('schematic projection', () => {
  it('a pointer lands back on the metres it was taken from', () => {
    // The drag path and the tap path share this helper, so one round trip
    // covers both. A browser sizes the svg to the viewBox aspect.
    const frame = areaFrame(HAGGS_HILL)
    const p = schematicProjection(frame)
    const box = { width: p.width + p.pad * 2, height: p.length + p.pad * 2 }
    for (const point of [
      { x: 0, y: 0 },
      { x: 20, y: 80 },
      { x: frame.width, y: frame.length },
      { x: 57.3, y: 12.9 },
    ]) {
      // Metres to the box, the way the schematic draws them.
      const offsetX = point.x * p.k + p.pad
      const offsetY = (frame.length - point.y) * p.k + p.pad
      const back = schematicMetres(frame, box, offsetX, offsetY)!
      expect(back.x).toBeCloseTo(point.x, 6)
      expect(back.y).toBeCloseTo(point.y, 6)
    }
  })

  it('reports nothing before the schematic has been measured', () => {
    expect(schematicMetres(areaFrame(FLUSHDYKE), { width: 0, height: 0 }, 10, 10)).toBeNull()
  })
})

describe('setupForArea', () => {
  it('keeps the stations on the same area and starts again on a different one', () => {
    const setup: SessionSetup = { version: 1, stations: [station()] }
    expect(setupForArea(setup, true)).toBe(setup)
    expect(setupForArea(setup, false).stations).toEqual([])
    // Nothing to lose, nothing to warn about.
    const empty = emptySetup()
    expect(setupForArea(empty, false)).toBe(empty)
  })
})

describe('sessionKit', () => {
  it('counts layout pieces at the most a single drill needs, not the sum', () => {
    const kit = sessionKit([
      { id: 'd1', title: 'Passing square', equipment: [], layout: FIXTURE_PASSING_SQUARE },
      { id: 'd2', title: 'Small sided game', equipment: [], layout: FIXTURE_SMALL_SIDED_GAME },
    ])
    const cones = kit.find((k) => k.name === 'cones')!
    // Four cones in the square, none in the game: four is the requirement.
    expect(cones.count).toBe(4)
    expect(cones.drills).toEqual(['Passing square'])
    const balls = kit.find((k) => k.name === 'balls')!
    expect(balls.count).toBe(1)
    expect(balls.drills).toEqual(['Passing square', 'Small sided game'])
    expect(kit.find((k) => k.name === 'goals')!.count).toBe(2)
  })

  it('carries free text equipment with no count', () => {
    const kit = sessionKit([{ id: 'd3', title: 'Rondo', equipment: ['Bibs', 'Whistle'], layout: null }])
    expect(kit.map((k) => [k.name, k.count])).toEqual([
      ['Bibs', null],
      ['Whistle', null],
    ])
  })

  it('folds equipment text into the counted line it names, rather than listing twice', () => {
    const kit = sessionKit([
      { id: 'd1', title: 'Passing square', equipment: ['Cones', 'Bibs'], layout: FIXTURE_PASSING_SQUARE },
    ])
    expect(kit.filter((k) => k.name.toLowerCase().includes('cone'))).toHaveLength(1)
    expect(kit.find((k) => k.name === 'cones')!.count).toBe(4)
    expect(kit.find((k) => k.name === 'Bibs')!.count).toBeNull()
  })

  it('merges the same free text across drills and keeps session order', () => {
    const kit = sessionKit([
      { id: 'd4', title: 'A', equipment: ['Bibs'], layout: null },
      { id: 'd5', title: 'B', equipment: ['bibs'], layout: null },
    ])
    expect(kit).toHaveLength(1)
    expect(kit[0].drills).toEqual(['A', 'B'])
  })

  it('sums across stations standing at once, because a carousel needs every set', () => {
    const drills = [{ id: 'd1', title: 'Passing square', equipment: [], layout: FIXTURE_PASSING_SQUARE }]
    // Three stations of the same four cone drill need twelve cones out at
    // once, not four picked up and put down again.
    const kit = sessionKit(drills, ['d1', 'd1', 'd1'])
    expect(kit.find((k) => k.name === 'cones')!.count).toBe(12)
    expect(kit.find((k) => k.name === 'balls')!.count).toBe(3)
    // One station is the sequential case again.
    expect(sessionKit(drills, ['d1']).find((k) => k.name === 'cones')!.count).toBe(4)
    // A station bound to nothing, or to a drill outside the session, adds
    // nothing rather than throwing.
    expect(sessionKit(drills, ['ghost']).find((k) => k.name === 'cones')!.count).toBe(4)
  })

  it('takes the larger of what one drill needs and what the stations need at once', () => {
    const kit = sessionKit(
      [
        { id: 'd1', title: 'Passing square', equipment: [], layout: FIXTURE_PASSING_SQUARE },
        { id: 'd2', title: 'Small sided game', equipment: [], layout: FIXTURE_SMALL_SIDED_GAME },
      ],
      ['d2'],
    )
    // The game station needs two goals at once; the square, run at its own
    // turn, still sets the cone requirement.
    expect(kit.find((k) => k.name === 'goals')!.count).toBe(2)
    expect(kit.find((k) => k.name === 'cones')!.count).toBe(4)
  })

  it('is empty for a session of drills with neither equipment nor a diagram', () => {
    expect(sessionKit([{ id: 'd6', title: 'Talk', equipment: [], layout: null }])).toEqual([])
  })
})
