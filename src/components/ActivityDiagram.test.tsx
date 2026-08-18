// The seam that puts a saved Drill Maker diagram inside a session (DRILL-02).
//
// ActivityDiagramView is the hook free half, so it renders here with no query
// client and no mocks. The mounted half (ActivityDiagram) is proved by the
// screen tests, which render the real Planner, Session Day and Live containers.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityDiagramView } from './ActivityDiagram'
import { DRILL_DIAGRAM_VERSION, emptyDiagram, type DrillDiagram } from '../lib/drillDiagram'
import { DIAGRAM_HEIGHT_CAP } from '../lib/drillDiagramSize'

const diagram: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'full_pitch', orientation: 'portrait' },
  elements: [
    { type: 'player', id: 'player-1', x: 0.3, y: 0.4, colour: 'blue', label: '7' },
    { type: 'player', id: 'player-2', x: 0.7, y: 0.4, colour: 'red', label: '' },
    { type: 'ball', id: 'ball-1', x: 0.5, y: 0.5 },
    { type: 'arrow', id: 'arrow-1', x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.4, arrow: 'pass' },
    { type: 'arrow', id: 'arrow-2', x1: 0.2, y1: 0.6, x2: 0.6, y2: 0.9, arrow: 'run' },
    { type: 'arrow', id: 'arrow-3', x1: 0.8, y1: 0.2, x2: 0.4, y2: 0.7, arrow: 'dribble' },
  ],
}

const html = (d: DrillDiagram | null, className?: string, heightCap?: string) =>
  renderToStaticMarkup(<ActivityDiagramView diagram={d} className={className} heightCap={heightCap} />)

// The inline style the renderer emits, which is where the caps now live.
const styleOf = (out: string) => /style="([^"]*)"/.exec(out)?.[1] ?? ''

const landscape: DrillDiagram = { ...diagram, surface: { kind: 'full_pitch', orientation: 'landscape' } }

