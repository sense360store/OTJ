// The bulk selection and bulk delete model (roadmap PLAYERS-01).
//
// Every rule here is one a destructive operation depends on, so each is proved
// rather than assumed: nothing is selected until somebody selects it, Select
// all reaches only what is shown, a filter change can neither broaden nor
// preserve a hidden selection, the typed phrase names the number, and the
// preview counts what the server said rather than what the browser guessed.
//
// Names in fixtures are invented. No real child appears.
import { describe, expect, it } from 'vitest'
import type { RegisteredPlayer } from './data'
import {
  BULK_DELETE_MAX,
  EMPTY_SELECTION,
  PREVIEW_SNAPSHOT_NOTE,
  ZERO_PREVIEW,
  allShownSelected,
  bulkDeleteButtonLabel,
  bulkDeleteConfirmed,
  bulkDeletePhrase,
  canBulkDelete,
  changeLines,
  clearSelection,
  confineToShown,
  historyLines,
  overBulkDeleteLimit,
  overLimitMessage,
  parseDeletePreview,
  previewIsStale,
  removalLines,
  selectAllShown,
  selectionAfterFilterChange,
  selectionForFilters,
  selectedRows,
  selectionIds,
  toggleSelected,
  type DeletePreview,
  type PlayerSelection,
} from './playersBulk'

function row(playerId: string, displayName: string, over: Partial<RegisteredPlayer> = {}): RegisteredPlayer {
  return {
    registrationId: `reg-${playerId}`,
    playerId,
    seasonId: 'season-1',
    teamId: 'titans',
    displayName,
    shirtNumber: null,
    status: 'registered',
    registeredDate: null,
    createdBy: null,
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  }
}

const TITANS = [row('p1', 'Test Child One'), row('p2', 'Test Child Two')]
const TROJANS = [row('p3', 'Test Child Three', { teamId: 'trojans' })]
const ALL = [...TITANS, ...TROJANS]
const ids = (rows: RegisteredPlayer[]) => rows.map((r) => r.playerId)

describe('nothing is selected until somebody selects it', () => {
  it('starts empty', () => {
    expect(EMPTY_SELECTION.size).toBe(0)
  })

  it('selects and deselects one row at a time', () => {
    let sel = toggleSelected(EMPTY_SELECTION, 'p1')
    expect([...sel]).toEqual(['p1'])
    sel = toggleSelected(sel, 'p2')
    expect(sel.size).toBe(2)
    sel = toggleSelected(sel, 'p1')
    expect([...sel]).toEqual(['p2'])
  })

  it('clears to nothing', () => {
    const sel = selectAllShown(EMPTY_SELECTION, ids(ALL))
    expect(sel.size).toBe(3)
    expect(clearSelection().size).toBe(0)
  })

  it('never mutates the selection it was given', () => {
    const sel = new Set(['p1'])
    toggleSelected(sel, 'p2')
    selectAllShown(sel, ids(ALL))
    confineToShown(sel, [])
    expect([...sel]).toEqual(['p1'])
  })
})

