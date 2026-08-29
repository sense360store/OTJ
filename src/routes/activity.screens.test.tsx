// =====================================================================
// VISUAL-02, Activity: the real page, rendered.
//
// WHAT THIS IS FOR. Activity.test.tsx covers the pieces in isolation (a
// row, the filter controls, the two empty states). This mounts the PAGE,
// with the data layer stubbed, because the things this slice changed are
// page level: which state family a read lands in, what the header renders,
// what a viewer holding audit.view but not players.view is shown, and
// whether the feed is still name free once it is assembled from real rows
// rather than one hand written event.
//
// THE BOUNDARY IS THE POINT. The feed is deliberately child name free
// (docs/security/app-audit-boundary.md). A visual pass is exactly the kind
// of change that could leak one by resolving a name for a label, so the
// name the page DOES hold (the players.view gated identity map, which the
// History dialog's title needs) is planted in the stub and then asserted
// absent from every render below.
//
// WHAT IT CANNOT REACH. This project has no DOM, so these are static
// renders: they cover what the page shows for a given read. The filter
// dialog, the 900px reflow, the focus contract and every computed height
// are tools/visual/checks.mjs, which drives the real controls in a browser.
//
// Names in fixtures are invented. No real child appears.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ActivityEvent } from '../lib/activityView'
import type { Member, Season, Team } from '../lib/data'

const TEAMS: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'blue' },
  { id: 'trojans', name: 'Trojans', bibColour: 'red' },
]

const SEASONS: Season[] = [
  { id: 'season-2627', name: '2026/27', startsOn: '2026-08-01', endsOn: '2027-06-30', isCurrent: true, archivedAt: null },
]

const PROFILES: Member[] = [
  { id: 'coach-1', fullName: 'Marguerite Ashby-Fotheringay', avatar: null, avatarUrl: null, role: 'coach', teamId: null, joined: '', roles: [], teamIds: [], allTeams: false },
]

const BATCH = 'b0000001-0000-4000-8000-000000000001'

// The child name the page legitimately holds: the players.view gated identity
// map, which the History dialog's title is built from. It must never reach the
// feed, so it is planted here and asserted absent below.
const CHILD_NAME = 'Aria Bexley-Thornton'
const IDENTITIES = new Map([['player-live', CHILD_NAME]])

function ev(p: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    occurredAt: '2026-08-20T12:00:00.000000+00:00',
    actorId: 'coach-1',
    actorName: 'Marguerite Ashby-Fotheringay',
    action: 'player.created',
    entityType: 'player',
    entityId: 'player-live',
    seasonId: null,
    teamId: null,
    source: 'manual',
    changedFields: null,
    safeChanges: null,
    batchId: null,
    ...p,
  }
}

const EVENTS: ActivityEvent[] = [
  ev({ id: 'e1', action: 'player.withdrawn' }),
  ev({ id: 'e2', action: 'player.deleted', entityId: 'player-gone' }),
  ev({ id: 'e3', action: 'players.import_completed', entityType: 'import_batch', entityId: BATCH, source: 'csv_import' }),
  ev({ id: 'e4', action: 'player.registration_created', source: 'csv_import', batchId: BATCH }),
  ev({ id: 'e5', action: 'season.activated', entityType: 'season', entityId: 'season-2627', actorId: null, actorName: null }),
]

// What each read answers, so one describe can vary it without a second mock.
const reads = {
  caps: new Set(['audit.view', 'players.view']),
  events: EVENTS as ActivityEvent[] | undefined,
  loading: false,
  error: false,
  hasNextPage: false,
  fetchingNext: false,
  identities: IDENTITIES as Map<string, string> | undefined,
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

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useAuditActivity: () => ({
    data: reads.loading || reads.error ? undefined : { pages: [reads.events ?? []] },
    isLoading: reads.loading,
    isError: reads.error,
    refetch: () => {},
    hasNextPage: reads.hasNextPage,
    fetchNextPage: () => {},
    isFetchingNextPage: reads.fetchingNext,
  }),
  useProfiles: () => query(PROFILES),
  useTeams: () => query(TEAMS),
  useSeasons: () => query(SEASONS),
  useClubPlayerIdentities: () => query(reads.identities),
  usePlayerHistory: () => query([]),
}))

const { Activity, ActivityFilterControls } = await import('./Activity')

function page(at = '/activity'): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[at]}>
      <Routes>
        <Route path="/activity" element={<Activity />} />
      </Routes>
    </MemoryRouter>,
  )
}

// Restore the default reads after a describe has varied them, so the order
// tests run in cannot change what they assert.
function withReads(over: Partial<typeof reads>, run: () => void) {
  const before = { ...reads }
  Object.assign(reads, over)
  try {
    run()
  } finally {
    Object.assign(reads, before)
  }
}

