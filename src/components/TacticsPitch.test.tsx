import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TacticsPitch } from './TacticsPitch'
import { deserializeTokens, formationPositions, serializeTokens } from '../lib/tacticsBoard'

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

  it('places a saved board onto the pitch when loaded', () => {
    // The save and load path: a board's tokens go through the stored jsonb
    // shape and come back, then render. Loading places one disc per saved
    // token, at the saved positions.
    const saved = [...formationPositions('3-2-3', 'home'), ...formationPositions('1-2-1', 'away')]
    const loaded = deserializeTokens(serializeTokens(saved))
    const html = renderToStaticMarkup(<TacticsPitch tokens={loaded} onMove={noop} onLabel={noop} />)
    expect(discCount(html)).toBe(saved.length)
    // A known token lands at its saved fraction (left and top percentages).
    const gk = loaded[0]
    expect(html).toContain(`left:${gk.x * 100}%`)
    expect(html).toContain(`top:${gk.y * 100}%`)
  })
})
