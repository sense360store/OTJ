import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillDiagramView } from './DrillDiagramView'
import { emptyDiagram, type DiagramElement, type DrillDiagram } from '../lib/drillDiagram'
import { surfaceSize } from '../lib/drillDiagramGeometry'

// The canonical read only renderer. This project has no DOM under test, so the
// static renderer is what proves a diagram draws: it covers the markings, all
// seven element types, the surfaces, and the one rule that separates this from
// the editor, which is that it carries no editor chrome at all.

function render(elements: DiagramElement[], over: Partial<DrillDiagram> = {}): string {
  return renderToStaticMarkup(<DrillDiagramView diagram={{ ...emptyDiagram(), elements, ...over }} />)
}

const ALL: DiagramElement[] = [
  { type: 'zone', id: 'zone-1', x: 0.1, y: 0.1, w: 0.4, h: 0.3, colour: 'yellow' },
  { type: 'goal', id: 'goal-1', x: 0.5, y: 0.06, width: 0.24, facing: 'up' },
  { type: 'cone', id: 'cone-1', x: 0.2, y: 0.3, colour: 'orange' },
  { type: 'player', id: 'player-1', x: 0.5, y: 0.5, colour: 'blue', label: '9' },
  { type: 'ball', id: 'ball-1', x: 0.45, y: 0.55 },
  { type: 'arrow', id: 'arrow-1', x1: 0.2, y1: 0.8, x2: 0.7, y2: 0.4, arrow: 'pass' },
  { type: 'text', id: 'text-1', x: 0.5, y: 0.92, text: 'Press' },
]

describe('drawing a diagram', () => {
  it('draws one shape per element, all seven types', () => {
    const html = render(ALL)
    for (const el of ALL) expect(html, `${el.type} is missing`).toContain(`data-el="${el.type}"`)
  })

  it('draws nothing but the surface for an empty diagram', () => {
    const html = render([])
    expect(html).toContain('dd-svg')
    expect(html).not.toContain('data-el=')
  })

  it('draws the pitch markings on a full pitch', () => {
    expect(render([])).toContain('dd-lines')
  })

  it('draws a different pitch for a half pitch', () => {
    const full = render([], { surface: { kind: 'full_pitch', orientation: 'portrait' } })
    const half = render([], { surface: { kind: 'half_pitch', orientation: 'portrait' } })
    expect(half).not.toBe(full)
    expect(half).toContain('dd-lines')
  })

  it('draws no markings at all on a blank area', () => {
    expect(render([], { surface: { kind: 'blank', orientation: 'portrait' } })).not.toContain('dd-lines')
  })

  it('sizes its viewBox from the surface, and turns it with the orientation', () => {
    const portrait = surfaceSize({ kind: 'full_pitch', orientation: 'portrait' })
    const landscape = surfaceSize({ kind: 'full_pitch', orientation: 'landscape' })
    expect(render([])).toContain(`viewBox="0 0 ${portrait.width} ${portrait.height}"`)
    expect(render([], { surface: { kind: 'full_pitch', orientation: 'landscape' } })).toContain(
      `viewBox="0 0 ${landscape.width} ${landscape.height}"`,
    )
  })
})

describe('geometry is normalised, never pixels', () => {
  it('places an element from its fraction, scaled to the surface box', () => {
    const s = surfaceSize({ kind: 'full_pitch', orientation: 'portrait' })
    const html = render([{ type: 'ball', id: 'ball-1', x: 0.5, y: 0.5 }])
    expect(html).toContain(`cx="${s.width / 2}"`)
    expect(html).toContain(`cy="${s.height / 2}"`)
  })

  it('puts the same fraction somewhere else when the surface changes shape', () => {
    const a = render([{ type: 'ball', id: 'ball-1', x: 0.5, y: 0.5 }])
    const b = render([{ type: 'ball', id: 'ball-1', x: 0.5, y: 0.5 }], {
      surface: { kind: 'full_pitch', orientation: 'landscape' },
    })
    expect(a).not.toBe(b)
  })

  it('holds the surface aspect so the diagram never distorts', () => {
    const s = surfaceSize({ kind: 'half_pitch', orientation: 'portrait' })
    expect(render([], { surface: { kind: 'half_pitch', orientation: 'portrait' } })).toContain(
      `aspect-ratio:${s.width} / ${s.height}`,
    )
  })
})

