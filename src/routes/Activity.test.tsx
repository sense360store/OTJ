import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActivityEmpty, ActivityFilterControls, ActivityItem, type ActivityItemContext } from './Activity'
import { ErrorNote, Loading } from '../components/ui'
import { CapGate } from '../components/RequireCap'
import { moreItemsFor, navItemsFor } from '../components/nav'
import type { ActivityEvent } from '../lib/activityView'
import type { Member, Season, Team } from '../lib/data'

// The presentational pieces of the Activity page are covered with the static
// renderer, the same style as the rest of the suite; the filtering, renderer,
// serialisation and pagination logic is unit tested in activityView.test.ts, and
// the read boundary is enforced by the security suite. These pin the capability
// gating of the nav and route, the safe (name free) row rendering, the deleted
// entity handling, the labelled filter controls, and that the list is never a
// desktop table.

const CAPS = {
  admin: new Set(['audit.view', 'players.view', 'sessions.create']),
  manager: new Set(['audit.view', 'players.view', 'players.manage', 'sessions.create']),
  coach: new Set(['players.view', 'sessions.create']), // no audit.view
  parent: new Set<string>(), // no sessions.create, no audit.view
}

function ev(p: Partial<ActivityEvent> & { id: string }): ActivityEvent {
  return {
    occurredAt: '2026-07-20T12:00:00.000000+00:00',
    actorId: 'actor-1',
    actorName: 'Test Actor',
    action: 'player.created',
    entityType: 'player',
    entityId: 'p-live',
    seasonId: null,
    teamId: null,
    source: 'manual',
    changedFields: null,
    safeChanges: null,
    batchId: null,
    ...p,
  }
}

const ctx: ActivityItemContext = {
  teamName: (id) => (id == null ? 'Unassigned' : id === 'titans' ? 'Titans' : 'Deleted team'),
  seasonName: (id) => (id === 'season-1' ? '2026/27' : null),
  formatDate: (iso) => iso,
  canSeeNames: true,
  playerExists: (id) => id === 'p-live',
  onViewHistory: () => {},
}

function itemHtml(event: ActivityEvent, c: ActivityItemContext = ctx): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ul className="activity-list">
        <ActivityItem event={event} ctx={c} />
      </ul>
    </MemoryRouter>,
  )
}

// Names that must never appear in the feed, whatever the event.
const FORBIDDEN = ['Old Synthetic', 'New Synthetic', 'Synthetic Child']

// ---- Nav and route capability gating ---------------------------------------

describe('Activity nav gating', () => {
  it('shows the Activity item to managers and admins (audit.view holders)', () => {
    expect(navItemsFor(CAPS.admin).some((i) => i.id === 'activity')).toBe(true)
    expect(navItemsFor(CAPS.manager).some((i) => i.id === 'activity')).toBe(true)
  })

  it('hides it from a coach without audit.view', () => {
    expect(navItemsFor(CAPS.coach).some((i) => i.id === 'activity')).toBe(false)
  })

  it('hides it from a parent entirely (never in the parent nav)', () => {
    expect(navItemsFor(CAPS.parent).some((i) => i.id === 'activity')).toBe(false)
    // Even a parent shaped set that somehow held audit.view gets the parent
    // nav, which carries no Activity item.
    expect(navItemsFor(new Set(['audit.view'])).some((i) => i.id === 'activity')).toBe(false)
  })

  it('surfaces it in the mobile More sheet for audit.view holders only', () => {
    expect(moreItemsFor(CAPS.manager).some((i) => i.id === 'activity')).toBe(true)
    expect(moreItemsFor(CAPS.coach).some((i) => i.id === 'activity')).toBe(false)
  })
})

