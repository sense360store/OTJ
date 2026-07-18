import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILTERS,
  DEFAULT_STATUS_FILTER,
  deleteConfirmed,
  describeHistoryEntry,
  eligibleForBoard,
  filterRows,
  filtersAreActive,
  filtersToParams,
  parseFilters,
  parseShirt,
  rowActionKeys,
  sortRows,
  STATUS_META,
  statusCounts,
  statusesForFilter,
  statusTransitions,
  type PlayersFilters,
} from './playersView'
import type { PlayerHistoryEntry, RegisteredPlayer, RegistrationStatus } from './data'

// A registration row for the reducers. Only the fields the reducers read need to
// be realistic; the rest are stable placeholders.
function row(p: Partial<RegisteredPlayer> & { playerId: string }): RegisteredPlayer {
  return {
    registrationId: 'reg-' + p.playerId,
    seasonId: 'season-1',
    teamId: null,
    displayName: 'Player ' + p.playerId,
    shirtNumber: null,
    status: 'registered',
    registeredDate: null,
    createdBy: null,
    updatedAt: '2026-07-01T00:00:00Z',
    ...p,
  }
}

const teamName = (id: string | null | undefined) =>
  id === 'titans' ? 'Titans' : id === 'trojans' ? 'Trojans' : ''

describe('parseFilters / filtersToParams URL round trip', () => {
  it('parses defaults from an empty query and writes nothing for them', () => {
    const f = parseFilters(new URLSearchParams(''))
    expect(f).toEqual(DEFAULT_FILTERS)
    expect(filtersToParams(f).toString()).toBe('')
  })

  it('round trips the structural filters (season, team, status, sort)', () => {
    const f: PlayersFilters = {
      seasonId: 'season-9',
      team: 'titans',
      status: 'withdrawn',
      q: '',
      sort: 'shirt',
    }
    const params = filtersToParams(f)
    expect(parseFilters(params)).toEqual(f)
  })

  it('never writes the search term to the URL (a search can be a child name)', () => {
    const params = filtersToParams({ ...DEFAULT_FILTERS, q: 'Jack Reed' })
    expect(params.toString()).toBe('')
    // And a URL carrying a stray q is not read back into the filter state.
    expect(parseFilters(new URLSearchParams('q=Jack%20Reed')).q).toBe('')
  })

  it('omits the default status pair and the default sort from the URL', () => {
    const params = filtersToParams({ seasonId: null, team: 'all', status: DEFAULT_STATUS_FILTER, q: '', sort: 'name' })
    expect(params.toString()).toBe('')
  })

  it('keeps Unassigned and an explicit status in the URL', () => {
    const params = filtersToParams({ seasonId: null, team: 'unassigned', status: 'pending', q: '', sort: 'name' })
    expect(params.get('team')).toBe('unassigned')
    expect(params.get('status')).toBe('pending')
    expect(params.get('season')).toBeNull()
  })

  it('falls back to defaults on a malformed status or sort', () => {
    const f = parseFilters(new URLSearchParams('status=nonsense&sort=bogus'))
    expect(f.status).toBe(DEFAULT_STATUS_FILTER)
    expect(f.sort).toBe('name')
  })
})

describe('filtersAreActive', () => {
  it('is false for the default view and true when any filter narrows', () => {
    expect(filtersAreActive(DEFAULT_FILTERS)).toBe(false)
    expect(filtersAreActive({ ...DEFAULT_FILTERS, team: 'titans' })).toBe(true)
    expect(filtersAreActive({ ...DEFAULT_FILTERS, status: 'withdrawn' })).toBe(true)
    expect(filtersAreActive({ ...DEFAULT_FILTERS, q: 'a' })).toBe(true)
    // Season and sort do not count as narrowing.
    expect(filtersAreActive({ ...DEFAULT_FILTERS, seasonId: 'x', sort: 'team' })).toBe(false)
  })
})

describe('statusesForFilter', () => {
  it('maps each filter to the statuses it admits', () => {
    expect(statusesForFilter('pending_registered')).toEqual(['pending', 'registered'])
    expect(statusesForFilter('all')).toEqual(['pending', 'registered', 'withdrawn'])
    expect(statusesForFilter('withdrawn')).toEqual(['withdrawn'])
  })
})

