import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TacticsPitch } from './TacticsPitch'
import { deserializeTokens, formationPositions, serializeTokens, type Token } from '../lib/tacticsBoard'

// TacticsPitch is presentational, so the static renderer covers the markings,
// the token layout, the first name labels and the selected state without a DOM
// or pointer events. The tap-to-select and drag gestures live behind pointer
// events that need a DOM to fire; the selection state they set is what this
// suite pins by passing selectedId straight in, and the tap-versus-drag
// threshold is pinned at the helper level (see tacticsBoard.test.ts isDrag).
const noop = () => {}

function discCount(html: string): number {
  return html.split('class="board-disc"').length - 1
}

// Render the pitch with no selection unless one is named.
function render(tokens: Token[], selectedId: string | null = null) {
  return renderToStaticMarkup(
    <TacticsPitch tokens={tokens} selectedId={selectedId} onMove={noop} onSelect={noop} onDelete={noop} />,
  )
}

describe('TacticsPitch', () => {
  it('draws the pitch markings', () => {
    const html = render(formationPositions('4-4-2', 'home'))
    expect(html).toContain('board-pitch-svg')
    expect(html).toContain('pitch-lines')
  })

  it('places a disc per token when a formation is selected', () => {
    expect(discCount(render(formationPositions('2-3-1', 'home')))).toBe(7)
    expect(discCount(render(formationPositions('3-2-3', 'home')))).toBe(9)
    expect(discCount(render(formationPositions('4-4-2', 'home')))).toBe(11)
  })

  it('shows an empty pitch with no tokens', () => {
    const html = render([])
    expect(discCount(html)).toBe(0)
    expect(html).toContain('board-pitch-svg')
  })

  it('renders each token as a selectable button disc, not an editable input', () => {
    // The disc is a button that drags and selects; there is no per token label
    // input any more, so the label is a static first name display instead.
    const html = render(formationPositions('1-2-1', 'home'))
    expect(html).toContain('class="board-disc"')
    expect(html).toContain('aria-label="Player 1"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).not.toContain('<input')
  })

  it('shows the first name as the label, the full name on the title', () => {
    // A board seeded from a roster carries full names; the disc shows the first
    // name and keeps the full name on the title and the disc aria-label.
    const named: Token[] = [
      { id: 'home-9', number: 9, label: 'William McGrath', side: 'home', x: 0.5, y: 0.6 },
      { id: 'home-4', number: 4, label: 'Theo', side: 'home', x: 0.4, y: 0.7 },
    ]
    const html = render(named)
    // Multi word name shows the first name visibly, full name on the title.
    expect(html).toContain('title="William McGrath">William</span>')
    expect(html).toContain('aria-label="Player 9 William McGrath"')
    // Single word name stays whole.
    expect(html).toContain('title="Theo">Theo</span>')
  })

  it('marks the selected token with a ring class and aria-pressed, the others not', () => {
    const tokens = formationPositions('1-2-1', 'home')
    const selected = tokens[2]
    const html = render(tokens, selected.id)
    // The selected disc carries the ring class and the pressed state.
    expect(html).toContain('class="board-disc selected"')
    expect(html).toContain('aria-pressed="true"')
    // Exactly one disc is selected; the rest are present and not pressed.
    expect(html.split('aria-pressed="true"').length - 1).toBe(1)
    expect(html).toContain('aria-pressed="false"')
  })

  it('shows no selection when selectedId matches nothing', () => {
    const html = render(formationPositions('1-2-1', 'home'), 'no-such-id')
    expect(html).not.toContain('board-disc selected')
    expect(html).not.toContain('aria-pressed="true"')
  })

  it('places a saved board onto the pitch when loaded', () => {
    // The save and load path: a board's tokens go through the stored jsonb
    // shape and come back, then render. Loading places one disc per saved
    // token, at the saved positions.
    const saved = [...formationPositions('3-2-3', 'home'), ...formationPositions('1-2-1', 'away')]
    const loaded = deserializeTokens(serializeTokens(saved))
    const html = render(loaded)
    expect(discCount(html)).toBe(saved.length)
    // A known token lands at its saved fraction (left and top percentages).
    const gk = loaded[0]
    expect(html).toContain(`left:${gk.x * 100}%`)
    expect(html).toContain(`top:${gk.y * 100}%`)
  })
})
