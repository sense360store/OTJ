import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SessionBoardCardView } from './SessionDay'
import type { Board } from '../lib/tacticsBoard'

// SessionBoardCardView is the session day's attached board section pulled out
// as a presentational component, so the read only embed and the attach
// affordances render without the data hooks or a query client, the same style
// as ActivityCardView. The container resolves the board and wires the link
// mutation; here the board is a plain fixture.

const board: Board = {
  id: 'b1',
  name: 'Titans 2-3-1 high press',
  formation: '2-3-1',
  teamId: 't1',
  tokens: [{ id: 'home-7', number: 7, label: 'Jordan', side: 'home', x: 0.5, y: 0.6 }],
  createdBy: 'u1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-02',
}

const noop = () => {}

describe('SessionBoardCardView', () => {
  it('renders the read only board for a session with one attached', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={board}
        boardId="b1"
        numberOnly={false}
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

  it('shows numbers not names to a parent viewing a roster board', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={board}
        boardId="b1"
        numberOnly
        canEdit={false}
        onAttach={noop}
        onRemove={noop}
      />,
    )
    expect(html).toContain('>7<')
    expect(html).not.toContain('Jordan')
  })

  it('renders nothing when no board is attached and the viewer cannot edit', () => {
    const html = renderToStaticMarkup(
      <SessionBoardCardView
        board={null}
        boardId={null}
        numberOnly={false}
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
        numberOnly={false}
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
        numberOnly={false}
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