describe('filterRows', () => {
  const rows = [
    row({ playerId: 'a', teamId: 'titans', status: 'registered', displayName: 'Jack Reed' }),
    row({ playerId: 'b', teamId: 'trojans', status: 'pending', displayName: 'Amy Stone' }),
    row({ playerId: 'c', teamId: null, status: 'withdrawn', displayName: 'Jack Frost' }),
    row({ playerId: 'd', teamId: 'titans', status: 'registered', displayName: 'Zoe Ray' }),
  ]

  it('hides withdrawn rows under the default status pair', () => {
    const out = filterRows(rows, DEFAULT_FILTERS)
    expect(out.map((r) => r.playerId).sort()).toEqual(['a', 'b', 'd'])
  })

  it('filters by a specific team', () => {
    const out = filterRows(rows, { ...DEFAULT_FILTERS, team: 'titans' })
    expect(out.map((r) => r.playerId).sort()).toEqual(['a', 'd'])
  })

  it('filters the Unassigned pool, including withdrawn when the status widens', () => {
    const out = filterRows(rows, { ...DEFAULT_FILTERS, team: 'unassigned', status: 'all' })
    expect(out.map((r) => r.playerId)).toEqual(['c'])
  })

  it('searches the name case insensitively', () => {
    const out = filterRows(rows, { ...DEFAULT_FILTERS, status: 'all', q: 'jack' })
    expect(out.map((r) => r.playerId).sort()).toEqual(['a', 'c'])
  })
})

