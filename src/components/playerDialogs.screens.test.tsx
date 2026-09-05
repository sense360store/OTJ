// =====================================================================
// VISUAL-02, the six remaining Registered players dialog files: the real
// components, rendered.
//
// WHAT THIS IS FOR. Adopting the shared system moved presentation that was
// carrying MEANING: an error message that was a hand written paragraph
// beside a hand written aria-describedby is the Field primitive's now, a
// typed confirmation whose only accessible name was an aria-label has a
// real <label>, a radio pair that was three inline styles is a fieldset,
// and a class word painted in the four corners green is a Badge tone. Each
// of those is a structure a screenshot cannot judge and the design system
// invariant test cannot see, because it reads source text rather than
// output.
//
// WHAT IT CANNOT REACH. This project has no DOM, so these are static
// renders: they cover what a dialog shows WHEN IT OPENS. Every computed
// height, the focus contract, the dismissal contract while a write is in
// flight and the typed gate arming are tools/visual/checks.mjs, which
// drives the real controls in a browser.
//
// Names in fixtures are invented. No real child appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegisteredPlayer, Season, Team } from '../lib/data'

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue', sortOrder: null },
  { id: 'trojans', name: 'Trojans', bibColour: 'red', sortOrder: null },
]

const CURRENT: Season = {
  id: 'season-2627',
  name: '2026/27',
  startsOn: '2026-08-01',
  endsOn: '2027-06-30',
  isCurrent: true,
  archivedAt: null,
}

const PLAYER: RegisteredPlayer = {
  registrationId: 'reg-1',
  playerId: 'player-1',
  seasonId: CURRENT.id,
  teamId: 'titans',
  displayName: 'Aria Bexley-Thornton',
  shirtNumber: 4,
  status: 'registered',
  registeredDate: '2026-08-14',
  createdBy: 'coach-me',
  updatedAt: '2026-08-20T09:12:00Z',
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
  ...over,
})

const mutation = () => ({
  mutate: () => {},
  mutateAsync: () => Promise.resolve(undefined),
  isPending: false,
  isError: false,
  isSuccess: false,
  error: null,
  data: null,
  reset: () => {},
})

// What the History read answers, so one describe can vary it.
const history = { rows: [] as unknown[], loading: false, error: false }

vi.mock('../lib/queries', () => ({
  useInsertPlayer: mutation,
  useUpdatePlayer: mutation,
  useSetRegistrationStatus: mutation,
  useMovePlayerTeam: mutation,
  useDeletePlayer: mutation,
  useSpondRosterImport: mutation,
  useExportPlayers: mutation,
  useRenewRegistrations: mutation,
  useRegisteredPlayers: () => query([]),
  usePlayerHistory: () =>
    query(history.error || history.loading ? undefined : history.rows, {
      isLoading: history.loading,
      isPending: history.loading,
      isError: history.error,
      isSuccess: !history.loading && !history.error,
    }),
}))

const { PlayerFormModal } = await import('./PlayerFormModal')
const { DeletePlayerModal, ImportFromSpondModal, MoveTeamModal, RestoreModal, TeamField, WithdrawModal } =
  await import('./PlayerActionModals')
const { PlayerHistoryModal } = await import('./PlayerHistoryModal')
const { ExportConfirmModal } = await import('./ExportConfirmModal')
const { RenewRowView } = await import('./RenewSeasonModal')

const render = (node: React.ReactElement) => renderToStaticMarkup(node)

/* ---- 2.6: a control's label is a real <label> bound to it ------------- */