describe('the diagram a session shows', () => {
  it('draws through the canonical renderer', () => {
    const out = html(diagram)
    // data-el markers belong to DrillDiagramView's element shapes. Markup
    // shaped like a diagram but drawn somewhere else would not carry them.
    expect(out).toContain('data-el="player"')
    expect(out).toContain('data-el="ball"')
    expect(out).toContain('data-el="arrow"')
    expect(out).toContain('class="dd-surface"')
    expect(out).toContain('<svg')
  })

  it('renders nothing at all when there is nothing to show', () => {
    // Not an empty frame, not a placeholder, not a caption: nothing. Most
    // drills carry no diagram and every card would otherwise gain noise.
    expect(html(null)).toBe('')
  })

  it('passes its class through so each surface can size the same picture', () => {
    expect(html(diagram, 'dd-in-live')).toContain('class="dd-surface dd-in-live"')
    expect(html(diagram, 'dd-in-panel')).toContain('class="dd-surface dd-in-panel"')
  })

  it('carries an accessible name that says what the diagram holds', () => {
    const out = html(diagram)
    expect(out).toContain('role="img"')
    expect(out).toContain('aria-label="Drill diagram: 2 players, 1 ball, 3 arrows"')
  })

  it('keeps arrow meaning in the line rather than the colour', () => {
    // A run, a pass and a dribble have to stay apart in black and white, on
    // paper, and for anyone who does not see colour. A pass is dashed, a
    // dribble is a wave, a run is a plain line, and each says so in words.
    const out = html(diagram)
    expect(out).toContain('stroke-dasharray="20 14"')
    expect(out).toContain('class="dd-wave"')
    expect(out).toContain('<title>Pass</title>')
    expect(out).toContain('<title>Run</title>')
    expect(out).toContain('<title>Dribble</title>')
  })

  it('renders no control and nothing focusable', () => {
    // Read only means read only. The editor's chrome stays in the editor, and
    // a preview inside a session adds no tab stop to a coach's keyboard path.
    const out = html(diagram)
    expect(out).not.toContain('<button')
    expect(out).not.toContain('tabindex')
    expect(out).not.toContain('contenteditable')
    expect(out).not.toContain('aria-pressed')
  })

  it('keeps every player generic, with no identity of any kind', () => {
    // The diagram is a reusable drill, never a tactics board. A player token
    // carries a colour and at most a shirt-sized label, and nothing here or
    // anywhere below it resolves tonight's actual children.
    const out = html(diagram)
    for (const forbidden of ['playerId', 'player_id', 'display_name', 'displayName', 'spond', 'guardian']) {
      expect(out.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('draws exactly what it is handed and holds no rule of its own', () => {
    // Deliberate division of labour: an EMPTY diagram still draws here, as a
    // bare surface, because deciding that an empty diagram is nothing to show
    // is diagramForDisplay's job (proved in drillDiagramRights.test.ts) and
    // having the rule in two places is how the two would come to disagree.
    const out = html(emptyDiagram())
    expect(out).toContain('class="dd-surface"')
    expect(out).not.toContain('data-el=')
    expect(out).toContain('aria-label="Drill diagram, empty"')
  })
})

// A review of #189 refused the stylesheet's `max-width: calc(var(--dd-cap) *
// var(--dd-ratio, 1))`: calc() multiplying two custom properties is dropped
// whole on iOS Safari 18.x and Chromium before 140, and a dropped width cap
// leaves the height cap standing alone, which is the letterboxed wide-grass box
// the cap existed to prevent. These render the real component and read what it
// actually emits, so the fix is proved in markup rather than in a stylesheet
// comment.
describe('how a session surface is bounded', () => {
  it('emits both caps as plain lengths, with no expression to evaluate', () => {
    const out = html(diagram, 'dd-in-sd', DIAGRAM_HEIGHT_CAP.sessionDay)
    const style = styleOf(out)
    expect(style).toContain('max-height:340px')
    // 680 by 1050 view units capped at 340 tall is 220.1905 wide, and the box
    // then measures the drawing rather than the column.
    expect(style).toContain('max-width:220.1905px')
    // The point of the whole change: nothing here needs typed CSS arithmetic.
    expect(style).not.toContain('calc')
    expect(style).not.toContain('var(')
    expect(style).not.toContain('--dd-')
  })

  it('keeps a viewport cap in viewport units on the live stage', () => {
    const style = styleOf(html(diagram, 'dd-in-live', DIAGRAM_HEIGHT_CAP.live))
    expect(style).toContain('max-height:42vh')
    expect(style).toContain('max-width:27.2vh')
    expect(style).not.toContain('calc')
  })

  it('sizes the width from the surface, not from a constant', () => {
    // The same cap on a landscape pitch allows a wider box, because the width a
    // cap implies is the cap times THAT surface's ratio. A hard coded width
    // would letterbox one orientation or crop the other.
    const portrait = styleOf(html(diagram, 'dd-in-sd', DIAGRAM_HEIGHT_CAP.sessionDay))
    const wide = styleOf(html(landscape, 'dd-in-sd', DIAGRAM_HEIGHT_CAP.sessionDay))
    expect(portrait).not.toEqual(wide)
    expect(portrait).toContain('max-width:220.1905px')
    // 1050 by 680 capped at 340 tall is exactly 525 wide, because 340 is half
    // of 680. A round number here is arithmetic, not a hard coded width.
    expect(wide).toContain('max-width:525px')
  })

  it('caps both dimensions or neither, never height alone', () => {
    // A height cap without its width IS the defect. The renderer cannot emit
    // one without the other, so a surface that asks for a cap it cannot compute
    // gets an uncapped diagram rather than a letterboxed one.
    const uncapped = styleOf(html(diagram, 'dd-in-panel'))
    expect(uncapped).not.toContain('max-height')
    expect(uncapped).not.toContain('max-width')
    const unreadable = styleOf(html(diagram, 'dd-in-sd', 'auto'))
    expect(unreadable).not.toContain('max-height')
    expect(unreadable).not.toContain('max-width')
    // And the aspect ratio survives in every case: it is what the SVG draws to.
    expect(uncapped).toContain('aspect-ratio')
    expect(unreadable).toContain('aspect-ratio')
  })

  it('still carries the surface ratio for the box to keep its shape', () => {
    expect(styleOf(html(diagram))).toContain('aspect-ratio:680 / 1050')
  })
})
