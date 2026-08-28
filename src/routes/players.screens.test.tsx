// =====================================================================
// VISUAL-02, Registered players: the real container, rendered.
//
// WHAT THIS IS FOR. Players.test.tsx and Players.bulk.test.tsx render the
// PIECES (the table, a card, the selection bar) with props handed to them.
// This renders the PAGE, over a stubbed data layer, and asserts what it
// shows in each state the Design Read's Part 4 names for this surface:
// normal, loading, empty, error, the archived read only season, the read
// only capability variant, and the absence of access.
//
// It exists because the pieces can each be right while the page composes
// them wrongly. Two of the defects this wave fixed were exactly that shape
// and neither piece test could see either: a failed register read rendered
// "0 players" beside three zero status chips, because every count derives
// from a rows array that defaults to empty; and the register's load was a
// centred spinner rather than the skeleton its known row shape asks for.
//
// WHAT IT CANNOT REACH. This project has no DOM, so these are static
// renders: they cover what the page shows WHEN IT OPENS. Which of the table
// and the card list is VISIBLE is a media query, and a media query has no
// answer without a viewport, so both are in the markup here and
// tools/visual/checks.mjs is what proves exactly one of them renders at 360,
// 390, 900, 901 and 1280. The same split applies to every 44px target and
// to the dialog's focus contract.
//
// Names in fixtures are invented. No real child appears.
// =====================================================================
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegisteredPlayer, Season, Team } from '../lib/data'

const CURRENT: Season = {
  id: 'season-2627',
  name: '2026/27',
  startsOn: '2026-08-01',
  endsOn: '2027-06-30',
  isCurrent: true,
  archivedAt: null,
}
const PAST: Season = {
  id: 'season-2526',
  name: '2025/26',
  startsOn: '2025-08-01',
  endsOn: '2026-06-30',
  isCurrent: false,
  archivedAt: '2026-07-01T00:00:00Z',
}

const CLUB_TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
]

const row = (over: Partial<RegisteredPlayer> & { playerId: string }): RegisteredPlayer => ({
  registrationId: `reg-${over.playerId}`,
  seasonId: CURRENT.id,
  teamId: 'titans',
  displayName: 'Aria Bexley-Thornton',
  shirtNumber: 4,
  status: 'registered',
  registeredDate: '2026-08-14',
  createdBy: 'coach-me',
  updatedAt: '2026-08-20T09:12:00Z',
  ...over,
})

const ROWS: RegisteredPlayer[] = [
  row({ playerId: 'p1' }),
  row({ playerId: 'p2', displayName: 'Callum Hedge', shirtNumber: 7, teamId: 'trojans' }),
  row({ playerId: 'p3', displayName: 'Devon Marsh', status: 'pending', registeredDate: null, shirtNumber: null }),
  row({ playerId: 'p4', displayName: 'Georgie Villiers', status: 'withdrawn', shirtNumber: 14 }),
]

// The mutable state every stub reads, so a test varies one fact without
// re-mocking the module.
const state = {
  caps: new Set<string>(['players.view', 'players.manage', 'players.delete', 'audit.view']),
  seasons: [CURRENT, PAST] as Season[],
  current: CURRENT as Season | undefined,
  rows: ROWS as RegisteredPlayer[],
  rowsLoading: false,
  rowsError: false,
  search: '' as string,
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

vi.mock('react-router-dom', () => ({
  Link: ({ children, className }: { children?: unknown; className?: string }) => (
    <a className={className}>{children as never}</a>
  ),
  // The structural filters live in the URL. A static render needs the read
  // half only; nothing here changes a filter.
  useSearchParams: () => [new URLSearchParams(state.search), () => {}],
}))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useSeasons: () => query(state.seasons),
  useCurrentSeason: () => query(state.current),
  useTeams: () => query(CLUB_TEAMS),
  useSpondMappings: () => query([]),
  useSpondLinks: () => query({ available: false, links: [] }),
  useRegisteredPlayers: () =>
    query(state.rowsError || state.rowsLoading ? undefined : state.rows, {
      isLoading: state.rowsLoading,
      isPending: state.rowsLoading,
      isError: state.rowsError,
      isSuccess: !state.rowsLoading && !state.rowsError,
    }),
}))

const { Players } = await import('./Players')
const html = () => renderToStaticMarkup(<Players />)