describe('every control in these dialogs has a real label bound to it', () => {
  // The rule that is easy to lose when a hand written field becomes a
  // primitive, and easy to lose in the other direction too: the delete
  // confirmation's only accessible name used to be an aria-label, with the
  // instruction in an unrelated paragraph.
  const labelledIds = (html: string) => [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1])
  const controlIds = (html: string) =>
    [...html.matchAll(/<(?:input|select|textarea)[^>]*\bid="([^"]+)"/g)].map((m) => m[1])

  const cases: [string, string][] = [
    [
      'Add player',
      render(
        <PlayerFormModal
          mode="add"
          teams={TEAMS}
          defaultTeamId={null}
          currentSeasonId={CURRENT.id}
          seasonName={CURRENT.name}
          onClose={() => {}}
        />,
      ),
    ],
    [
      'Edit player',
      render(
        <PlayerFormModal
          mode="edit"
          player={PLAYER}
          teams={TEAMS}
          defaultTeamId={null}
          currentSeasonId={CURRENT.id}
          seasonName={CURRENT.name}
          onClose={() => {}}
        />,
      ),
    ],
    ['Move team', render(<MoveTeamModal player={PLAYER} teams={TEAMS} onClose={() => {}} />)],
    ['Delete player permanently', render(<DeletePlayerModal player={PLAYER} onClose={() => {}} />)],
  ]

  for (const [name, html] of cases) {
    it(`${name}: every text, select and date control is named by a <label for>`, () => {
      const ids = controlIds(html)
      // Radios and checkboxes are labelled by being wrapped, so they carry no
      // id; anything with one must be pointed at.
      expect(ids.length).toBeGreaterThan(0)
      expect(ids.filter((id) => !labelledIds(html).includes(id))).toEqual([])
    })
  }

  it('names the delete confirmation with a real label rather than an aria-label', () => {
    const html = render(<DeletePlayerModal player={PLAYER} onClose={() => {}} />)
    expect(html).toContain('To confirm, type')
    expect(html).toMatch(/<label for="delete-player-name">/)
    // The old shape: a bare input whose only name was an attribute.
    expect(html).not.toContain("aria-label=\"Type the player&#x27;s name to confirm\"")
  })

  it('keeps the typed confirmation naming the child, so the gate is unambiguous', () => {
    const html = render(<DeletePlayerModal player={PLAYER} onClose={() => {}} />)
    expect(html).toContain('Aria Bexley-Thornton')
    expect(html).toContain('placeholder="Aria Bexley-Thornton"')
  })
})

/* ---- 2.6: an error is a border AND a message AND the wiring ----------- */

describe('the shirt number field states its error three ways at once', () => {
  const withShirt = (shirt: string) => {
    // The field is uncontrolled from the test's point of view, so the invalid
    // state is reached through the value the modal is given: an edit whose
    // player already carries an unparseable shirt is not representable, so the
    // valid case is asserted here and the invalid one is driven in the browser
    // (tools/visual/checks.mjs) where the field can be typed into.
    return render(
      <PlayerFormModal
        mode="edit"
        player={{ ...PLAYER, shirtNumber: shirt === '' ? null : Number(shirt) }}
        teams={TEAMS}
        defaultTeamId={null}
        currentSeasonId={CURRENT.id}
        seasonName={CURRENT.name}
        onClose={() => {}}
      />,
    )
  }

  it('carries no error state while the value parses', () => {
    const html = withShirt('4')
    expect(html).not.toContain('aria-invalid="true"')
    expect(html).not.toContain('field-error')
  })

  it('renders the shirt field through the primitive, so the three cannot come apart', () => {
    // What makes the three inseparable is that one component renders all of
    // them. The modal no longer writes aria-describedby, a message element or
    // a border rule of its own, so there is no arrangement in which it sets
    // one and forgets another.
    const html = withShirt('4')
    expect(html).toContain('id="pf-shirt"')
    expect(html).toMatch(/<label for="pf-shirt">Shirt number<\/label>/)
  })
})

/* ---- 2.7 and 2.16: a state is never carried by colour alone ----------- */

