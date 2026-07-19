import { describe, expect, it } from 'vitest'
import {
  batchReference,
  buildImportOperations,
  importFailureReason,
  importOutcomeSentence,
  importRefusalReason,
  importResultCounts,
  type ImportServerResult,
} from './playersImportCommit'
import type { Choice, Plan, PlanRow, PlanSummary } from './playersImportPlan'

// Pure unit coverage for the commit payload and outcome counts: WHAT gets sent
// (only actionable rows, the minimum normalised operation shape, invalid rows
// never sent), and WHAT the outcome screen shows (the non-overlapping partition
// blending server authority with the client preview). No DOM, no writes.

function row(p: Partial<PlanRow> & { rowNumber: number; class: PlanRow['class'] }): PlanRow {
  return {
    playerName: 'Sam Example',
    detail: 'd',
    issues: [],
    warnings: [],
    resolved: { teamId: null, status: 'pending', shirt: null, date: null },
    ...p,
  }
}

function plan(rows: PlanRow[]): Plan {
  return { rows, blankRows: 0, ignoredHeaders: [] }
}

describe('buildImportOperations: only actionable rows, minimum normalised shape', () => {
  it('sends a new row as a new op carrying the name and no player id', () => {
    const p = plan([
      row({
        rowNumber: 2,
        class: 'new',
        playerName: 'Robin New',
        resolved: { teamId: 'team-1', status: 'registered', shirt: 9, date: '2026-07-01' },
      }),
    ])
    const ops = buildImportOperations(p, {})
    expect(ops).toEqual([
      {
        row: 2,
        player_id: null,
        name: 'Robin New',
        team_id: 'team-1',
        status: 'registered',
        shirt_number: 9,
        registered_date: '2026-07-01',
      },
    ])
  })

  it('sends an update row as an update op carrying the player id and no name', () => {
    const p = plan([
      row({
        rowNumber: 3,
        class: 'update',
        matchPlayerId: 'pid-1',
        resolved: { teamId: null, status: 'withdrawn', shirt: null, date: null },
      }),
    ])
    const ops = buildImportOperations(p, {})
    expect(ops).toEqual([
      { row: 3, player_id: 'pid-1', name: null, team_id: null, status: 'withdrawn', shirt_number: null, registered_date: null },
    ])
  })

  it('sends a needs-your-choice row resolved to new, but never one resolved to skip or left unresolved', () => {
    const p = plan([
      row({ rowNumber: 4, class: 'needs_choice', playerName: 'Pat Choice' }),
      row({ rowNumber: 5, class: 'needs_choice', playerName: 'Skip Me' }),
      row({ rowNumber: 6, class: 'needs_choice', playerName: 'Undecided' }),
    ])
    const choices: Record<number, Choice> = { 4: 'new', 5: 'skip' }
    const ops = buildImportOperations(p, choices)
    expect(ops.map((o) => o.row)).toEqual([4])
    expect(ops[0].player_id).toBeNull()
    expect(ops[0].name).toBe('Pat Choice')
  })

  it('never sends invalid or already-present rows', () => {
    const p = plan([
      row({ rowNumber: 2, class: 'invalid', issues: [{ column: 'Team', message: 'x' }] }),
      row({ rowNumber: 3, class: 'already_present', matchPlayerId: 'pid-2' }),
      row({ rowNumber: 4, class: 'new', playerName: 'Only Sent' }),
    ])
    const ops = buildImportOperations(p, {})
    expect(ops.map((o) => o.row)).toEqual([4])
  })

  it('never emits an update op without a resolved player id', () => {
    const p = plan([row({ rowNumber: 2, class: 'update', matchPlayerId: undefined })])
    expect(buildImportOperations(p, {})).toEqual([])
  })
})

function summary(over: Partial<PlanSummary>): PlanSummary {
  return {
    total: 0,
    newCount: 0,
    updateCount: 0,
    alreadyPresent: 0,
    needsChoice: 0,
    invalid: 0,
    warnings: 0,
    unknownTeams: 0,
    unassignedRows: 0,
    blankRows: 0,
    actionable: 0,
    ...over,
  }
}

function serverResult(over: Partial<ImportServerResult>): ImportServerResult {
  return {
    batch_id: '3f2a91c8-0000-4000-8000-000000000001',
    outcome: 'succeeded',
    rows_received: 0,
    added: 0,
    updated: 0,
    already_present: 0,
    resolved_new: 0,
    skipped: 0,
    invalid: 0,
    failure_summary: null,
    settled_at: '2026-07-19T14:32:00Z',
    ...over,
  }
}

describe('importResultCounts: the non-overlapping partition of the preview total', () => {
  it('blends server authority (added, updated, already present) with client withheld (skipped, rejected, warnings)', () => {
    // Preview: 12 new, 3 updates, 1 already present, 2 needs choice (1 -> new,
    // 1 -> skip), 1 invalid, 2 warnings. actionable = 12 + 3 + 1 = 16.
    const s = summary({
      total: 19,
      newCount: 12,
      updateCount: 3,
      alreadyPresent: 1,
      needsChoice: 2,
      invalid: 1,
      warnings: 2,
      actionable: 16,
    })
    // Server: applied 13 adds (12 new + 1 resolved-new), 3 updates, 0 no-op.
    const server = serverResult({ added: 13, updated: 3, already_present: 0 })
    const c = importResultCounts(server, s)
    expect(c).toEqual({ added: 13, updated: 3, alreadyPresent: 1, skipped: 1, rejected: 1, warnings: 2 })
    // The five buckets partition the previewed total (warnings are an overlay).
    expect(c.added + c.updated + c.alreadyPresent + c.skipped + c.rejected).toBe(s.total)
  })

  it('folds a stale-preview no-op update into already present without double counting', () => {
    // Preview: 2 updates. Server found one already present (stale preview).
    const s = summary({ total: 2, updateCount: 2, actionable: 2 })
    const server = serverResult({ added: 0, updated: 1, already_present: 1 })
    const c = importResultCounts(server, s)
    expect(c.updated).toBe(1)
    expect(c.alreadyPresent).toBe(1)
    expect(c.added + c.updated + c.alreadyPresent + c.skipped + c.rejected).toBe(2)
  })
})

describe('presentation helpers', () => {
  it('batchReference is the first eight hex characters', () => {
    expect(batchReference('3f2a91c8-abcd-4000-8000-000000000001')).toBe('Import 3f2a91c8')
  })

  it('importOutcomeSentence lists the five buckets, warnings noted separately by the caller', () => {
    const s = importOutcomeSentence(
      { added: 12, updated: 3, alreadyPresent: 1, skipped: 1, rejected: 1, warnings: 2 },
      '2026/27',
    )
    expect(s).toBe('Imported into 2026/27: 12 added, 3 updated, 1 already present, 1 skipped, 1 rejected.')
    expect(s).not.toContain('warning')
  })

  it('importFailureReason surfaces the safe server summary, and falls back when absent', () => {
    expect(importFailureReason('Row 12: the registration status change is not allowed.')).toBe(
      'Row 12: the registration status change is not allowed.',
    )
    expect(importFailureReason(null)).toContain('Re-open the file')
    expect(importFailureReason('   ')).toContain('Re-open the file')
  })

  it('importRefusalReason strips the internal prefix and makes a sentence', () => {
    expect(importRefusalReason('import_players: the selected season is archived and cannot be imported into')).toBe(
      'The selected season is archived and cannot be imported into.',
    )
    expect(importRefusalReason('import_players: requires the players.import capability')).toBe(
      'Requires the players.import capability.',
    )
    expect(importRefusalReason(undefined)).toContain('refused')
  })
})
