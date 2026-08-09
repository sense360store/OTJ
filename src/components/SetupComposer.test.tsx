import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SetupComposerView } from './SetupComposer'
import { SetupPlanView, SetupSchematic } from './SetupSchematic'
import { SetupSheet } from './SetupSheet'
import { areaFrame, schematicStations, type SessionSetup } from '../lib/sessionSetup'
import { FLUSHDYKE, HAGGS_HILL } from '../lib/venueFixtures'
import { FIXTURE_PASSING_SQUARE } from '../lib/drillLayoutFixtures'
import type { Drill } from '../lib/data'
import type { VenueArea } from '../lib/venues'

// The composer's static face and the read only views over it. The
// schematic is scale true to the club's real areas; a station crossing the
// drawn boundary is called out and never removed or refused.

const areas: VenueArea[] = [
  { id: 'a1', venueId: 'v1', name: 'Flushdyke', boundary: FLUSHDYKE, usable: true },
  { id: 'a2', venueId: 'v2', name: 'Haggs Hill main field', boundary: HAGGS_HILL, usable: true },
]

const drill = (over: Partial<Drill> = {}): Drill => ({
  id: 'd1',
  title: 'Passing square',
  corner: 'technical',
  skill: '',
  ages: [],
  level: 'Foundation',
  duration: 10,
  players: '',
  area: '',
  equipment: [],
  mediaId: null,
  summary: '',
  points: [],
  tags: [],
  setupNotes: '',
  easier: [],
  harder: [],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  createdAt: '2026-01-01T00:00:00Z',
  layout: FIXTURE_PASSING_SQUARE,
  ...over,
})

const frame = areaFrame(HAGGS_HILL)
const drills = [drill()]
const drillById = { d1: drills[0] }
const setup: SessionSetup = {
  version: 1,
  stations: [
    { id: 's1', x: 50, y: 50, width: 12, length: 12, drillId: 'd1' },
    { id: 's2', x: 0, y: 0, width: 8, length: 8, label: 'Warm up' },
  ],
}
const noop = () => {}

describe('SetupSchematic', () => {
  it('draws the boundary and one rectangle per station', () => {
    const html = renderToStaticMarkup(
      <SetupSchematic frame={frame} stations={schematicStations(setup, drillById)} />,
    )
    expect(html).toContain('setup-boundary')
    // The group per station; the numbered and labelled text nodes inside
    // carry their own classes and are not counted here.
    expect(html.match(/<g class="setup-station/g)).toHaveLength(2)
    // The Haggs Hill polygon has four vertices, so the points list has four.
    const points = html.match(/points="([^"]+)"/)![1].split(' ')
    expect(points).toHaveLength(4)
  })

  it('marks the station that crosses the drawn boundary without dropping it', () => {
    const html = renderToStaticMarkup(
      <SetupSchematic frame={frame} stations={schematicStations(setup, drillById)} />,
    )
    // The field is a rotated quadrilateral, so the bounding box corner is
    // off the grass: exactly the corner station is marked, the one in the
    // middle is not, and both are still drawn.
    expect(html.match(/setup-station outside/g)).toHaveLength(1)
    expect(html).toContain('Warm up')
    expect(html).toContain('Passing square')
  })

  it('is scale true: a station is drawn at its share of the long side', () => {
    const html = renderToStaticMarkup(
      <SetupSchematic
        frame={{ polygon: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }], width: 100, length: 50 }}
        stations={[{ station: { id: 's1', x: 0, y: 0, width: 10, length: 10 }, title: '', index: 0 }]}
      />,
    )
    // 600 units to 100 metres: a 10 metre station draws 60 wide.
    expect(html).toContain('width="60"')
    expect(html).toContain('height="60"')
  })

  it('is static without handlers: nothing to tap or drag', () => {
    const html = renderToStaticMarkup(<SetupSchematic frame={frame} stations={[]} />)
    expect(html).not.toContain('interactive')
    expect(html).not.toContain('<button')
  })
})

