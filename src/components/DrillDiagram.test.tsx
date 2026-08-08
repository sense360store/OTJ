import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DrillDiagram, DrillDiagramFrame } from './DrillDiagram'
import {
  FIXTURE_ONE_V_ONE,
  FIXTURE_PASSING_SQUARE,
  FIXTURE_SMALL_SIDED_GAME,
} from '../lib/drillLayoutFixtures'

// The read only renderer over the shipped fixtures: every entity kind has
// a glyph, the arrow notation is the standard coaching one (solid pass,
// dashed run, wavy dribble, double headed shot), positions are scale true
// to the declared area, and every phase is in the DOM so print can show
// them all while the screen shows one. Static markup, no DOM, matching
// the rest of the suite.

const square = () => renderToStaticMarkup(<DrillDiagram layout={FIXTURE_PASSING_SQUARE} />)
const duel = () => renderToStaticMarkup(<DrillDiagram layout={FIXTURE_ONE_V_ONE} />)
const game = () => renderToStaticMarkup(<DrillDiagram layout={FIXTURE_SMALL_SIDED_GAME} />)

describe('DrillDiagram glyphs', () => {
  it('draws every piece of the passing square: cones, players with labels, the ball', () => {
    const html = square()
    expect(html.match(/dg-cone/g)).toHaveLength(4)
    expect(html.match(/dg-team-attack/g)).toHaveLength(4)
    expect(html.match(/class="dg-ball"/g)).toHaveLength(1)
    for (const label of ['>A<', '>B<', '>C<', '>D<']) expect(html).toContain(label)
  })

  it('positions are scale true: a cone one metre in on a 12 metre grid sits at one twelfth', () => {
    const html = square()
    // k = 600 / 12 = 50, so the (1, 1) cone's triangle apex is at x 50.
    expect(html).toContain('M 50 41')
    // The area outline spans the full 600 units.
    expect(html).toContain('width="600"')
  })

  it('draws goals and mini goals as open mouthed frames with rotation about their centre', () => {
    const duelHtml = duel()
    expect(duelHtml).toContain('dg-mini-goal')
    expect(duelHtml).toContain('rotate(90 560 200)') // mini goal at (14, 5) on a 15 by 10 area, k = 40
    const gameHtml = game()
    expect(gameHtml.match(/dg-goal/g)!.length).toBeGreaterThanOrEqual(2)
    expect(gameHtml).toContain('rotate(270 16 200)') // left goal at (0.8, 10), k = 20
  })

  it('draws the small sided game roster: mannequin free, keepers labelled GK', () => {
    const html = game()
    expect(html).not.toContain('dg-mannequin')
    expect(html.match(/>GK</g)).toHaveLength(2)
    expect(html.match(/dg-team-defence/g)).toHaveLength(5)
  })

  it('renders zones as labelled rectangles under the pieces', () => {
    const html = duel()
    expect(html).toContain('dg-zone')
    expect(html).toContain('Duel zone')
    const gameHtml = game()
    expect(gameHtml).toContain('Midfield build zone')
    // Zones render before entities, so the pieces sit on top.
    expect(gameHtml.indexOf('dg-zone')).toBeLessThan(gameHtml.indexOf('dg-goal'))
  })
})

describe('DrillDiagram arrow notation', () => {
  it('a pass is a solid line with the single head, never the double', () => {
    const html = square()
    expect(html.match(/dg-arrow-pass/g)).toHaveLength(4)
    // Every pass references the single head marker; the double head is
    // defined but unreferenced in a drill with no shot.
    expect(html.match(/class="dg-arrow dg-arrow-pass"[^>]*marker-end="url\(#dg-head-/g)).toHaveLength(4)
    expect(html).not.toMatch(/marker-end="url\(#dg-head2-[^"]*"[^>]*class="dg-arrow dg-arrow-pass"/)
  })

  it('a run is dashed, a dribble is wavy, a shot carries the double head', () => {
    const html = duel()
    expect(html).toContain('dg-arrow-run')
    expect(html).toContain('dg-arrow-shot')
    // The dribble is a path of quadratic half waves, not a straight line.
    const dribble = html.match(/class="dg-arrow dg-arrow-dribble" d="([^"]+)"/)
    expect(dribble).not.toBeNull()
    expect(dribble![1].match(/Q/g)!.length).toBeGreaterThanOrEqual(2)
    // The shot references the double head marker, the pass the single.
    const shot = html.match(/dg-arrow-shot[^/]*marker-end="url\(#(dg-head2[^)"]*)\)"/)
    expect(shot).not.toBeNull()
  })
})

describe('DrillDiagram phases', () => {
  it('a single phase drill has no stepper', () => {
    const html = square()
    expect(html).not.toContain('drill-diagram-stepper')
    expect(html.match(/drill-diagram-frame/g)).toHaveLength(1)
  })

  it('a two phase drill renders both frames with only the first active, and a stepper', () => {
    const html = duel()
    expect(html.match(/drill-diagram-frame active/g)).toHaveLength(1)
    expect(html.match(/<figure/g)).toHaveLength(2)
    expect(html).toContain('drill-diagram-stepper')
    expect(html).toContain('>Phase 1<')
    expect(html).toContain('>Phase 2<')
    expect(html).toContain('aria-pressed="true"')
  })

  it('phase notes render as figure captions', () => {
    const html = duel()
    expect(html).toContain('Server feeds the attacker to start the duel.')
    expect(html).toContain('Attacker takes on the defender and finishes.')
    expect(html.match(/<figcaption/g)).toHaveLength(2)
  })

  it('names the diagram for assistive technology and shows the true area size', () => {
    const html = duel()
    expect(html).toContain('aria-label="Phase 1 diagram"')
    expect(html).toContain('15 × 10 m')
  })
})

describe('DrillDiagramFrame', () => {
  it('is static markup: no buttons or inputs inside the drawing itself', () => {
    const html = renderToStaticMarkup(
      <DrillDiagramFrame layout={FIXTURE_PASSING_SQUARE} frame={FIXTURE_PASSING_SQUARE.frames[0]} index={0} active />,
    )
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
    expect(html).toContain('<svg')
  })
})
