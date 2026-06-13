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

  it('shows the free text labels by default', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} />)
    expect(html).toContain('Jordan')
    expect(html).toContain('Sam')
  })

  it('shows numbers only when numberOnly is set, hiding roster names', () => {
    const html = renderToStaticMarkup(<TacticsBoardView tokens={tokens} numberOnly />)
    expect(html).toContain('>7<')
    expect(html).toContain('>4<')
    // No name reaches the markup, in the label or the aria-label.
    expect(html).not.toContain('Jordan')
    expect(html).not.toContain('Sam')
  })
})
