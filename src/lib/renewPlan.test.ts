import { describe, expect, it } from 'vitest'
import {
  defaultRenewSelection,
  isRenewSelectable,
  planRenew,
  renewCounts,
  renewPayloadIds,
  type RenewRow,
} from './renewPlan'
import type { RegisteredPlayer, RegistrationStatus } from './data'

// A synthetic source-season registration. Names invented; never a real child.
function reg(p: {
  playerId: string
  status: RegistrationStatus
  teamId?: string | null
  shirt?: number | null
  name?: string
}): RegisteredPlayer {
  return {
    registrationId: `reg-${p.playerId}`,
    playerId: p.playerId,
    seasonId: 'src',
    teamId: p.teamId ?? null,
    displayName: p.name ?? `Player ${p.playerId}`,
    shirtNumber: p.shirt ?? null,
    status: p.status,
    registeredDate: p.status === 'registered' ? '2025-08-01' : null,
    createdBy: null,
    updatedAt: '2025-08-01T00:00:00Z',
  }
}

describe('planRenew classification', () => {
  const source = [
    reg({ playerId: 'a', status: 'registered', teamId: 't1', shirt: 7 }),
    reg({ playerId: 'b', status: 'pending', teamId: 't2' }),
    reg({ playerId: 'c', status: 'withdrawn', teamId: 't1', shirt: 9 }),
    reg({ playerId: 'd', status: 'registered', teamId: null }),
  ]

  it('classes registered and pending (not in target) as eligible', () => {
    const rows = planRenew(source, [])
    const byId = new Map(rows.map((r) => [r.playerId, r]))
    expect(byId.get('a')!.klass).toBe('eligible')
    expect(byId.get('b')!.klass).toBe('eligible')
    expect(byId.get('d')!.klass).toBe('eligible')
  })

  it('classes a withdrawn source registration as needs_decision', () => {
    const rows = planRenew(source, [])
    expect(rows.find((r) => r.playerId === 'c')!.klass).toBe('needs_decision')
  })

  it('classes a player already in the target season as already_in_target, whatever the source status', () => {
    const rows = planRenew(source, ['a', 'c'])
    const byId = new Map(rows.map((r) => [r.playerId, r]))
    expect(byId.get('a')!.klass).toBe('already_in_target')
    expect(byId.get('c')!.klass).toBe('already_in_target') // already-in-target wins over withdrawn
  })

  it('carries team and shirt onto the row for the preview detail', () => {
    const rows = planRenew(source, [])
    const a = rows.find((r) => r.playerId === 'a')!
    expect(a.teamId).toBe('t1')
    expect(a.shirtNumber).toBe(7)
  })
})

describe('default selection, selectability, counts, payload', () => {
  const source = [
    reg({ playerId: 'a', status: 'registered', teamId: 't1' }),
    reg({ playerId: 'b', status: 'pending' }),
    reg({ playerId: 'c', status: 'withdrawn' }),
    reg({ playerId: 'd', status: 'registered' }),
  ]
  const rows = planRenew(source, ['d']) // d already in target

  it('defaults to selecting every eligible row and nothing else', () => {
    const sel = defaultRenewSelection(rows)
    expect([...sel].sort()).toEqual(['a', 'b'])
  })

  it('marks already_in_target rows as not selectable, others selectable', () => {
    const byId = new Map(rows.map((r) => [r.playerId, r]))
    expect(isRenewSelectable(byId.get('a')!)).toBe(true)
    expect(isRenewSelectable(byId.get('c')!)).toBe(true) // withdrawn is selectable (a choice)
    expect(isRenewSelectable(byId.get('d')!)).toBe(false)
  })

  it('counts the partition and the current selection', () => {
    const sel = defaultRenewSelection(rows)
    const c = renewCounts(rows, sel)
    expect(c).toEqual({ total: 4, eligible: 2, needsDecision: 1, alreadyInTarget: 1, selected: 2 })
  })

  it('builds the payload from selectable, selected rows only', () => {
    // Manually include the withdrawn c and (invalidly) d; d is not selectable so
    // it never reaches the payload even if present in the set.
    const sel = new Set(['a', 'c', 'd'])
    expect(renewPayloadIds(rows, sel).sort()).toEqual(['a', 'c'])
  })

  it('an empty selection yields an empty payload', () => {
    expect(renewPayloadIds(rows, new Set())).toEqual([])
  })
})

describe('RenewRow shape is stable for the modal', () => {
  it('exposes exactly the fields the preview and payload need', () => {
    const rows: RenewRow[] = planRenew([reg({ playerId: 'a', status: 'registered', teamId: 't1', shirt: 3 })], [])
    expect(Object.keys(rows[0]).sort()).toEqual([
      'displayName',
      'klass',
      'playerId',
      'shirtNumber',
      'sourceStatus',
      'teamId',
    ])
  })
})
