// =====================================================================
// Bulk selection and bulk permanent delete, on the SURFACES a coach touches
// (roadmap PLAYERS-01).
//
// The selection model itself is proved in src/lib/playersBulk.test.ts and the
// database semantics in the migration's own behaviour proof and
// tests/security/players-bulk-delete.test.ts. What these cover is the half that
// lives in markup, where a destructive feature fails quietly:
//
//   - a row is never pre-ticked, in either layout;
//   - the desktop table and the phone cards render the SAME selection through
//     the same toggle, so one cannot drift from the other;
//   - the Select all control names the number AND says it is the shown rows;
//   - the destructive button is inert at zero selected;
//   - the preview dialog states what is removed, what merely loses a name, and
//     what happens to session history, before anything can be confirmed;
//   - the typed gate names the count and stays disarmed until it matches.
//
// This repo has no DOM, so these are static renders: they prove what a surface
// SHOWS when it opens, which is what "nothing is selected by default" and "the
// preview says what it destroys" are claims about. Interaction (ticking,
// typing) is proved through the pure model, which is where every one of those
// decisions actually lives.
//
// Names in fixtures are invented. No real child appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesktopTable, PlayerCard, type RowSelection } from './Players'
import { BulkSelectionBar } from '../components/BulkDeletePlayersModal'
import {
  PREVIEW_SNAPSHOT_NOTE,
  bulkDeleteConfirmed,
  changeLines,
  historyLines,
  removalLines,
  type DeletePreview,
} from '../lib/playersBulk'
import type { RegisteredPlayer } from '../lib/data'

vi.mock('../lib/queries', () => ({
  useBulkDeletePlayers: () => ({ mutateAsync: async () => ({}) }),
  useDeletePlayersPreview: () => ({ isLoading: false, isError: false, isSuccess: false, data: undefined }),
  isStaleBulkSelection: () => false,
}))

function row(playerId: string, displayName: string, over: Partial<RegisteredPlayer> = {}): RegisteredPlayer {
  return {
    registrationId: `reg-${playerId}`,
    playerId,
    seasonId: 'season-1',
    teamId: 'titans',
    displayName,
    shirtNumber: 7,
    status: 'registered',
    registeredDate: '2026-07-16',
    createdBy: null,
    updatedAt: '2026-07-16T00:00:00Z',
    ...over,
  }
}

const ROWS = [row('p1', 'Test Child One'), row('p2', 'Test Child Two'), row('p3', 'Test Child Three')]
const teamDisplay = (id: string | null) => (id == null ? 'Unassigned' : 'Titans')
const noop = () => {}
const CAPS = { canManage: true, canDelete: true, canHistory: true, writable: true }

function table(selection?: RowSelection): string {
  return renderToStaticMarkup(
    <DesktopTable
      rows={ROWS}
      teamDisplay={teamDisplay}
      sort="name"
      onSort={noop}
      canManage={CAPS.canManage}
      canDelete={CAPS.canDelete}
      canHistory={CAPS.canHistory}
      writable={CAPS.writable}
      open={noop}
      selection={selection}
    />,
  )
}

function cards(selection?: RowSelection): string {
  return renderToStaticMarkup(
    <>
      {ROWS.map((p) => (
        <PlayerCard
          key={p.registrationId}
          player={p}
          teamDisplay={teamDisplay}
          canManage={CAPS.canManage}
          canDelete={CAPS.canDelete}
          canHistory={CAPS.canHistory}
          writable={CAPS.writable}
          open={noop}
          selection={selection}
        />
      ))}
    </>,
  )
}

const checkedCount = (html: string) => (html.match(/checked=""/g) ?? []).length
const boxCount = (html: string) => (html.match(/type="checkbox"/g) ?? []).length

describe('bulk mode is off until it is turned on', () => {
  it('renders no checkbox at all without a selection, in either layout', () => {
    expect(boxCount(table())).toBe(0)
    expect(boxCount(cards())).toBe(0)
    expect(table()).not.toContain('col-select')
    expect(cards()).not.toContain('pc-select')
  })

  it('renders a checkbox per row and none of them ticked when the mode opens empty', () => {
    const selection: RowSelection = { selected: new Set<string>(), onToggle: noop }
    expect(boxCount(table(selection))).toBe(3)
    expect(checkedCount(table(selection))).toBe(0)
    expect(boxCount(cards(selection))).toBe(3)
    expect(checkedCount(cards(selection))).toBe(0)
  })
})