/* ---- the privacy boundary ------------------------------------------- */

describe('the feed stays child name free whatever it renders', () => {
  // The page holds a name (the identity map) for exactly one purpose: the
  // History dialog's title. Every state below is rendered with that map
  // populated, so an accidental resolution would show up here rather than in
  // production.
  const STATES: [string, Partial<typeof reads>, string][] = [
    ['the ordinary feed', {}, '/activity'],
    ['a batch deep link', {}, `/activity?batch=${BATCH}`],
    ['loading', { loading: true }, '/activity'],
    ['a failed read', { error: true }, '/activity'],
    ['empty', { events: [] }, '/activity'],
    ['empty under a filter', { events: [] }, `/activity?batch=${BATCH}`],
    ['more pages waiting', { hasNextPage: true }, '/activity'],
    ['a viewer who cannot see names', { caps: new Set(['audit.view']) }, '/activity'],
  ]

  for (const [what, over, at] of STATES) {
    it(`renders no child name: ${what}`, () => {
      withReads(over, () => {
        const html = page(at)
        expect(html).not.toContain(CHILD_NAME)
        expect(html).not.toContain('Bexley')
      })
    })
  }

  it('never renders a raw metadata, request id or entity id value', () => {
    const html = page()
    // The event ids and the entity ids are the fields a "helpful" label could
    // leak. The batch id is the ONE id that reaches the markup, and only as a
    // deep link href, which is what makes a batch shareable.
    expect(html).not.toContain('player-live')
    expect(html).not.toContain('player-gone')
    expect(html.match(new RegExp(BATCH, 'g'))?.length).toBe(2)
    for (const href of html.matchAll(/href="([^"]*)"/g)) {
      expect(href[1]).toMatch(/^\/activity(\?batch=[0-9a-f-]+)?$/)
    }
  })
})

/* ---- the capability boundaries -------------------------------------- */

describe('audit.view and players.view stay two different boundaries', () => {
  it('renders nothing at all without audit.view', () => {
    withReads({ caps: new Set(['players.view']) }, () => {
      expect(page()).toBe('')
    })
  })

  // The entity CELLS, not the page text: "Player deleted" is a description and
  // would satisfy a search of the whole markup for "Player" with every player
  // reference removed. And PER ROW, not as totals: a regression that labels a
  // live child deleted and the deleted child live leaves every total unchanged
  // while the feed names the wrong row. Both Codex.
  const rowsOf = (html: string) =>
    [...html.matchAll(/<li class="activity-item">[\s\S]*?<\/li>/g)].map((row) => ({
      cell: /<span class="activity-entity[^"]*">([^<]*)<\/span>/.exec(row[0])?.[1] ?? '',
      history: row[0].includes('View history'),
    }))
  const entityCells = (html: string) => rowsOf(html).map((r) => r.cell)

  it('offers View history to a holder of both, on the row the reference is neutral for', () => {
    const rows = rowsOf(page())
    expect(rows.map((r) => r.cell)).toContain('Player')
    expect(rows.map((r) => r.cell)).toContain('Deleted player')
    expect(rows.some((r) => r.history)).toBe(true)
    // The two halves of one row, paired. Asserting the labels and the buttons
    // separately leaves the swap invisible: a live child labelled deleted and
    // a deleted one labelled live changes no count and no total. Codex.
    for (const r of rows) {
      if (r.history) expect(r.cell).toBe('Player')
      if (r.cell === 'Deleted player') expect(r.history).toBe(false)
    }
  })

  it('offers no history and claims no deletion with audit.view alone', () => {
    const both = entityCells(page())
    withReads({ caps: new Set(['audit.view']) }, () => {
      const html = page()
      expect(html).not.toContain('View history')
      const audit = entityCells(html)
      // Fail closed: a viewer who cannot name a child is never told one was
      // deleted, because that is a fact about a child they may not resolve.
      // Stated as a per row identity, so it cannot be satisfied by the
      // references being gone NOR by two rows swapping labels: the cell of
      // each event that read "Player" or "Deleted player" reads the neutral
      // "Player", and every other cell is the string it was.
      expect(audit).toHaveLength(both.length)
      const PLAYER = new Set(['Player', 'Deleted player'])
      expect(audit).toEqual(both.map((label) => (PLAYER.has(label) ? 'Player' : label)))
    })
  })

  it('claims no deletion while the identity map is still unread', () => {
    withReads({ identities: undefined }, () => {
      const html = page()
      expect(html).not.toContain('Deleted player')
      expect(html).not.toContain('View history')
    })
  })
})

/* ---- the state families are visually distinct ----------------------- */