describe('an arrow reads as an arrow', () => {
  it('draws a head, so its direction is visible', () => {
    expect(render([{ type: 'arrow', id: 'a1', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8, arrow: 'run' }])).toContain('dd-arrowhead')
  })

  it('points the head the other way when the arrow is reversed', () => {
    const forward = render([{ type: 'arrow', id: 'a1', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8, arrow: 'run' }])
    const back = render([{ type: 'arrow', id: 'a1', x1: 0.8, y1: 0.8, x2: 0.2, y2: 0.2, arrow: 'run' }])
    expect(forward).not.toBe(back)
  })

  it('tells a run, a pass and a dribble apart by line, not by colour alone', () => {
    const base = { type: 'arrow' as const, id: 'a1', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8 }
    const run = render([{ ...base, arrow: 'run' }])
    const pass = render([{ ...base, arrow: 'pass' }])
    const dribble = render([{ ...base, arrow: 'dribble' }])
    expect(new Set([run, pass, dribble]).size).toBe(3)
    // The difference is the stroke pattern and the path shape, not the colour.
    expect(pass).toContain('stroke-dasharray')
    expect(run).not.toContain('stroke-dasharray')
    expect(dribble).toContain('dd-wave')
  })

  it('draws a degenerate arrow without producing NaN in the markup', () => {
    const html = render([{ type: 'arrow', id: 'a1', x1: 0.5, y1: 0.5, x2: 0.5, y2: 0.5, arrow: 'run' }])
    expect(html).not.toMatch(/NaN/)
  })

  it('carries a text description, so an arrow is not colour or shape only', () => {
    expect(render([{ type: 'arrow', id: 'a1', x1: 0.2, y1: 0.2, x2: 0.8, y2: 0.8, arrow: 'dribble' }])).toContain('Dribble')
  })
})

describe('a zone is bounded', () => {
  it('draws a rectangle at the stored size', () => {
    const s = surfaceSize({ kind: 'full_pitch', orientation: 'portrait' })
    const html = render([{ type: 'zone', id: 'z1', x: 0.1, y: 0.2, w: 0.5, h: 0.25, colour: 'yellow' }])
    expect(html).toContain(`width="${s.width * 0.5}"`)
    expect(html).toContain(`height="${s.height * 0.25}"`)
  })

  it('never draws a negative size', () => {
    const html = render([{ type: 'zone', id: 'z1', x: 0.5, y: 0.5, w: 0.3, h: 0.3, colour: 'red' }])
    expect(html).not.toMatch(/(width|height)="-/)
  })
})

describe('labels', () => {
  it('shows the coaching label', () => {
    expect(render([{ type: 'text', id: 't1', x: 0.5, y: 0.5, text: 'Rotate' }])).toContain('Rotate')
  })

  it('escapes a label rather than letting it become markup', () => {
    const html = render([{ type: 'text', id: 't1', x: 0.5, y: 0.5, text: '<b>x</b>' }])
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;b&gt;')
  })

  it('shows a player badge inside the disc', () => {
    expect(render([{ type: 'player', id: 'p1', x: 0.5, y: 0.5, colour: 'blue', label: '10' }])).toContain('>10<')
  })

  it('draws a player with no badge as a plain disc', () => {
    const html = render([{ type: 'player', id: 'p1', x: 0.5, y: 0.5, colour: 'blue', label: '' }])
    expect(html).toContain('data-el="player"')
  })
})

describe('the read only renderer carries no editor chrome', () => {
  it('has no buttons, no handles and no selection state', () => {
    const html = render(ALL)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('aria-pressed')
    expect(html).not.toContain('dd-handle')
    expect(html).not.toContain('dd-selected')
    expect(html).not.toContain('tabindex')
  })

  it('is a picture to assistive technology, with a description of what it holds', () => {
    const html = render(ALL)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label')
  })

  it('describes the diagram by what is on it, not as a blank image', () => {
    const html = render([
      { type: 'player', id: 'p1', x: 0.2, y: 0.2, colour: 'blue', label: '' },
      { type: 'player', id: 'p2', x: 0.3, y: 0.3, colour: 'red', label: '' },
      { type: 'cone', id: 'c1', x: 0.4, y: 0.4, colour: 'orange' },
    ])
    expect(html).toContain('2 players')
    expect(html).toContain('1 cone')
  })

  it('does not suppress touch, so the page still scrolls over a diagram on a drill page', () => {
    expect(render(ALL)).not.toContain('touch-action:none')
  })
})
