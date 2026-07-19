import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PreviewRow } from './ImportPlayersModal'
import type { PlanRow } from '../lib/playersImportPlan'

// The interactive modal orchestration (file pick, query, state) is exercised by
// the pure parse/plan/report suites; here the presentational preview row is
// pinned with the static renderer, the house style (Players.test.tsx). These
// prove the accessibility affordances: the class word is always shown (never
// colour alone), the needs-your-choice controls are real buttons with a pressed
// state, and warnings render as adjacent text.

function row(p: Partial<PlanRow> & { rowNumber: number; class: PlanRow['class'] }): PlanRow {
  return {
    playerName: 'Sam Example',
    detail: 'detail line',
    issues: [],
    warnings: [],
    ...p,
  }
}

function render(r: PlanRow, choice?: 'skip' | 'new') {
  return renderToStaticMarkup(<PreviewRow row={r} choice={choice} onChoose={() => {}} />)
}

describe('PreviewRow', () => {
  it('shows the class word for each class, never colour alone', () => {
    expect(render(row({ rowNumber: 2, class: 'new' }))).toContain('Will add')
    expect(render(row({ rowNumber: 2, class: 'update' }))).toContain('Will update')
    expect(render(row({ rowNumber: 2, class: 'already_present' }))).toContain('Already present')
    expect(render(row({ rowNumber: 2, class: 'needs_choice' }))).toContain('Needs your choice')
    expect(render(row({ rowNumber: 2, class: 'invalid' }))).toContain('Invalid')
  })

  it('shows the player name, the row number and the detail line', () => {
    const html = render(row({ rowNumber: 7, class: 'new', playerName: 'Robin Sample', detail: 'New player' }))
    expect(html).toContain('Robin Sample')
    expect(html).toContain('Row 7')
    expect(html).toContain('New player')
  })

  it('falls back to (no name) when the file name cell is empty', () => {
    expect(render(row({ rowNumber: 3, class: 'invalid', playerName: '' }))).toContain('(no name)')
  })

  it('renders a needs-your-choice row with real Skip and Import as new buttons', () => {
    const html = render(row({ rowNumber: 4, class: 'needs_choice' }))
    expect(html).toContain('<button')
    expect(html).toContain('Skip')
    expect(html).toContain('Import as new')
    expect(html).toContain('aria-label="Resolve row 4"')
  })

  it('reflects the chosen resolution with aria-pressed', () => {
    const skip = render(row({ rowNumber: 4, class: 'needs_choice' }), 'skip')
    expect(skip).toContain('aria-pressed="true"')
    const asNew = render(row({ rowNumber: 4, class: 'needs_choice' }), 'new')
    // Two controls; exactly one is pressed.
    expect((asNew.match(/aria-pressed="true"/g) ?? []).length).toBe(1)
  })

  it('shows a Warning pill and the warning text on an importable row', () => {
    const html = render(
      row({
        rowNumber: 5,
        class: 'new',
        warnings: [{ column: 'Registered Date', message: 'read as day/month/year.' }],
      }),
    )
    expect(html).toContain('Warning')
    expect(html).toContain('read as day/month/year.')
  })

  it('does not show the needs-your-choice controls on other classes', () => {
    expect(render(row({ rowNumber: 2, class: 'new' }))).not.toContain('Import as new')
  })
})