describe('every reachable state lands in its own primitive', () => {
  it('loads as skeleton rows, not as a spinner and not as an error', () => {
    withReads({ loading: true }, () => {
      const html = page()
      expect(html).toContain('skeleton-list')
      expect(html).not.toContain('class="loading"')
      expect(html).not.toContain('state-error')
      // The bars are decoration, so the load is announced in words.
      expect(html).toContain('role="status"')
    })
  })

  it('fails into the danger state with a retry, never the loading treatment', () => {
    withReads({ error: true }, () => {
      const html = page()
      expect(html).toContain('class="state-error" role="alert"')
      expect(html).toContain('Retry')
      expect(html).not.toContain('skeleton-list')
    })
  })

  it('separates the two empty states, and only the filtered one offers Clear', () => {
    withReads({ events: [] }, () => {
      const bare = page()
      expect(bare).toContain('No activity yet.')
      expect(bare).not.toContain('Clear filters')
      const filtered = page(`/activity?batch=${BATCH}`)
      expect(filtered).toContain('No activity in this range.')
      expect(filtered).toContain('Clear filters')
      expect(filtered).toContain('empty-action')
    })
  })

  it('says a batch deep link is narrowing the feed, as a Note', () => {
    const html = page(`/activity?batch=${BATCH}`)
    expect(html).toContain('note note-info')
    expect(html).toContain('Filtered to one batch.')
    // And says nothing when no batch is applied.
    expect(page()).not.toContain('Filtered to one batch.')
  })

  it('offers Load more only when another page is waiting, and disables it in flight', () => {
    expect(page()).not.toContain('Load more')
    withReads({ hasNextPage: true }, () => {
      const html = page()
      expect(html).toContain('Load more')
      expect(html).not.toContain('disabled')
    })
    withReads({ hasNextPage: true, fetchingNext: true }, () => {
      const html = page()
      expect(html).toContain('Loading…')
      expect(html).toContain('disabled')
      expect(html).toContain('aria-busy="true"')
    })
  })
})

/* ---- the shared vocabulary ------------------------------------------ */

describe('the page is drawn with the shared system', () => {
  it('heads the page with the PageHeader h1 and one action', () => {
    const html = page()
    expect(html).toContain('<div class="page-head">')
    expect(html).toContain('<h1>Activity</h1>')
    expect(html).toContain('page-head-acts')
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('counts the active filters in the Filters control, visibly and programmatically', () => {
    expect(page()).toContain('aria-label="Filters"')
    const filtered = page(`/activity?batch=${BATCH}`)
    expect(filtered).toContain('aria-label="Filters, 1 active"')
    expect(filtered).toContain('Filters (1)')
  })

  it('draws every button with the Button primitive, never a hand written class string', () => {
    // Each of these was `className="btn btn-ghost…"` before this slice. The
    // check is that a <button> on this page always carries the .btn class the
    // primitive emits, so a raw element cannot creep back in.
    const html = page(`/activity?batch=${BATCH}`)
    const buttons = [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0])
    expect(buttons.length).toBeGreaterThan(0)
    for (const b of buttons) expect(b).toMatch(/class="[^"]*\bbtn\b/)
  })

  it('sets no font size inline anywhere it renders', () => {
    for (const at of ['/activity', `/activity?batch=${BATCH}`]) {
      expect(page(at)).not.toContain('font-size')
    }
  })
})

/* ---- the filter controls, mounted twice ----------------------------- */

describe('the two filter mount points cannot collide', () => {
  it('binds every control to its own label, with ids unique across both copies', () => {
    // The desktop bar and the phone dialog render the SAME component, and both
    // are in the document at once below 900px. Before this slice that was why
    // no control had an id; now each gets one from useId, and the rule that
    // matters is that the two sets are disjoint.
    const both = renderToStaticMarkup(
      <div>
        <ActivityFilterControls
          filters={{ from: '', to: '', actorId: '', entity: '', action: '', teamId: '', seasonId: '', source: '', batchId: '' }}
          onChange={() => {}}
          actors={PROFILES}
          teams={TEAMS}
          seasons={SEASONS}
        />
        <ActivityFilterControls
          filters={{ from: '', to: '', actorId: '', entity: '', action: '', teamId: '', seasonId: '', source: '', batchId: '' }}
          onChange={() => {}}
          actors={PROFILES}
          teams={TEAMS}
          seasons={SEASONS}
        />
      </div>,
    )
    const ids = [...both.matchAll(/<(?:input|select)[^>]*\bid="([^"]+)"/g)].map((m) => m[1])
    const labelled = [...both.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1])
    expect(ids).toHaveLength(16)
    expect(new Set(ids).size).toBe(16)
    expect(labelled.sort()).toEqual(ids.sort())
  })
})