describe('SetupComposerView area choice', () => {
  it('offers only usable areas, plus whichever one this session already uses', () => {
    const html = renderToStaticMarkup(
      <SetupComposerView
        areas={[{ ...areas[0], usable: false }, areas[1]]}
        areaId="a2"
        frame={frame}
        setup={setup}
        drills={drills}
        drillById={drillById}
        selectedId={null}
        onArea={noop}
        onSelect={noop}
        onTapCanvas={noop}
        onDragStation={noop}
        onResize={noop}
        onLabel={noop}
        onBindDrill={noop}
        onRemove={noop}
      />,
    )
    expect(html).not.toContain('Flushdyke')
    expect(html).toContain('Haggs Hill main field')
  })

  it('says a change of area starts the layout again, while there is something to lose', () => {
    const withStations = renderToStaticMarkup(
      <SetupComposerView
        areas={areas}
        areaId="a2"
        frame={frame}
        setup={setup}
        drills={drills}
        drillById={drillById}
        selectedId={null}
        onArea={noop}
        onSelect={noop}
        onTapCanvas={noop}
        onDragStation={noop}
        onResize={noop}
        onLabel={noop}
        onBindDrill={noop}
        onRemove={noop}
      />,
    )
    expect(withStations).toContain('Changing the area starts the layout again')
    const empty = renderToStaticMarkup(
      <SetupComposerView
        areas={areas}
        areaId="a2"
        frame={frame}
        setup={{ version: 1, stations: [] }}
        drills={drills}
        drillById={drillById}
        selectedId={null}
        onArea={noop}
        onSelect={noop}
        onTapCanvas={noop}
        onDragStation={noop}
        onResize={noop}
        onLabel={noop}
        onBindDrill={noop}
        onRemove={noop}
      />,
    )
    expect(empty).not.toContain('Changing the area starts the layout again')
  })
})

describe('SetupComposerView', () => {
  const render = (over: Partial<Parameters<typeof SetupComposerView>[0]> = {}) =>
    renderToStaticMarkup(
      <SetupComposerView
        areas={areas}
        areaId="a2"
        frame={frame}
        setup={setup}
        drills={drills}
        drillById={drillById}
        selectedId={null}
        onArea={noop}
        onSelect={noop}
        onTapCanvas={noop}
        onDragStation={noop}
        onResize={noop}
        onLabel={noop}
        onBindDrill={noop}
        onRemove={noop}
        {...over}
      />,
    )

  it('offers every configured area with its measured size', () => {
    const html = render()
    expect(html).toContain('Flushdyke')
    expect(html).toContain('Haggs Hill main field')
    expect(html).toContain('m²')
  })

  it('warns about a station crossing the boundary and never blocks on it', () => {
    const html = render()
    expect(html).toContain('One station crosses the drawn boundary')
    // The station is still drawn and still listed.
    expect(html).toContain('setup-station outside')
    expect(html).toContain('crosses the boundary')
  })

  it('asks for an area before drawing anything', () => {
    const html = render({ frame: null, areaId: '' })
    expect(html).toContain('Choose the area this session is laid out on')
    expect(html).not.toContain('setup-schematic')
  })

  it('shows the fit of the bound drill in its station', () => {
    const html = render()
    // A 12 by 12 station takes the passing square's 12 by 12 exactly.
    expect(html).toContain('fits the drill')
  })

  it('inspects the selected station only', () => {
    expect(render()).not.toContain('Remove station')
    const html = render({ selectedId: 's2' })
    expect(html).toContain('Remove station')
    expect(html).toContain('Width, m')
    expect(html).toContain('value="Warm up"')
  })
})

describe('SetupPlanView', () => {
  it('reads back the plan with no editing affordance', () => {
    const html = renderToStaticMarkup(
      <SetupPlanView
        frame={frame}
        stations={schematicStations(setup, drillById)}
        areaName="Haggs Hill main field"
        drillAreas={{ d1: FIXTURE_PASSING_SQUARE.area }}
      />,
    )
    expect(html).toContain('Haggs Hill main field')
    expect(html).toContain('north up')
    expect(html).toContain('1. Passing square')
    expect(html).toContain('2. Warm up')
    expect(html).toContain('One station crosses the drawn boundary')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
  })
})

describe('SetupSheet', () => {
  const html = renderToStaticMarkup(
    <SetupSheet
      sessionName="Monday training"
      subtitle="Mon 10 Aug · 17:30 · Haggs Hill"
      areaName="Haggs Hill main field"
      frame={frame}
      stations={schematicStations(setup, drillById)}
      drillAreas={{ d1: FIXTURE_PASSING_SQUARE.area }}
      kit={[
        { name: 'cones', count: 4, drills: ['Passing square'] },
        { name: 'Bibs', count: null, drills: ['Passing square'] },
      ]}
      activities={[{ title: 'Passing square', phase: 'Skill', duration: 15 }]}
    />,
  )

  it('carries the whole session on one sheet', () => {
    expect(html).toContain('Monday training')
    expect(html).toContain('Setup on Haggs Hill main field')
    expect(html).toContain('setup-schematic')
    expect(html).toContain('1. Passing square')
    expect(html).toContain('4 cones')
    expect(html).toContain('Bibs')
    expect(html).toContain('Skill · 15 min')
  })

  it('calls out a boundary crossing on the printed page too', () => {
    expect(html).toContain('crosses the drawn boundary, check on the grass')
  })

  it('is hidden from assistive technology on screen: it is the print twin', () => {
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('class="setup-sheet"')
  })
})