beforeEach(() => {
  state.caps = new Set(['players.view', 'players.manage', 'players.delete', 'audit.view'])
  state.seasons = [CURRENT, PAST]
  state.current = CURRENT
  state.rows = ROWS
  state.rowsLoading = false
  state.rowsError = false
  state.search = ''
})

describe('the register, as it opens', () => {
  it('is one page whose title is its only h1', () => {
    const out = html()
    expect(out.match(/<h1/g) ?? []).toHaveLength(1)
    expect(out).toContain('<h1>Registered players</h1>')
  })

  it('renders the table and the card list from one set of rows', () => {
    const out = html()
    expect(out).toContain('<table')
    expect(out).toContain('reg-cards')
    // Named once as a table cell and once as a card title, and no more, so
    // the two are one list rendered twice rather than two lists that could
    // drift. Matched as element text rather than as a bare substring: the
    // row menu's accessible name carries the child's name too.
    expect(out.match(/>Callum Hedge</g) ?? []).toHaveLength(2)
  })

  it('states a status as a badge carrying a dot and the word', () => {
    const out = html()
    // The Badge primitive, not a hand written span: a tone class, a dot and
    // the word. VISUAL-01 defined it and could not accept it, because this
    // is the only surface in the product that shows one on a list row.
    expect(out).toContain('class="badge badge-success"')
    expect(out).toContain('class="badge badge-warning"')
    expect(out).toContain('<span class="badge-dot" aria-hidden="true">')
    for (const word of ['Registered', 'Pending', 'Withdrawn']) expect(out).toContain(word)
    // The retired treatment: a bare coloured dot with the colour written
    // into the element.
    expect(out).not.toContain('class="status-badge"')
    expect(out).not.toMatch(/class="dot" style="background:/)
  })

  it('carries on the card the two columns the table drops below 1080px', () => {
    const out = html()
    expect(out).toContain('pc-dates')
    expect(out).toContain('Registered 14 Aug 2026')
    expect(out).toContain('Updated 20 Aug 2026')
  })

  it('counts the whole season, withdrawn included, while the filter hides it', () => {
    const out = html()
    expect(out).toContain('Withdrawn 1')
    // The withdrawn row is counted and NOT listed under the default filter.
    expect(out).not.toContain('Georgie Villiers')
  })
})

describe('a read that has not answered is never rendered as an empty club', () => {
  it('shows skeleton rows and an announcement while the register loads', () => {
    state.rowsLoading = true
    const out = html()
    expect(out).toContain('skeleton-list')
    expect(out).toContain('Loading the 2026/27 register…')
    expect(out).not.toContain('<table')
  })

  it('claims no count while the register loads', () => {
    state.rowsLoading = true
    const out = html()
    expect(out).not.toContain('reg-count')
    expect(out).not.toContain('0 players')
  })

  it('announces a failed register read and offers a retry', () => {
    state.rowsError = true
    const out = html()
    expect(out).toContain('role="alert"')
    expect(out).toContain('could not be loaded, so no players are shown')
    expect(out).toContain('>Retry<')
  })

  it('claims no count on a failed register read', () => {
    // The defect this pins: every number on the page derives from a rows
    // array that defaults to empty, so a failed read rendered "0 players"
    // and three zero chips, which is a claim about the club rather than
    // about the read.
    state.rowsError = true
    const out = html()
    expect(out).not.toContain('reg-count')
    expect(out).not.toContain('0 players')
    expect(out).not.toContain('Registered 0')
  })

  it('offers neither Export nor Import while the register is unsettled', () => {
    state.caps = new Set(['players.view', 'players.manage', 'players.export', 'players.import'])
    state.rowsError = true
    const out = html()
    expect(out).not.toContain('>Export<')
    expect(out).not.toContain('Import players')
  })
})

describe('an empty register says so rather than showing nothing', () => {
  it('names the season and the action that resolves it', () => {
    state.rows = []
    const out = html()
    expect(out).toContain('No players in 2026/27 yet')
    expect(out).toContain('Add the first player to open the register.')
  })

  it('tells a member who cannot add players that the register is empty, without offering an add', () => {
    state.rows = []
    state.caps = new Set(['players.view'])
    const out = html()
    expect(out).toContain('The register for this season is empty.')
    expect(out).not.toContain('Add the first player')
  })

  it('sends an admin to season setup when the club has no season at all', () => {
    state.seasons = []
    state.current = undefined
    state.caps = new Set(['players.view', 'seasons.manage'])
    const out = html()
    expect(out).toContain('Set up the first season')
    expect(out).toContain('Set up season')
  })

  it('tells a member who cannot manage seasons to wait for an admin', () => {
    state.seasons = []
    state.current = undefined
    state.caps = new Set(['players.view'])
    const out = html()
    expect(out).toContain('No season yet')
    expect(out).not.toContain('Set up season')
  })
})

describe('the archived season is read only and says why', () => {
  beforeEach(() => {
    state.search = `season=${PAST.id}`
  })

  it('states the reason as a neutral notice rather than a bare disabled control', () => {
    const out = html()
    expect(out).toContain('note note-neutral')
    expect(out).toContain('2025/26 is archived and read only.')
    expect(out).toContain('Switch to the current season to make changes.')
  })

  it('withdraws every write affordance and keeps the read ones', () => {
    const out = html()
    expect(out).not.toContain('Add player')
    expect(out).not.toContain('Select players')
    expect(out).not.toContain('Import players')
    expect(out).not.toContain('>Edit<')
    // History is a read and stays; so does the register itself.
    expect(out).toContain('>History<')
    expect(out).toContain('<table')
  })
})

describe('capability decides what is offered, and this wave moved none of it', () => {
  it('offers a manager on a writable season the add, the bulk mode and the row actions', () => {
    const out = html()
    expect(out).toContain('Add player')
    expect(out).toContain('Select players')
    expect(out).toContain('>Edit<')
    expect(out).toContain('More actions for')
  })

  it('offers a players.view only member the register and nothing to change it with', () => {
    state.caps = new Set(['players.view'])
    const out = html()
    expect(out).toContain('<table')
    expect(out).toContain('Aria Bexley-Thornton')
    for (const gone of ['Add player', 'Select players', '>Edit<', 'More actions for', '>History<']) {
      expect(out).not.toContain(gone)
    }
  })

  it('renders nothing at all without players.view', () => {
    // The route guard redirects before this component mounts; the component
    // refuses on its own account too, and it does so before any child data
    // read can fire.
    state.caps = new Set<string>()
    expect(html()).toBe('')
  })

  it('offers bulk selection only to a holder of both players.manage and players.delete', () => {
    state.caps = new Set(['players.view', 'players.manage', 'audit.view'])
    expect(html()).not.toContain('Select players')
    state.caps = new Set(['players.view', 'players.delete', 'audit.view'])
    expect(html()).not.toContain('Select players')
    state.caps = new Set(['players.view', 'players.manage', 'players.delete', 'audit.view'])
    expect(html()).toContain('Select players')
  })
})

describe('the surface uses the shared vocabulary rather than a local copy', () => {
  it('renders its actions through the Button primitive', () => {
    const out = html()
    expect(out).toContain('class="btn btn-primary"')
    expect(out).toContain('class="btn btn-ghost"')
    // The dead class VISUAL-01 resolved by implementing IconButton. It was
    // defined in no stylesheet in the repository, so every button carrying
    // it was wider than intended.
    expect(out).not.toContain('icon-only')
  })

  it('renders the row menu trigger as a named icon button', () => {
    const out = html()
    expect(out).toContain('aria-label="More actions for Aria Bexley-Thornton"')
    expect(out).toContain('class="icon-btn"')
  })

  it('sets no size, spacing or control colour inline', () => {
    const out = html()
    // The three the token scales exist to replace. A literal pixel margin is
    // matched by its digit, so var(--space-*) does not read as one.
    expect(out).not.toMatch(/style="[^"]*font-size/)
    expect(out).not.toMatch(/style="[^"]*margin(-top)?:\s*\d/)
    expect(out).not.toMatch(/style="[^"]*width:\s*\d/)
    // No control paints itself. The one inline background left on this
    // surface is the filter chip's status dot, and it is the shared Chip
    // primitive's own `dot` prop rather than this screen reaching past it:
    // three closed statuses, each a token string, assigned in ui.tsx.
    const inline = out.match(/style="[^"]*background:[^"]*"/g) ?? []
    expect(inline.every((s) => /var\(--(warning|success|slate-2)\)/.test(s))).toBe(true)
    for (const s of inline) expect(out).toMatch(new RegExp('chip-dot" ' + s.replace(/[(){}[\]*+?.\\^$|]/g, '\\$&')))
  })

  it('labels both filter selects with a real label bound to the control', () => {
    const out = html()
    expect(out).toContain('for="filter-team"')
    expect(out).toContain('for="filter-status"')
    expect(out).toContain('for="season-select"')
  })
})
