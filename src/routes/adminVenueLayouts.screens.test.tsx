// =====================================================================
// COACH-5, Admin Venue Layouts: the real page, rendered.
//
// The scope controls, the four shape cards, the drawing, and every sentence
// the page says when it cannot offer a card: no club age groups, no seasons,
// a venue that is gone. The scope defaults are pinned here because they are
// the one place is_current is allowed to be a default: the current season,
// and the club's first age group.
//
// This project has no DOM, so these are static renders: a press on Draw,
// a drag, a save in flight, a refused save and the removal dialog are
// unreachable here. The editor's pure moves are driven in
// src/lib/venueLayout.test.ts and the page is driven in a browser through
// tools/visual/admin.mjs.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Season } from '../lib/data'
import type { Venue } from '../lib/venues'
import { emptyLayoutZones, type VenueLayout } from '../lib/venueLayout'

const VENUES: Venue[] = [{ id: 'v-haggs', name: 'Haggs Hill' }]
const SEASONS: Season[] = [
  { id: 's26', name: '2026/27', startsOn: '2026-07-01', endsOn: '2027-06-30', isCurrent: true, archivedAt: null },
  { id: 's25', name: '2025/26', startsOn: '2025-07-01', endsOn: '2026-06-30', isCurrent: false, archivedAt: '2026-07-02T00:00:00Z' },
]
const AGE_GROUPS = ['U7s', 'U8s']
const FIVE: VenueLayout = {
  id: 'l5',
  venueId: 'v-haggs',
  seasonId: 's26',
  ageGroup: 'U7s',
  kind: 'stations',
  slots: 5,
  zones: { ...emptyLayoutZones({ kind: 'stations', slots: 5 }), size: { metresWide: 60, metresLong: 40 } },
  storedZones: null,
}
const UNREADABLE: VenueLayout = { ...FIVE, id: 'l1', kind: 'games', slots: 1, zones: null }

const reads = {
  caps: new Set<string>(['club.manage']),
  venueId: 'v-haggs',
  venues: VENUES,
  seasons: SEASONS,
  ageGroups: AGE_GROUPS as string[],
  layouts: [FIVE, UNREADABLE] as VenueLayout[],
  loading: false,
  isError: false,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  dataUpdatedAt: 1,
  isLoading: reads.loading,
  isPending: reads.loading,
  isError: reads.isError,
  isSuccess: !reads.loading && !reads.isError,
  error: null,
  refetch: () => {},
  ...over,
})

const writes: string[] = []
const mutation = () => ({ mutate: () => void writes.push('write'), isPending: false, isError: false, error: null })

vi.mock('react-router-dom', () => ({
  Link: ({ children, className, to }: { children?: unknown; className?: string; to: string }) => (
    <a className={className} href={to}>
      {children as never}
    </a>
  ),
  useParams: () => ({ venueId: reads.venueId }),
}))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useVenues: () => query(reads.venues),
  useSeasons: () => query(reads.seasons),
  useClubAgeGroups: () => query(reads.ageGroups),
  useVenueLayouts: () => query(reads.layouts),
  useSaveVenueLayout: mutation,
  useDeleteVenueLayout: mutation,
  isVenueLayoutScopeTaken: () => false,
}))

const { AdminVenueLayouts } = await import('./AdminVenueLayouts')
const html = () => renderToStaticMarkup(<AdminVenueLayouts />)

beforeEach(() => {
  reads.caps = new Set(['club.manage'])
  reads.venueId = 'v-haggs'
  reads.venues = VENUES
  reads.seasons = SEASONS
  reads.ageGroups = AGE_GROUPS
  reads.layouts = [FIVE, UNREADABLE]
  reads.loading = false
  reads.isError = false
  writes.length = 0
})

describe('Admin Venue Layouts, rendered', () => {
  it('names the venue, defaults the scope to the current season and the first club age group', () => {
    const out = html()
    expect(out).toContain('Layouts at Haggs Hill')
    expect(out).toContain('value="s26" selected')
    expect(out).toContain('>2026/27 (current)<')
    expect(out).toContain('>2025/26 (archived)<')
    expect(out).toContain('value="U7s" selected')
    expect(out).toContain('>U8s<')
  })

  it('shows the four shapes, the drawn one as a drawing and the rest as not drawn', () => {
    const out = html()
    for (const title of ['Four stations', 'Five stations', 'One game', 'Two games']) expect(out).toContain(`<h2>${title}</h2>`)
    expect(out).toContain('aria-label="Five stations at Haggs Hill"')
    expect(out).toContain('aria-label="Edit Five stations"')
    expect(out).toContain('aria-label="Remove Five stations"')
    expect(out).toContain('aria-label="Draw Four stations"')
    expect(out).toContain('aria-label="Draw Two games"')
    expect((out.match(/Not drawn yet for this season and age group/g) ?? []).length).toBe(2)
    expect(out).toContain('1 of 4 drawn')
  })

  it('draws every zone with its number and describes the drawing in words', () => {
    const out = html()
    for (const n of [1, 2, 3, 4, 5]) expect(out).toContain(`>${n}</text>`)
    expect(out).toContain('5 stations on 60 by 40 metres')
    expect(out).toContain('Station 1, 2% across, 2% down, 30% by 45%')
    // The declared size sets the drawing's ratio: 60 by 40 is 3:2.
    expect(out).toContain('viewBox="0 0 600 400"')
  })

  it('says a stored layout it cannot read must be drawn again, and offers Draw rather than Edit', () => {
    const out = html()
    expect(out).toContain('cannot read')
    expect(out).toContain('aria-label="Draw One game"')
    expect(out).toContain('aria-label="Remove One game"')
  })

  it('points at the Club screen when the club has no age groups, and offers no card', () => {
    reads.ageGroups = []
    const out = html()
    expect(out).toContain('no age groups yet')
    expect(out).toContain('href="/admin/club"')
    expect(out).not.toContain('<h2>Four stations</h2>')
  })

  it('says so when the club has no seasons', () => {
    reads.seasons = []
    const out = html()
    expect(out).toContain('no seasons yet')
    expect(out).not.toContain('<h2>Four stations</h2>')
  })

  it('says a missing venue is gone and links back', () => {
    reads.venueId = 'v-gone'
    const out = html()
    expect(out).toContain('Venue not found')
    expect(out).toContain('href="/admin/venues"')
  })

  it('renders the error and loading states', () => {
    reads.isError = true
    expect(html()).toContain('role="alert"')
    reads.isError = false
    reads.loading = true
    expect(html()).toContain('role="status"')
  })

  it('renders nothing for a member without club.manage', () => {
    reads.caps = new Set(['sessions.create'])
    expect(html()).toBe('')
  })

  it('writes nothing by rendering', () => {
    html()
    expect(writes).toEqual([])
  })
})
