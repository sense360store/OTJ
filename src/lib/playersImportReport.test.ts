import { describe, expect, it } from 'vitest'
import type { Plan, PlanRow } from './playersImportPlan'
import {
  buildIssuesReportCsv,
  buildIssuesReportRows,
  hasReportableIssues,
  importIssuesFilename,
} from './playersImportReport'

function row(p: Partial<PlanRow> & { rowNumber: number; class: PlanRow['class'] }): PlanRow {
  return {
    playerName: 'Sam',
    detail: '',
    issues: [],
    warnings: [],
    ...p,
  }
}
function plan(rows: PlanRow[]): Plan {
  return { rows, blankRows: 0, ignoredHeaders: [] }
}

describe('buildIssuesReportRows', () => {
  it('emits one row per invalid reason and per warning, and nothing for clean rows', () => {
    const p = plan([
      row({ rowNumber: 2, class: 'new' }), // clean, contributes nothing
      row({
        rowNumber: 3,
        class: 'invalid',
        playerName: 'Bad Row',
        issues: [
          { column: 'Team', message: 'Unknown team "X".' },
          { column: 'Shirt Number', message: 'Shirt number "150" must be a whole number from 1 to 99.' },
        ],
      }),
      row({
        rowNumber: 4,
        class: 'new',
        playerName: 'Warned',
        warnings: [{ column: 'Registered Date', message: 'read as day/month/year.' }],
      }),
    ])
    const rows = buildIssuesReportRows(p)
    expect(rows).toEqual([
      ['3', 'Bad Row', 'Team', 'Unknown team "X".'],
      ['3', 'Bad Row', 'Shirt Number', 'Shirt number "150" must be a whole number from 1 to 99.'],
      ['4', 'Warned', 'Registered Date', 'read as day/month/year.'],
    ])
  })
})

describe('hasReportableIssues', () => {
  it('is true when any invalid or warning row exists, false otherwise', () => {
    expect(hasReportableIssues(plan([row({ rowNumber: 2, class: 'new' })]))).toBe(false)
    expect(
      hasReportableIssues(plan([row({ rowNumber: 2, class: 'invalid', issues: [{ column: 'Team', message: 'x' }] })])),
    ).toBe(true)
    expect(
      hasReportableIssues(
        plan([row({ rowNumber: 2, class: 'new', warnings: [{ column: 'Registered Date', message: 'x' }] })]),
      ),
    ).toBe(true)
    // A needs-your-choice row is neither rejected nor a warning: not reportable.
    expect(hasReportableIssues(plan([row({ rowNumber: 2, class: 'needs_choice' })]))).toBe(false)
  })
})

describe('buildIssuesReportCsv formula safety', () => {
  it('neutralises a name that could be read as a formula with a leading apostrophe', () => {
    const p = plan([
      row({
        rowNumber: 2,
        class: 'invalid',
        playerName: '=cmd|calc',
        issues: [{ column: 'Player Name', message: 'bad' }],
      }),
    ])
    // No CSV metacharacter, so guarded but not quoted.
    expect(buildIssuesReportCsv(p)).toContain("'=cmd|calc")
  })

  it('guards and quotes a formula name that also contains a comma', () => {
    const p = plan([
      row({
        rowNumber: 2,
        class: 'invalid',
        playerName: '=1,2',
        issues: [{ column: 'Player Name', message: 'bad' }],
      }),
    ])
    expect(buildIssuesReportCsv(p)).toContain(`"'=1,2"`)
  })
})

describe('importIssuesFilename', () => {
  it('carries the timestamp only, never player data', () => {
    const name = importIssuesFilename(new Date(2026, 6, 19, 14, 32))
    expect(name).toBe('registered-players-import-issues-20260719-1432.csv')
  })
})
