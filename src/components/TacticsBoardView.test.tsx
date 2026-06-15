import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TacticsBoardView } from './TacticsBoardView'
import type { Token } from '../lib/tacticsBoard'

// TacticsBoardView is the read only renderer the editable board and the
// embedded session day view share through PitchMarkings. The suite pins the
// two properties that matter for the embed: the snapshot is static (no drag
// affordances), and a parent's view shows numbers only, never the roster names
// a board may carry in its labels. Static markup, no DOM or query client,
// matching the rest of the suite.

const tokens: Token[] = [
  { id: 'home-7', number: 7, label: 'Jordan', side: 'home', x: 0.5, y: 0.6 },
  { id: 'away-4', number: 4, label: 'Sam', side: 'away', x: 0.4, y: 0.3 },
]

describe('TacticsBoardView', () => {
  it('renders each token as a numbered disc', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} />)
    expect(html).toContain('board-disc-static')
    expect(html).toContain('>7<')
    expect(html).toContain('>4<')
  })

  it('has no drag handlers: the discs are static, not buttons', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} />)
    // The editable pitch renders each disc as a <button> with pointer
    // handlers and labels as <input>; the read only view renders neither, so
    // there is nothing to drag or edit.
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
  })

  it('shows a single word label whole', () => {
    // Jordan and Sam are one word names, so the first name is the whole name.
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} />)
    expect(html).toContain('title="Jordan">Jordan</span>')
    expect(html).toContain('title="Sam">Sam</span>')
  })

  it('shows the first name only for a multi word name, the full name on the title', () => {
    // A board seeded from a roster carries full names; the pitch shows just the
    // first name so the disc stays legible, with the full name on the title.
    const named: Token[] = [
      { id: 'home-9', number: 9, label: 'William McGrath', side: 'home', x: 0.5, y: 0.6 },
    ]
    const html = renderToStaticMarkup(<TacticsBoardView tokens={named} />)
    // The visible label text is the first name; the full name is the title.
    expect(html).toContain('title="William McGrath">William</span>')
  })

  it('shows numbers only when numberOnly is set, hiding roster names', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} numberOnly />)
    expect(html).toContain('>7<')
    expect(html).toContain('>4<')
    // No name reaches the markup, in the label or the aria-label.
    expect(html).not.toContain('Jordan')
    expect(html).not.toContain('Sam')
  })

  it('keeps the full display name accessible on the title and the disc aria-label', () => {
    // The visible label is the first name, but the full name is never lost: it
    // stays on the title attribute (hover or tap) and the disc's aria-label, so
    // a screen reader and a long press both reach the whole name. The first name
    // alone is what renders, and the rare long first name still truncates with
    // an ellipsis via the kept label fit styling.
    const long: Token[] = [{ id: 'home-2', number: 2, label: 'William McKenzie', side: 'home', x: 0.5, y: 0.6 }]
    const html = renderToStaticMarkup(<TacticsBoardView tokens={long} />)
    expect(html).toContain('title="William McKenzie">William</span>')
    expect(html).toContain('aria-label="Player 2 William McKenzie"')
    expect(html).toContain('board-token-label-static')
  })
})