describe('the renew preview states a class in words, through a semantic tone', () => {
  const row = (klass: 'eligible' | 'needs_decision' | 'already_in_target') =>
    render(
      <RenewRowView
        row={{ playerId: 'p1', displayName: 'Sample Child', teamId: 'titans', shirtNumber: 7, sourceStatus: 'registered', klass }}
        teamName="Titans"
        checked
        onToggle={() => {}}
      />,
    )

  it('uses the Badge primitive with a semantic tone, not a classification hex', () => {
    // These three were #16a34a, #ef8e1b and #94a3b8: the four corners
    // physical and social hues standing in for success and warning, written
    // as literals so no scan of var(--c-*) could see them.
    expect(row('eligible')).toContain('badge badge-success')
    expect(row('needs_decision')).toContain('badge badge-warning')
    // Neutral is the Badge's base and carries no modifier at all.
    expect(row('already_in_target')).toMatch(/class="badge"/)
    for (const k of ['eligible', 'needs_decision', 'already_in_target'] as const) {
      expect(row(k)).not.toMatch(/#[0-9a-fA-F]{6}/)
    }
  })

  it('still shows the word beside the dot, so the class is never colour alone', () => {
    expect(row('eligible')).toContain('Eligible')
    expect(row('needs_decision')).toContain('Withdrawn')
    expect(row('already_in_target')).toContain('Already in target')
    for (const k of ['eligible', 'needs_decision', 'already_in_target'] as const) {
      expect(row(k)).toContain('badge-dot')
    }
  })

  it('makes the whole row the target by wrapping the checkbox in the label', () => {
    // .renew-row carries min-height: var(--hit); the label being the wrapper
    // is what makes that a target rather than a tall box beside a 16px one.
    expect(row('eligible')).toMatch(/<label class="renew-row"[^>]*>.*type="checkbox".*<\/label>/s)
  })
})

/* ---- 2.6 and 2.5: a choice set is a fieldset of check rows ------------ */

describe('a set of choices is a real fieldset whose rows are the targets', () => {
  it('wraps the restore pair in a fieldset with a legend', () => {
    const html = render(<RestoreModal player={PLAYER} seasonName={CURRENT.name} onClose={() => {}} />)
    expect(html).toContain('<fieldset class="choice-group">')
    expect(html).toContain('<legend class="sr-only">Restore as</legend>')
    // Each row is the shared check row, which is what carries the 44px
    // minimum; the old shape was `class="row"` with three inline styles.
    expect((html.match(/class="check-row"/g) ?? []).length).toBe(2)
    expect(html).not.toContain('font-size')
  })

  it('wraps both export choice sets the same way, with visible legends', () => {
    const html = render(
      <ExportConfirmModal
        season={{ id: CURRENT.id, name: CURRENT.name }}
        filters={{ seasonId: CURRENT.id, q: '', team: 'all', status: 'pending_registered', sort: 'name' }}
        filteredCount={8}
        totalCount={12}
        teamLabel="All teams"
        onClose={() => {}}
      />,
    )
    expect((html.match(/<fieldset class="choice-group">/g) ?? []).length).toBe(2)
    expect(html).toContain('<legend>What to export</legend>')
    expect(html).toContain('<legend>Format</legend>')
    expect((html.match(/class="check-row"/g) ?? []).length).toBe(4)
  })

  it('makes the export handling reminder a warning Note rather than a gold panel', () => {
    // --gold-soft is a gold tint now, not the universal note ground: inherited
    // text on it measured 1.01:1 in the dark theme, which is the specific
    // defect 2.4 names. The Note brings an icon, so the caution is not the
    // colour alone either.
    const html = render(
      <ExportConfirmModal
        season={{ id: CURRENT.id, name: CURRENT.name }}
        filters={{ seasonId: CURRENT.id, q: '', team: 'all', status: 'pending_registered', sort: 'name' }}
        filteredCount={8}
        totalCount={12}
        teamLabel="All teams"
        onClose={() => {}}
      />,
    )
    expect(html).toContain('note note-warning')
    expect(html).toContain('Store and share this file securely. It names children.')
    expect(html).not.toContain('--gold-soft')
  })
})

/* ---- 2.14: loading and error stopped looking alike -------------------- */

describe('the History dialog gives its three states three treatments', () => {
  const open = () =>
    render(<PlayerHistoryModal playerId="player-1" displayName={PLAYER.displayName} teams={TEAMS} onClose={() => {}} />)

  it('announces a load with the labelled spinner rather than grey text', () => {
    history.loading = true
    history.error = false
    const html = open()
    expect(html).toContain('class="loading" role="status"')
    expect(html).toContain('spinner')
  })

  it('announces a failed read as an alert, which the load is not', () => {
    history.loading = false
    history.error = true
    const html = open()
    expect(html).toContain('state-error')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Could not load the history. Refresh to try again.')
    // The specific regression 2.14 exists to stop: the two rendering the same
    // thing. A failed read must not look like a load.
    expect(html).not.toContain('class="loading"')
  })

  it('states an empty trail in words, with no alert and no spinner', () => {
    history.loading = false
    history.error = false
    history.rows = []
    const html = open()
    expect(html).toContain('No changes recorded yet.')
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('spinner')
  })

  it('renders an entry as a time beside a sentence, and never a child name', () => {
    history.loading = false
    history.error = false
    history.rows = [
      {
        id: 'a1',
        occurredAt: '2026-08-20T09:12:00Z',
        actorId: 'coach-me',
        actorName: 'Sam Coach',
        action: 'player.team_changed',
        seasonId: CURRENT.id,
        teamId: 'titans',
        source: 'ui',
        changedFields: ['team_id'],
        safeChanges: { team_id: { old: 'trojans', new: 'titans' } },
      },
    ]
    const html = open()
    expect(html).toContain('history-list')
    expect(html).toContain('history-time')
    expect(html).toContain('Sam Coach')
    // The dialog's own body carries no child name: the name is the title's
    // subtitle, resolved by the caller through the players.view gated read,
    // and every entry describes a change rather than a person.
    const body = html.slice(html.indexOf('class="modal-body"'))
    expect(body).not.toContain(PLAYER.displayName)
  })
})

/* ---- the shared field, and the frozen wording ------------------------- */

describe('the Team picker is one field, used by both dialogs', () => {
  it('renders the label, the Unassigned option and every club team', () => {
    const html = render(<TeamField id="t" value="" teams={TEAMS} onChange={() => {}} />)
    expect(html).toMatch(/<label for="t">Team<\/label>/)
    expect(html).toMatch(/<option value=""[^>]*>Unassigned<\/option>/)
    expect(html).toContain('Titans')
    expect(html).toContain('Trojans')
  })
})

describe('the wording these dialogs are responsible for is unchanged', () => {
  // Presentation work is where copy quietly drifts, and two of these
  // sentences are the whole explanation of an irreversible action.
  it('keeps the withdraw consequence sentence', () => {
    const html = render(<WithdrawModal player={PLAYER} seasonName={CURRENT.name} onClose={() => {}} />)
    expect(html).toContain('as withdrawn for 2026/27')
    expect(html).toContain('The record keeps its team, shirt number and history, and can be restored later.')
    expect(html).toContain('Nothing is deleted.')
  })

  it('keeps the permanent deletion consequence sentence in full', () => {
    const html = render(<DeletePlayerModal player={PLAYER} onClose={() => {}} />)
    expect(html).toContain('every season registration from the club&#x27;s records')
    expect(html).toContain('a neutral Deleted player entry with no name')
    expect(html).toContain('This cannot be undone.')
    expect(html).toContain('Withdraw is the normal way to remove a player from a season.')
  })

  it('keeps the Spond data boundary sentence, which is a policy statement', () => {
    const html = render(
      <ImportFromSpondModal
        team={TEAMS[0]}
        mapping={{
          id: 'm1',
          groupId: 'g1',
          subgroupId: 's1',
          name: 'Titans',
          teamId: 'titans',
          teamName: 'Titans',
          createdAt: '2026-08-01T00:00:00Z',
        }}
        seasonName={CURRENT.name}
        onClose={() => {}}
      />,
    )
    expect(html).toContain('Each child&#x27;s full name is stored.')
    expect(html).toContain('No guardian, contact or other Spond data is imported.')
    expect(html).toContain('New players land as Pending.')
  })
})
