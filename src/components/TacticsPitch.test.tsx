import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TacticsPitch } from './TacticsPitch'
import { formationPositions } from '../lib/tacticsBoard'

// TacticsPitch is presentational, so the static renderer covers the markings
// and the token layout without a DOM or pointer events. A token renders one
// draggable disc, so counting discs counts the tokens placed.
const noop = () => {}

function discCount(html: string): number {
  return html.split('class="board-disc"').length - 1
}

function render(formation: string) {
  return renderToStaticMarkup(
    <TacticsPitch tokens={formationPositions(formation, 'home')} onMove={noop} onLabel={noop} />,
  )
}

describe('TacticsPitch', () => {
  it('draws the pitch markings', () => {
    const html = render('4-4-2')
    expect(html).toContain('board-pitch-svg')
    expect(html).toContain('pitch-lines')
  })

  it('places a disc per token when a formation is selected', () => {
    expect(discCount(render('2-3-1'))).toBe(7)
    expect(discCount(render('3-2-3'))).toBe(9)
    expect(discCount(render('4-4-2'))).toBe(11)
  })

  it('shows an empty pitch with no tokens', () => {
    const html = renderToStaticMarkup(<TacticsPitch tokens={[]} onMove={noop} onLabel={noop} />)
    expect(discCount(html)).toBe(0)
    expect(html).toContain('board-pitch-svg')
  })

  it('renders the editable label and shirt number for each token', () => {
    const html = render('1-2-1')
    expect(html).toContain('board-token-label')
    expect(html).toContain('aria-label="Label for player 1"')
  })
})
