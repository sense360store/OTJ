import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionBoardCardView } from './SessionDay'
import { playerNameMap, type Board } from '../lib/tacticsBoard'

// SessionBoardCardView is the session day's attached board section pulled out
// as a presentational component, so the read only embed and the attach
// affordances render without the data hooks or a query client, the same style
// as ActivityCardView. The container resolves the board, builds the name map
// only for a sessions.create holder, and wires the link mutation; here the
// board and the map are plain fixtures. Names are synthetic, never real
// children.

const board: Board = {
  id: 'b1',
  name: 'Titans 2-3-1 high press',
  formation: '2-3-1',
  teamId: 't1',
  tokens: [{ id: 'home-7', number: 7, side: 'home', x: 0.5, y: 0.6, playerId: 'p-jordan' }],
  createdBy: 'u1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const names = playerNameMap([{ id: 'p-jordan', displayName: 'Jordan' }])

const noop = () => {}

describe('SessionBoardCardView', () => {
  it('renders the read only board for a session with one attached', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={board}
        boardId="b1"
        canEdit={false}
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain('Titans 2-3-1 high press')
    // The read only renderer, not the editable pitch.
    expect(html).toContain('board-disc-static')
    expect(html).toContain('>7<')
    expect(html).not.toContain('<button')
  })

  it('resolves names for a coach through the names map', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={board}
        boardId="b1"
        names={names}
        canEdit
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain('>7<')
    expect(html).toContain('Jordan')
  })

  it('shows numbers not names to a parent: no map, and no name in the board itself', () => {
    // The parent path passes no names map. The board's tokens carry player
    // ids only, so there is no name anywhere in the render's inputs, not just
    // none in its output.
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={board}
        boardId="b1"
        canEdit={false}
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain('>7<')
    expect(html).not.toContain('Jordan')
    expect(JSON.stringify(board.tokens)).not.toContain('Jordan')
  })

  it('renders nothing when no board is attached and the viewer cannot edit', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={null}
        boardId={null}
        canEdit={false}
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toBe('')
  })

  it('offers an attach control when nothing is attached but the viewer can edit', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={null}
        boardId={null}
        canEdit
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain('Attach')
    expect(html).toContain('No board attached')
  })

  it('constrains the empty state placeholder icon and uses the muted theme colour', () => {
    // The bug: the board card's heading icon carried no size, so it expanded to
    // fill the card as a giant dark chevron. It must render at a small fixed
    // size and in the muted empty-state colour, never as a fill-the-container
    // graphic that reads as a dark mode element on the light page.
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={null}
        boardId={null}
        canEdit
        onAttach={noop}
        onRemove={noop}
      />,
    )
    // A small fixed size, not a percentage that lets it fill the panel.
    expect(html).toContain('width="20"')
    expect(html).toContain('height="20"')
    expect(html).not.toContain('width="100%"')
    // The muted empty-state token (--slate-2, as .empty svg uses), not a heavy
    // dark fill inherited from the page ink.
    expect(html).toContain('var(--slate-2)')
  })
})