describe('Select all means the shown rows and only the shown rows', () => {
  it('selects exactly what is passed in, never the whole register', () => {
    const sel = selectAllShown(EMPTY_SELECTION, ids(TITANS))
    expect([...sel].sort()).toEqual(['p1', 'p2'])
    expect(sel.has('p3')).toBe(false)
  })

  it('adds to an existing selection rather than replacing it', () => {
    const sel = selectAllShown(new Set(['p3']), ids(TITANS))
    expect([...sel].sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('reports when every shown row is selected, and says no for an empty view', () => {
    expect(allShownSelected(new Set(['p1', 'p2']), ids(TITANS))).toBe(true)
    expect(allShownSelected(new Set(['p1']), ids(TITANS))).toBe(false)
    expect(allShownSelected(new Set(['p1']), [])).toBe(false)
  })
})

describe('changing a filter cannot broaden or secretly preserve a selection', () => {
  it('drops anybody the new view hides', () => {
    const selected = selectAllShown(EMPTY_SELECTION, ids(ALL))
    // The coach narrows to Titans. Trojans row p3 is no longer shown.
    const { next, dropped } = confineToShown(selected, ids(TITANS))
    expect([...next].sort()).toEqual(['p1', 'p2'])
    expect(dropped).toBe(1)
  })

  it('does not bring a dropped row back when the filter widens again', () => {
    const narrowed = confineToShown(selectAllShown(EMPTY_SELECTION, ids(ALL)), ids(TITANS)).next
    // Widening back to every team must not resurrect p3: it comes back unticked.
    const widened = confineToShown(narrowed, ids(ALL)).next
    expect(widened.has('p3')).toBe(false)
    expect([...widened].sort()).toEqual(['p1', 'p2'])
  })

  it('empties the selection when the new view shows nothing', () => {
    const { next, dropped } = confineToShown(new Set(['p1', 'p2']), [])
    expect(next.size).toBe(0)
    expect(dropped).toBe(2)
  })

  it('returns the same instance when nothing was dropped, so a screen can assign it back safely', () => {
    const selected: ReadonlySet<string> = new Set(['p1'])
    const { next, dropped } = confineToShown(selected, ids(ALL))
    expect(next).toBe(selected)
    expect(dropped).toBe(0)
  })

  // selectionForFilters is what the page calls in the filter handler itself,
  // from the rows the NEW filters admit, so the drop happens as the filter
  // changes rather than as a reaction to it.
  it('drops to what the new filters will show, computed from the new rows', () => {
    const selected = selectAllShown(EMPTY_SELECTION, ids(ALL))
    expect([...selectionForFilters(selected, TITANS)].sort()).toEqual(['p1', 'p2'])
  })

  it('empties the selection when the new filters will show nothing', () => {
    expect(selectionForFilters(new Set(['p1', 'p2']), []).size).toBe(0)
  })

  it('keeps everything when the new filters still show every selected row', () => {
    const selected = new Set(['p1', 'p3'])
    expect(selectionForFilters(selected, ALL)).toBe(selected)
  })

  // selectionAfterFilterChange is what the page's filter handler calls, so the
  // three cases are proved here rather than left inside a component.
  it('clears everything on a season change, because that is a different register', () => {
    expect(selectionAfterFilterChange(new Set(['p1', 'p2']), ['seasonId'], ALL).size).toBe(0)
  })

  it('drops to the new view on a team, status or search change', () => {
    for (const key of ['team', 'status', 'q']) {
      const after = selectionAfterFilterChange(selectAllShown(EMPTY_SELECTION, ids(ALL)), [key], TITANS)
      expect([...after].sort(), key).toEqual(['p1', 'p2'])
    }
  })

  it('leaves the selection alone on a sort change, which reveals nobody new', () => {
    const selected: PlayerSelection = new Set(['p1', 'p3'])
    // The next visible list is deliberately wrong here: a sort change must not
    // consult it at all.
    expect(selectionAfterFilterChange(selected, ['sort'], [])).toBe(selected)
  })

  it('cannot be used to broaden: it only ever removes', () => {
    // Every row in the new view that was not selected stays unselected. The
    // only thing this function can do to a selection is make it smaller.
    const selected = new Set(['p1'])
    const after = selectionForFilters(selected, ALL)
    expect([...after]).toEqual(['p1'])
    expect(after.size).toBeLessThanOrEqual(selected.size)
  })
})

describe('what is sent to the server', () => {
  it('is the deduplicated, stably ordered id list', () => {
    expect(selectionIds(new Set(['p3', 'p1', 'p2']))).toEqual(['p1', 'p2', 'p3'])
  })

  it('sends nothing for an empty selection', () => {
    expect(selectionIds(EMPTY_SELECTION)).toEqual([])
  })

  it('lists the selected rows in the order the table shows them', () => {
    expect(selectedRows(ALL, new Set(['p3', 'p1'])).map((r) => r.displayName)).toEqual([
      'Test Child One',
      'Test Child Three',
    ])
  })
})

describe('the bulk affordance is gated exactly like the single row delete', () => {
  it('needs players.manage, players.delete and a writable season', () => {
    expect(canBulkDelete({ canManage: true, canDelete: true, writable: true })).toBe(true)
    expect(canBulkDelete({ canManage: true, canDelete: false, writable: true })).toBe(false)
    expect(canBulkDelete({ canManage: false, canDelete: true, writable: true })).toBe(false)
    // An archived or superseded season is read only, bulk mode or not.
    expect(canBulkDelete({ canManage: true, canDelete: true, writable: false })).toBe(false)
  })
})

describe('the typed confirmation names the number', () => {
  it('is the phrase with the count, pluralised', () => {
    expect(bulkDeletePhrase(6)).toBe('DELETE 6 PLAYERS')
    expect(bulkDeletePhrase(1)).toBe('DELETE 1 PLAYER')
    expect(bulkDeleteButtonLabel(6)).toBe('Delete 6 players permanently')
    expect(bulkDeleteButtonLabel(1)).toBe('Delete 1 player permanently')
  })

  it('accepts the phrase, forgiving case and stray whitespace', () => {
    expect(bulkDeleteConfirmed('DELETE 6 PLAYERS', 6)).toBe(true)
    expect(bulkDeleteConfirmed('  delete 6 players  ', 6)).toBe(true)
    expect(bulkDeleteConfirmed('DELETE  6   PLAYERS', 6)).toBe(true)
  })

  it('refuses a phrase naming a different number', () => {
    expect(bulkDeleteConfirmed('DELETE 5 PLAYERS', 6)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE 6 PLAYERS', 5)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE 6 PLAYER', 6)).toBe(false)
  })

  it('refuses anything that is not the phrase, and refuses everything at zero', () => {
    expect(bulkDeleteConfirmed('', 6)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE', 6)).toBe(false)
    expect(bulkDeleteConfirmed('delete all players', 6)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE 0 PLAYERS', 0)).toBe(false)
    expect(bulkDeleteConfirmed('', 0)).toBe(false)
  })
})

describe('the preview is the server’s answer, refused when unreadable', () => {
  const raw = {
    requested: 6,
    players: 6,
    registrations: 11,
    registration_seasons: 3,
    registrations_current: 6,
    registrations_archived: 5,
    register_entries: 27,
    register_sessions: 9,
    spond_links: 4,
    spond_replies: 27,
    board_tokens: 3,
    boards: 2,
  }

  it('maps every count', () => {
    expect(parseDeletePreview(raw)).toEqual({
      requested: 6,
      players: 6,
      registrations: 11,
      registrationSeasons: 3,
      registrationsCurrent: 6,
      registrationsArchived: 5,
      registerEntries: 27,
      registerSessions: 9,
      spondLinks: 4,
      spondReplies: 27,
      boardTokens: 3,
      boards: 2,
    })
  })

  it('refuses a payload missing any field, rather than fabricating a zero', () => {
    // Zero-filling was the original behaviour, and it failed the wrong way
    // for a destructive confirmation: a partial payload with valid requested
    // and players fields armed deletion while showing fabricated zeroes. A
    // missing field is a refusal; the dialog lands on its error path.
    for (const key of Object.keys(raw)) {
      const partial: Record<string, unknown> = { ...raw }
      delete partial[key]
      expect(parseDeletePreview(partial), `missing ${key}`).toBeNull()
    }
  })

  it('refuses a null, non numeric, fractional, negative or boolean field', () => {
    expect(parseDeletePreview({ ...raw, register_entries: null })).toBeNull()
    expect(parseDeletePreview({ ...raw, spond_links: 'many' })).toBeNull()
    expect(parseDeletePreview({ ...raw, boards: 1.5 })).toBeNull()
    expect(parseDeletePreview({ ...raw, players: -1 })).toBeNull()
    expect(parseDeletePreview({ ...raw, requested: true })).toBeNull()
    expect(parseDeletePreview({ ...raw, registrations: Number.NaN })).toBeNull()
  })

  it('refuses a non object outright', () => {
    expect(parseDeletePreview(null)).toBeNull()
    expect(parseDeletePreview('6')).toBeNull()
    expect(parseDeletePreview(undefined)).toBeNull()
  })

  it('accepts genuine zeroes from a well formed payload', () => {
    // A club with no Spond and no boards must still preview honestly; the
    // refusal is of ABSENT counts, never of zero ones.
    const zeros = Object.fromEntries(Object.keys(raw).map((k) => [k, 0]))
    expect(parseDeletePreview(zeros)).toEqual(ZERO_PREVIEW)
  })

  it('calls a selection stale when the server found fewer live players than were asked about', () => {
    expect(previewIsStale(parseDeletePreview(raw)!)).toBe(false)
    expect(previewIsStale(parseDeletePreview({ ...raw, players: 4 })!)).toBe(true)
  })
})

describe('the preview reads as sentences a coach can act on', () => {
  const full: DeletePreview = {
    requested: 6,
    players: 6,
    registrations: 11,
    registrationSeasons: 3,
    registrationsCurrent: 6,
    registrationsArchived: 5,
    registerEntries: 27,
    registerSessions: 9,
    spondLinks: 4,
    spondReplies: 27,
    boardTokens: 3,
    boards: 2,
  }

  it('names every dependency that would be removed', () => {
    const lines = removalLines(full)
    expect(lines[0]).toBe('6 player identities')
    expect(lines).toContain('11 season registrations across 3 seasons (6 in the current season, 5 in an archived season)')
    expect(lines).toContain('27 register entries across 9 sessions')
    expect(lines).toContain('4 Spond links')
    expect(lines).toContain('27 stored Spond replies')
  })

  it('separates what loses a name from what is removed', () => {
    expect(changeLines(full)).toEqual([
      '3 saved board discs on 2 boards lose their name and keep their number and position',
    ])
    expect(removalLines(full).join(' ')).not.toMatch(/board/i)
  })

  it('leaves out every dependency that would remove nothing, and keeps the identities line', () => {
    const lines = removalLines({ ...ZERO_PREVIEW, requested: 2, players: 2 })
    expect(lines).toEqual(['2 player identities'])
    expect(changeLines({ ...ZERO_PREVIEW, requested: 2, players: 2 })).toEqual([])
  })

  it('agrees in number for a single player', () => {
    const one: DeletePreview = {
      ...ZERO_PREVIEW,
      requested: 1,
      players: 1,
      registrations: 1,
      registrationSeasons: 1,
      registrationsCurrent: 1,
      registerEntries: 1,
      registerSessions: 1,
      spondLinks: 1,
      spondReplies: 1,
      boardTokens: 1,
      boards: 1,
    }
    expect(removalLines(one)[0]).toBe('1 player identity')
    expect(removalLines(one)[1]).toBe('1 season registration (1 in the current season)')
    expect(removalLines(one)[2]).toBe('1 register entry across 1 session')
    expect(changeLines(one)[0]).toBe('1 saved board disc on 1 board loses its name and keeps its number and position')
  })
})

describe('the history statement is always made, and says what is destroyed', () => {
  it('states plainly that register entries go with the child', () => {
    const lines = historyLines({ ...ZERO_PREVIEW, players: 6, requested: 6, registerEntries: 27, registerSessions: 9 })
    expect(lines[0]).toMatch(/Session history/)
    expect(lines[0]).toMatch(/goes with them and is kept nowhere else/)
    expect(lines[0]).toMatch(/sessions themselves, their plans and every other child/)
  })

  it('still makes the statement when there is nothing to remove', () => {
    const lines = historyLines({ ...ZERO_PREVIEW, players: 2, requested: 2 })
    expect(lines[0]).toMatch(/no register entries/)
    expect(lines.length).toBe(4)
  })

  it('always says the activity log keeps a neutral entry, that Spond is untouched, and that it cannot be undone', () => {
    for (const p of [
      { ...ZERO_PREVIEW, players: 1, requested: 1 },
      { ...ZERO_PREVIEW, players: 9, requested: 9, registerEntries: 4, registerSessions: 2, spondLinks: 3 },
    ]) {
      const joined = historyLines(p).join(' ')
      expect(joined).toMatch(/neutral Deleted player entry carrying no name/)
      expect(joined).toMatch(/nothing is deleted or changed in Spond/i)
      expect(joined).toMatch(/cannot be undone/)
      expect(joined).toMatch(/Withdraw is the reversible way/)
    }
  })
})

describe('the history contract survives dependency drift, because the preview is a snapshot', () => {
  // The window this pins: dependency counts are read at preview time, and a
  // register entry recorded for a selected child between the preview and the
  // press is deleted with that child. The server revalidates only the
  // identity count and recomputes the dependency counts under the deletion
  // lock, so the COPY has to be true across that window: it may describe the
  // counts as current, and it may never promise that a zero stays zero.

  it('never promises that no session history can change, whatever the current count reads', () => {
    // The mutation this exists to catch: restoring the earlier zero-count
    // wording, "no session record changes", which a coach recording
    // attendance between the preview and the press made false.
    for (const p of [
      { ...ZERO_PREVIEW, players: 2, requested: 2 },
      { ...ZERO_PREVIEW, players: 6, requested: 6, registerEntries: 27, registerSessions: 9 },
    ]) {
      const joined = historyLines(p).join(' ')
      expect(joined).not.toMatch(/no session record changes/i)
      expect(joined).not.toMatch(/nothing (?:will|can) change/i)
      expect(joined).not.toMatch(/have no register entries, so/i)
    }
  })

  it('describes a non zero count as the current preview, never as a frozen deletion total', () => {
    const line = historyLines({
      ...ZERO_PREVIEW,
      players: 6,
      requested: 6,
      registerEntries: 27,
      registerSessions: 9,
    })[0]
    expect(line).toMatch(/current preview shows 27 register entries across 9 sessions/)
    expect(line).toMatch(/when the deletion runs/)
  })

  it('says at zero that entries recorded before the press still go, and the sessions never do', () => {
    const line = historyLines({ ...ZERO_PREVIEW, players: 2, requested: 2 })[0]
    expect(line).toMatch(/current preview shows no register entries/)
    expect(line).toMatch(/before Delete is pressed/)
    expect(line).toMatch(/permanently removed with the player identities/)
    expect(line).toMatch(/sessions themselves are never touched/)
  })

  it('states the snapshot contract once, beside the counts', () => {
    expect(PREVIEW_SNAPSHOT_NOTE).toMatch(/current snapshot/)
    expect(PREVIEW_SNAPSHOT_NOTE).toMatch(/selected players/)
    expect(PREVIEW_SNAPSHOT_NOTE).toMatch(/exist when the deletion runs/)
  })

  it('gates nothing on a dependency count: staleness and the typed phrase stay identity based', () => {
    // A drifted dependency count arms and refuses exactly as before.
    expect(previewIsStale({ ...ZERO_PREVIEW, requested: 6, players: 6, registerEntries: 999 })).toBe(false)
    expect(previewIsStale({ ...ZERO_PREVIEW, requested: 6, players: 5 })).toBe(true)
    expect(bulkDeletePhrase(6)).toBe('DELETE 6 PLAYERS')
    expect(bulkDeleteConfirmed('delete 6 players', 6)).toBe(true)
  })
})

describe('a selection past the server cap never arms', () => {
  // delete_players refuses more than 200 ids outright (0050, errcode 22023),
  // and that message is not one the client's stale-selection recognition
  // matches, so without this gate an admin was walked through the preview and
  // the typed phrase into a run that could only ever fail generically.

  it('mirrors the applied cap exactly and trips only past it', () => {
    expect(BULK_DELETE_MAX).toBe(200)
    expect(overBulkDeleteLimit(BULK_DELETE_MAX)).toBe(false)
    expect(overBulkDeleteLimit(BULK_DELETE_MAX + 1)).toBe(true)
    expect(overBulkDeleteLimit(0)).toBe(false)
  })

  it('says the cap, the selection and exactly what to do', () => {
    expect(overLimitMessage(214)).toBe(
      'At most 200 players can be deleted in one run, and 214 are selected. ' +
        'Deselect 14 players and try again, or delete in smaller runs.',
    )
    expect(overLimitMessage(201)).toContain('Deselect 1 player and')
  })
})
