import { describe, expect, it } from 'vitest'
import type { PlanSummary } from './playersImportPlan'
import { announceSummary, chipCount, summarySentence } from './playersImportView'

function summary(p: Partial<PlanSummary>): PlanSummary {
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
    ...p,
  }
}

describe('summarySentence', () => {
  it('names only non-zero categories and handles singulars', () => {
    const s = summary({ total: 18, newCount: 12, updateCount: 3, alreadyPresent: 1, needsChoice: 1, invalid: 1 })
    expect(summarySentence(s)).toBe('18 rows: 12 new, 3 updates, 1 already present, 1 needs your choice, 1 invalid.')
  })
  it('reads "1 update" in the singular', () => {
    expect(summarySentence(summary({ total: 1, updateCount: 1 }))).toBe('1 row: 1 update.')
  })
  it('handles a file with only invalid rows', () => {
    expect(summarySentence(summary({ total: 2, invalid: 2 }))).toBe('2 rows: 2 invalid.')
  })
})

describe('announceSummary', () => {
  it('prefixes "Preview ready" and appends a warnings clause when present', () => {
    const s = summary({ total: 3, newCount: 3, warnings: 2 })
    expect(announceSummary(s)).toBe('Preview ready. 3 rows: 3 new. 2 carry warnings.')
  })
  it('omits the warnings clause when there are none', () => {
    expect(announceSummary(summary({ total: 1, newCount: 1 }))).toBe('Preview ready. 1 row: 1 new.')
  })
})

describe('chipCount', () => {
  it('maps each filter key to its count', () => {
    const s = summary({
      total: 10,
      newCount: 4,
      updateCount: 3,
      alreadyPresent: 1,
      needsChoice: 1,
      invalid: 1,
      warnings: 2,
    })
    expect(chipCount(s, 'all')).toBe(10)
    expect(chipCount(s, 'new')).toBe(4)
    expect(chipCount(s, 'update')).toBe(3)
    expect(chipCount(s, 'already_present')).toBe(1)
    expect(chipCount(s, 'needs_choice')).toBe(1)
    expect(chipCount(s, 'invalid')).toBe(1)
    expect(chipCount(s, 'warnings')).toBe(2)
  })
})
