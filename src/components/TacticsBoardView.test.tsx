import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TacticsBoardView } from './TacticsBoardView'
import { playerNameMap, type Token } from '../lib/tacticsBoard'

// TacticsBoardView is the read only renderer the editable board and the
// embedded session day view share through PitchMarkings. The suite pins the
// two properties that matter for the embed: the snapshot is static (no drag
// affordances), and names appear only through the resolution map. A token
// carries a playerId, never a name; without a map (a parent, whose players
// query returns nothing anyway) the discs show numbers alone. Static markup,
// no DOM or query client, matching the rest of the suite. All names are
// synthetic fixtures, never real children.

const tokens: Token[] = [
  { id: 'home-7', number: 7, side: 'home', x: 0.5, y: 0.6, playerId: 'p-jordan' },
  { id: 'away-4', number: 4, side: 'away', x: 0.4, y: 0.3, playerId: 'p-sam' },
]

const names = playerNameMap([
  { id: 'p-jordan', displayName: 'Jordan' },
  { id: 'p-sam', displayName: 'Sam' },
])

describe('TacticsBoardView', () => {
  it('renders each token as a numbered disc', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} names={names} />)
    expect(html).toContain('board-disc-static')
    expect(html).toContain('>7<')
    expect(html).toContain('>4<')
  })

  it('has no drag handlers: the discs are static, not buttons', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} names={names} />)
    // The editable pitch renders each disc as a <button>; the read only view
    // renders neither buttons nor inputs, so there is nothing to drag or edit.
    expect(html).not.toContain('<button')
    expect(html).not.toContain('<input')
  })

  it('shows a single word resolved name whole', () => {
    // Jordan and Sam are one word names, so the first name is the whole name.
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} names={names} />)
    expect(html).toContain('title="Jordan">Jordan</span>')
    expect(html).toContain('title="Sam">Sam</span>')
  })

  it('shows the first name only for a multi word name, the full name on the title', () => {
    // A roster resolved name may be a full name; the pitch shows just the
    // first name so the disc stays legible, with the full name on the title.
    const named: Token[] = [{ id: 'home-9', number: 9, side: 'home', x: 0.5, y: 0.6, playerId: 'p-w' }]
    const html = renderToStaticMarkup(
      <TacticsBoardView tokens={named} names={playerNameMap([{ id: 'p-w', displayName: 'William McGrath' }])} />,
    )
    // The visible label text is the first name; the full name is the title.
    expect(html).toContain('title="William McGrath">William</span>')
  })

  it('shows numbers only when no names map is passed: the parent render path', () => {
    // A parent's render passes no map (their players query is never issued
    // and would return nothing), so no name reaches the markup anywhere.
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} />)
    expect(html).toContain('>7<')
    expect(html).toContain('>4<')
    expect(html).not.toContain('Jordan')
    expect(html).not.toContain('Sam')
    expect(html).not.toContain('board-token-label')
  })

  it('falls back to the number alone for a deleted player missing from the map', () => {
    // The token references a player no longer on the roster: the disc renders
    // safely with its number and no label at all.
    const orphan: Token[] = [{ id: 'home-5', number: 5, side: 'home', x: 0.5, y: 0.5, playerId: 'p-gone' }]
    const html = renderToStaticMarkup(<TacticsBoardView tokens={orphan} names={names} />)
    expect(html).toContain('>5<')
    expect(html).not.toContain('board-token-label')
    expect(html).toContain('aria-label="Player 5"')
  })

  it('keeps the full resolved name accessible on the title and the disc aria-label', () => {
    // The visible label is the first name, but the full name is never lost: it
    // stays on the title attribute (hover or tap) and the disc's aria-label, so
    // a screen reader and a long press both reach the whole name.
    const long: Token[] = [{ id: 'home-2', number: 2, side: 'home', x: 0.5, y: 0.6, playerId: 'p-wk' }]
    const html = renderToStaticMarkup(
      <TacticsBoardView tokens={long} names={playerNameMap([{ id: 'p-wk', displayName: 'William McKenzie' }])} />,
    )
    expect(html).toContain('title="William McKenzie">William</span>')
    expect(html).toContain('aria-label="Player 2 William McKenzie"')
    expect(html).toContain('board-token-label-static')
  })
})