describe('Activity route capability gate', () => {
  function renderAt(caps: Set<string>): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={['/activity']}>
        <Routes>
          <Route element={<CapGate caps={caps} cap="audit.view" redirect="/" />}>
            <Route path="activity" element={<span>ACTIVITY_PAGE</span>} />
          </Route>
          <Route path="/" element={<span>HOME</span>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('lets a manager and an admin in', () => {
    expect(renderAt(CAPS.manager)).toContain('ACTIVITY_PAGE')
    expect(renderAt(CAPS.admin)).toContain('ACTIVITY_PAGE')
  })

  it('redirects a coach without audit.view and a parent away (page never mounts)', () => {
    // A redirect renders null under the static renderer, so a blocked screen
    // simply never appears (the same convention as RequireCap.test.tsx).
    expect(renderAt(CAPS.coach)).not.toContain('ACTIVITY_PAGE')
    expect(renderAt(CAPS.parent)).not.toContain('ACTIVITY_PAGE')
  })
})

// ---- Row rendering (safe, name free) ---------------------------------------

describe('ActivityItem renders safely', () => {
  it('renders the actor snapshot, description and source, and offers View history for an existing player', () => {
    const html = itemHtml(ev({ id: 'a', action: 'player.withdrawn', entityId: 'p-live', source: 'manual' }))
    expect(html).toContain('Test Actor')
    expect(html).toContain('Withdrawn')
    expect(html).toContain('Manual')
    expect(html).toContain('View history')
    // The player reference is neutral in the feed, never a name.
    expect(html).toContain('Player')
  })

  it('renders a deleted player neutrally and offers no View history', () => {
    const html = itemHtml(ev({ id: 'a', action: 'player.deleted', entityId: 'gone' }))
    expect(html).toContain('Deleted player')
    expect(html).not.toContain('View history')
  })

  it('fails closed to a neutral player with no history when the viewer cannot see names', () => {
    const html = itemHtml(ev({ id: 'a', entityId: 'p-live' }), { ...ctx, canSeeNames: false })
    expect(html).not.toContain('View history')
    expect(html).not.toContain('Deleted player')
    expect(html).toContain('Player')
  })

  it('renders a display name correction as the fixed copy, never an old or new name', () => {
    const html = itemHtml(
      ev({
        id: 'a',
        action: 'player.updated',
        changedFields: ['display_name'],
        safeChanges: { display_name: { old: 'Old Synthetic', new: 'New Synthetic' } } as never,
      }),
    )
    expect(html).toContain('Player name corrected')
    for (const name of FORBIDDEN) expect(html).not.toContain(name)
  })

  it('renders a team change with a deleted team label, never an id leak of a name', () => {
    const html = itemHtml(
      ev({ id: 'a', action: 'player.team_changed', safeChanges: { team_id: { old: 'titans', new: 'ghost' } } }),
    )
    expect(html).toContain('Team changed: Titans to Deleted team')
  })

  it('renders a season event with the resolved season name', () => {
    const html = itemHtml(ev({ id: 'a', action: 'season.activated', entityType: 'season', entityId: 'season-1' }))
    expect(html).toContain('Season activated')
    expect(html).toContain('2026/27')
  })

  const BATCH_9 = 'b0000009-0000-4000-8000-000000000009'
  const BATCH_7 = 'b0000007-0000-4000-8000-000000000007'

  it('links an import batch reference to the batch deep link', () => {
    const html = itemHtml(
      ev({ id: 'a', action: 'players.import_completed', entityType: 'import_batch', entityId: BATCH_9, source: 'csv_import' }),
    )
    expect(html).toContain('Players imported')
    expect(html).toContain('CSV import')
    expect(html).toContain(`href="/activity?batch=${BATCH_9}"`)
    expect(html).toContain('Import batch')
  })

  it('renders a per row batch chip on an imported player event', () => {
    const html = itemHtml(
      ev({ id: 'a', action: 'player.registration_created', entityId: 'p-live', source: 'csv_import', batchId: BATCH_7 }),
    )
    expect(html).toContain(`href="/activity?batch=${BATCH_7}"`)
    expect(html).toContain('>Batch<')
  })

  it('renders System when the actor was deleted (null snapshot) and keeps rendering', () => {
    const html = itemHtml(ev({ id: 'a', actorId: null, actorName: null, action: 'player.created' }))
    expect(html).toContain('System')
  })

  it('is a list item, never a table (the mobile card is not a second desktop layout)', () => {
    const html = itemHtml(ev({ id: 'a' }))
    expect(html).toContain('<li')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<td')
  })
})

// ---- States (shared Loading/ErrorNote + both empty states) -----------------

describe('Activity states', () => {
  it('uses the shared Loading and ErrorNote primitives', () => {
    expect(renderToStaticMarkup(<Loading />)).toContain('Loading')
    expect(renderToStaticMarkup(<ErrorNote />)).toContain('went wrong')
  })

  it('renders "No activity yet." with no filters and offers no Clear', () => {
    const html = renderToStaticMarkup(<ActivityEmpty active={false} onClear={() => {}} />)
    expect(html).toContain('No activity yet.')
    expect(html).not.toContain('Clear filters')
  })

  it('renders "No activity in this range." with a Clear filters button when filters are active', () => {
    const html = renderToStaticMarkup(<ActivityEmpty active onClear={() => {}} />)
    expect(html).toContain('No activity in this range.')
    expect(html).toContain('Clear filters')
  })
})

// ---- Filter controls (labelled, keyboard operable) -------------------------

describe('ActivityFilterControls', () => {
  const actors: Member[] = [
    { id: 'm1', fullName: 'Alex Coach', avatar: null, avatarUrl: null, role: 'coach', teamId: null, joined: '', roles: [], teamIds: [], allTeams: false },
  ]
  const teams: Team[] = [{ id: 'titans', name: 'Titans' }]
  const seasons: Season[] = [{ id: 'season-1', name: '2026/27', startsOn: '', endsOn: '', isCurrent: true, archivedAt: null }]

  function html(f = { from: '', to: '', actorId: '', entity: '' as const, action: '', teamId: '', seasonId: '', source: '' as const, batchId: '' }): string {
    return renderToStaticMarkup(
      <ActivityFilterControls filters={f} onChange={() => {}} actors={actors} teams={teams} seasons={seasons} />,
    )
  }

  it('renders every filter with a visible label and a programmatic aria-label', () => {
    const h = html()
    for (const visible of ['From date', 'To date', 'Actor', 'Entity', 'Action', 'Team', 'Season', 'Source']) {
      expect(h).toContain(visible)
    }
    for (const aria of [
      'aria-label="Filter from date"',
      'aria-label="Filter to date"',
      'aria-label="Filter by actor"',
      'aria-label="Filter by entity type"',
      'aria-label="Filter by action"',
      'aria-label="Filter by team"',
      'aria-label="Filter by season"',
      'aria-label="Filter by source"',
    ]) {
      expect(h).toContain(aria)
    }
  })

  it('offers the four entity options and the eight source options', () => {
    const h = html()
    for (const entity of ['>Player<', '>Season<', '>Import<', '>Export<']) expect(h).toContain(entity)
    for (const src of ['>Manual<', '>CSV import<', '>XLSX import<', '>Spond import<', '>Renewal<', '>System<', '>Edge function<', '>Database trigger<']) {
      expect(h).toContain(src)
    }
  })

  it('uses date inputs for the range, not free text', () => {
    expect(html()).toContain('type="date"')
  })
})