describe('the desktop table and the phone cards show one selection', () => {
  const selection: RowSelection = { selected: new Set(['p1', 'p3']), onToggle: noop }

  it('ticks the same rows in both layouts', () => {
    expect(checkedCount(table(selection))).toBe(2)
    expect(checkedCount(cards(selection))).toBe(2)
  })

  it('labels every box with the player it selects, so a screen reader hears which', () => {
    for (const html of [table(selection), cards(selection)]) {
      expect(html).toContain('aria-label="Select Test Child One"')
      expect(html).toContain('aria-label="Select Test Child Two"')
      expect(html).toContain('aria-label="Select Test Child Three"')
    }
  })

  it('marks a selected card so selection is not conveyed by the box alone', () => {
    expect(cards(selection)).toContain('player-card selected')
  })

  it('keeps the table a semantic table with a header cell for the new column', () => {
    const html = table(selection)
    expect(html).toContain('<table')
    expect(html).toContain('aria-label="Select"')
  })
})

describe('the selection bar says what Select all would do', () => {
  const bar = (selectedCount: number, shownCount: number, allSelected = false) =>
    renderToStaticMarkup(
      <BulkSelectionBar
        selectedCount={selectedCount}
        shownCount={shownCount}
        allSelected={allSelected}
        onSelectAllShown={noop}
        onClear={noop}
        onDelete={noop}
        onExit={noop}
      />,
    )

  it('names the number shown, never a bare Select all', () => {
    expect(bar(0, 12)).toContain('Select all 12 shown')
    expect(bar(0, 12)).not.toMatch(/Select all<|Select all all/)
  })

  it('counts the selection and the destructive button agrees with it', () => {
    const html = bar(6, 12)
    expect(html).toContain('6 selected')
    expect(html).toContain('Delete 6 players')
  })

  it('agrees in number for one player', () => {
    expect(bar(1, 12)).toContain('Delete 1 player<')
  })

  it('disables the destructive button and Clear at zero selected', () => {
    const html = bar(0, 12)
    // Two disabled controls: Clear and Delete. Select all stays live.
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2)
    expect(html).toContain('Select all 12 shown')
  })

  it('disables Select all once everything shown is already selected', () => {
    expect(bar(12, 12, true)).toMatch(/Select all 12 shown/)
    expect((bar(12, 12, true).match(/disabled=""/g) ?? []).length).toBe(1)
  })
})

describe('the preview says what a run destroys before it can be confirmed', () => {
  const preview: DeletePreview = {
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

  it('lists every dependency the server counted', () => {
    const shown = [...removalLines(preview), ...changeLines(preview)].join(' | ')
    expect(shown).toContain('6 player identities')
    expect(shown).toContain('11 season registrations')
    expect(shown).toContain('27 register entries across 9 sessions')
    expect(shown).toContain('4 Spond links')
    expect(shown).toContain('27 stored Spond replies')
    expect(shown).toContain('3 saved board discs on 2 boards')
  })

  it('says in words that the register entries are destroyed and kept nowhere else', () => {
    expect(historyLines(preview)[0]).toContain('kept nowhere else')
  })

  it('describes the counts as the current preview, and the note states the snapshot contract', () => {
    // The deletion is defined by the selected identities; the counts are what
    // exists now, and entries recorded after the preview still go with their
    // child. The copy has to be true across that window.
    expect(historyLines(preview)[0]).toContain('current preview shows 27 register entries across 9 sessions')
    expect(historyLines(preview)[0]).toContain('when the deletion runs')
    expect(PREVIEW_SNAPSHOT_NOTE).toContain('current snapshot')
    expect(PREVIEW_SNAPSHOT_NOTE).toContain('exist when the deletion runs')
  })

  it('says Spond itself is never changed', () => {
    expect(historyLines(preview).join(' ')).toMatch(/nothing is deleted or changed in Spond/i)
  })

  it('stays disarmed until the typed phrase names the count', () => {
    expect(bulkDeleteConfirmed('', 6)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE 5 PLAYERS', 6)).toBe(false)
    expect(bulkDeleteConfirmed('DELETE 6 PLAYERS', 6)).toBe(true)
  })
})