describe('sortRows', () => {
  const rows = [
    row({ playerId: 'a', teamId: 'trojans', status: 'withdrawn', shirtNumber: 9, displayName: 'Bea', registeredDate: '2026-07-10', updatedAt: '2026-07-10T00:00:00Z' }),
    row({ playerId: 'b', teamId: 'titans', status: 'pending', shirtNumber: null, displayName: 'Ada', registeredDate: null, updatedAt: '2026-07-20T00:00:00Z' }),
    row({ playerId: 'c', teamId: null, status: 'registered', shirtNumber: 3, displayName: 'Cal', registeredDate: '2026-07-15', updatedAt: '2026-07-05T00:00:00Z' }),
  ]

  it('sorts by name ascending', () => {
    expect(sortRows(rows, 'name', teamName).map((r) => r.displayName)).toEqual(['Ada', 'Bea', 'Cal'])
  })

  it('sorts by team with Unassigned last', () => {
    expect(sortRows(rows, 'team', teamName).map((r) => r.playerId)).toEqual(['b', 'a', 'c'])
  })

  it('sorts by status pending, registered, withdrawn', () => {
    expect(sortRows(rows, 'status', teamName).map((r) => r.status)).toEqual(['pending', 'registered', 'withdrawn'])
  })

  it('sorts by shirt ascending with blanks last', () => {
    expect(sortRows(rows, 'shirt', teamName).map((r) => r.shirtNumber)).toEqual([3, 9, null])
  })

  it('sorts by registered date newest first with blanks last', () => {
    expect(sortRows(rows, 'registered', teamName).map((r) => r.playerId)).toEqual(['c', 'a', 'b'])
  })

  it('sorts by last updated newest first', () => {
    expect(sortRows(rows, 'updated', teamName).map((r) => r.playerId)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const input = rows.slice()
    sortRows(input, 'name', teamName)
    expect(input).toEqual(rows)
  })

  it('breaks ties deterministically by player id', () => {
    const tie = [row({ playerId: 'y', displayName: 'Same' }), row({ playerId: 'x', displayName: 'Same' })]
    expect(sortRows(tie, 'name', teamName).map((r) => r.playerId)).toEqual(['x', 'y'])
  })
})

describe('statusCounts', () => {
  it('counts every status and the total over the unfiltered rows', () => {
    const rows = [
      row({ playerId: 'a', status: 'pending' }),
      row({ playerId: 'b', status: 'registered' }),
      row({ playerId: 'c', status: 'registered' }),
      row({ playerId: 'd', status: 'withdrawn' }),
    ]
    expect(statusCounts(rows)).toEqual({ pending: 1, registered: 2, withdrawn: 1, total: 4 })
  })
})

describe('STATUS_META status badge semantics', () => {
  it('always carries a word (never colour alone) and a colour token', () => {
    for (const s of ['pending', 'registered', 'withdrawn'] as RegistrationStatus[]) {
      expect(STATUS_META[s].label.length).toBeGreaterThan(0)
      expect(STATUS_META[s].dot).toMatch(/^var\(--/)
    }
    expect(STATUS_META.withdrawn.muted).toBe(true)
    expect(STATUS_META.registered.muted).toBe(false)
  })
})

describe('statusTransitions', () => {
  it('mirrors the server enforced transitions', () => {
    expect(statusTransitions('pending')).toEqual(['pending', 'registered', 'withdrawn'])
    expect(statusTransitions('registered')).toEqual(['registered', 'withdrawn'])
    expect(statusTransitions('withdrawn')).toEqual(['withdrawn'])
  })
})

describe('rowActionKeys', () => {
  const manage = { canManage: true, canDelete: false, writable: true }
  it('returns nothing without players.manage or on a read only season', () => {
    expect(rowActionKeys('registered', { canManage: false, canDelete: true, writable: true })).toEqual([])
    expect(rowActionKeys('registered', { canManage: true, canDelete: true, writable: false })).toEqual([])
  })
  it('offers Move and Withdraw for an active registration', () => {
    expect(rowActionKeys('registered', manage)).toEqual(['move', 'withdraw'])
    expect(rowActionKeys('pending', manage)).toEqual(['move', 'withdraw'])
  })
  it('offers Restore instead of Withdraw for a withdrawn registration', () => {
    expect(rowActionKeys('withdrawn', manage)).toEqual(['move', 'restore'])
  })
  it('adds Delete only with players.delete', () => {
    expect(rowActionKeys('registered', { ...manage, canDelete: true })).toEqual(['move', 'withdraw', 'delete'])
  })
})

describe('eligibleForBoard', () => {
  const rows = [
    row({ playerId: 'a', teamId: 'titans', status: 'registered' }),
    row({ playerId: 'b', teamId: 'titans', status: 'pending' }),
    row({ playerId: 'c', teamId: 'titans', status: 'withdrawn' }),
    row({ playerId: 'd', teamId: 'trojans', status: 'registered' }),
    row({ playerId: 'e', teamId: null, status: 'registered' }),
  ]

  it('takes registered players on the selected team, never withdrawn', () => {
    expect(eligibleForBoard(rows, 'titans', false).map((r) => r.playerId)).toEqual(['a'])
  })

  it('includes pending only when the toggle is on', () => {
    expect(eligibleForBoard(rows, 'titans', true).map((r) => r.playerId).sort()).toEqual(['a', 'b'])
  })

  it('never includes withdrawn even with the pending toggle on', () => {
    expect(eligibleForBoard(rows, 'titans', true).map((r) => r.playerId)).not.toContain('c')
  })

  it('takes the Unassigned pool only when the team is null (explicitly selected)', () => {
    expect(eligibleForBoard(rows, null, false).map((r) => r.playerId)).toEqual(['e'])
    // A team seed never rides Unassigned players along.
    expect(eligibleForBoard(rows, 'titans', true).map((r) => r.playerId)).not.toContain('e')
  })
})

describe('describeHistoryEntry', () => {
  const opts = { teamName: (id: string | null | undefined) => (id == null ? 'Unassigned' : teamName(id)), formatDate: (iso: string) => iso }
  const entry = (action: string, safeChanges: PlayerHistoryEntry['safeChanges'] = null): PlayerHistoryEntry => ({
    id: 'e',
    occurredAt: '2026-07-16T14:32:00Z',
    actorId: 'u',
    actorName: 'Mark Taylor',
    action,
    seasonId: 's',
    teamId: null,
    source: 'manual',
    changedFields: null,
    safeChanges,
  })

  it('describes a status change with the words, never a name', () => {
    const text = describeHistoryEntry(entry('player.status_changed', { status: { old: 'pending', new: 'registered' } }), opts)
    expect(text).toBe('Registration changed: Pending to Registered')
  })

  it('describes a team change resolving ids to names', () => {
    const text = describeHistoryEntry(entry('player.team_changed', { team_id: { old: null, new: 'titans' } }), opts)
    expect(text).toBe('Team changed: Unassigned to Titans')
  })

  it('describes a shirt change with values', () => {
    const text = describeHistoryEntry(entry('player.registration_updated', { shirt_number: { old: 7, new: 9 } }), opts)
    expect(text).toBe('Shirt number changed: 7 to 9')
  })

  it('describes the simple lifecycle actions without a name', () => {
    expect(describeHistoryEntry(entry('player.created'), opts)).toBe('Player added')
    expect(describeHistoryEntry(entry('player.withdrawn'), opts)).toBe('Withdrawn')
    expect(describeHistoryEntry(entry('player.updated'), opts)).toBe('Name changed')
    expect(describeHistoryEntry(entry('player.deleted'), opts)).toBe('Player deleted')
  })
})

describe('deleteConfirmed', () => {
  it('requires the exact trimmed name', () => {
    expect(deleteConfirmed('Jack Reed', 'Jack Reed')).toBe(true)
    expect(deleteConfirmed('  Jack Reed  ', 'Jack Reed')).toBe(true)
    expect(deleteConfirmed('jack reed', 'Jack Reed')).toBe(false)
    expect(deleteConfirmed('', 'Jack Reed')).toBe(false)
  })
})

describe('parseShirt', () => {
  it('clears on empty, accepts 1..99, rejects out of range and non integers', () => {
    expect(parseShirt('')).toBeNull()
    expect(parseShirt('  ')).toBeNull()
    expect(parseShirt('7')).toBe(7)
    expect(parseShirt('99')).toBe(99)
    expect(parseShirt('0')).toBeUndefined()
    expect(parseShirt('100')).toBeUndefined()
    expect(parseShirt('7.5')).toBeUndefined()
    expect(parseShirt('x')).toBeUndefined()
  })
})
