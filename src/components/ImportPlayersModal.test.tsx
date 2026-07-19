import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ImportOutcomeBody, PreviewRow, type Outcome } from './ImportPlayersModal'
import type { PlanRow } from '../lib/playersImportPlan'

// The interactive modal orchestration (file pick, query, confirm, pending) is
// exercised by the pure parse/plan/commit suites and the security suite (server
// idempotency and refusals); here the presentational preview row and the outcome
// screen are pinned with the static renderer, the house style (Players.test.tsx).
// These prove the accessibility affordances: the class word is always shown
// (never colour alone), the needs-your-choice controls are real buttons with a
// pressed state, warnings render as adjacent text, the controls disable while a
// confirm is in flight, and the outcome screen renders safe counts only.

function row(p: Partial<PlanRow> & { rowNumber: number; class: PlanRow['class'] }): PlanRow {
  return {
    playerName: 'Sam Example',
    detail: 'detail line',
    issues: [],
    warnings: [],
    ...p,
  }
}

function render(r: PlanRow, choice?: 'skip' | 'new', disabled?: boolean) {
  return renderToStaticMarkup(<PreviewRow row={r} choice={choice} onChoose={() => {}} disabled={disabled} />)
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

  it('disables the resolution controls while a confirm is in flight', () => {
    const html = render(row({ rowNumber: 4, class: 'needs_choice' }), undefined, true)
    // Both Skip and Import as new render as disabled buttons.
    expect((html.match(/disabled/g) ?? []).length).toBe(2)
  })
})

describe('ImportOutcomeBody: the outcome screen renders safe counts only', () => {
  it('shows the success sentence, the warnings note and the batch reference', () => {
    const outcome: Outcome = {
      kind: 'success',
      counts: { added: 12, updated: 3, alreadyPresent: 1, skipped: 1, rejected: 1, warnings: 2 },
      warnings: 2,
      batchId: '3f2a91c8-abcd-4000-8000-000000000001',
      settledAt: '2026-07-19T14:32:00Z',
    }
    const html = renderToStaticMarkup(<ImportOutcomeBody outcome={outcome} seasonName="2026/27" />)
    expect(html).toContain('Imported into 2026/27: 12 added, 3 updated, 1 already present, 1 skipped, 1 rejected.')
    expect(html).toContain('2 of these carried warnings.')
    expect(html).toContain('Import 3f2a91c8')
  })

  it('renders a failure as a role=alert block that states nothing was imported', () => {
    const outcome: Outcome = { kind: 'failure', reason: 'The selected season is archived and cannot be imported into.' }
    const html = renderToStaticMarkup(<ImportOutcomeBody outcome={outcome} seasonName="2026/27" />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('Nothing was imported.')
    expect(html).toContain('archived')
  })
})
