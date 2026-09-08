// =====================================================================
// VISUAL-03 with COACH-5, Admin Venues: the real page, rendered.
//
// AdminVenues.test.tsx covers the removal dialog as a presentational piece.
// This mounts the PAGE, which COACH-5 changed: every venue row now carries
// a Layouts link to that venue's own layouts screen, named for its venue,
// and the page is on the shared system. What is pinned is the half that
// must not move: the link's destination and name, the rename control still
// named for its row, the empty and error states, and that rendering the
// page writes nothing.
//
// This project has no DOM, so these are static renders: the dialog, a
// write in flight and a refused rename are unreachable here and are driven
// in a browser through tools/visual/admin.mjs.
// =====================================================================
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Session } from '../lib/data'
import type { Venue } from '../lib/venues'

const VENUES: Venue[] = [
  { id: 'v-haggs', name: 'Haggs Hill' },
  { id: 'v-flush', name: 'Flushdyke' },
]

const reads = {
  caps: new Set<string>(['club.manage']),
  venues: VENUES,
  loading: false,
  isError: false,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: () => {},
  ...over,
})

const writes: string[] = []
const mutation = () => ({ mutate: () => void writes.push('write'), isPending: false, isError: false, error: null })

vi.mock('react-router-dom', () => ({
  Link: ({ children, className, to, ...rest }: { children?: unknown; className?: string; to: string; 'aria-label'?: string }) => (
    <a className={className} href={to} aria-label={rest['aria-label']}>
      {children as never}
    </a>
  ),
}))

vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: [] as Session[], loading: false, error: null }),
}))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: reads.caps, isPending: false }),
  useVenues: () =>
    query(reads.loading || reads.isError ? undefined : reads.venues, {
      isLoading: reads.loading,
      isError: reads.isError,
      isSuccess: !reads.loading && !reads.isError,
    }),
  useInsertVenue: mutation,
  useRenameVenue: mutation,
  useDeleteVenue: mutation,
}))

const { AdminVenues } = await import('./AdminVenues')
const html = () => renderToStaticMarkup(<AdminVenues />)

beforeEach(() => {
  reads.caps = new Set(['club.manage'])
  reads.venues = VENUES
  reads.loading = false
  reads.isError = false
  writes.length = 0
})

describe('Admin Venues, rendered', () => {
  it('lists every venue with a rename control and a Layouts link, each named for its own venue', () => {
    const out = html()
    for (const v of VENUES) {
      expect(out).toContain(`aria-label="Rename ${v.name}"`)
      expect(out).toContain(`aria-label="Remove ${v.name}"`)
      expect(out).toContain(`aria-label="Layouts for ${v.name}"`)
      expect(out).toContain(`href="/admin/venues/${v.id}/layouts"`)
      expect(out).toMatch(new RegExp(`<label for="[^"]+" class="sr-only">Name for ${v.name}</label>`))
    }
  })

  it('is on the shared system: a page header, one card, the admin list', () => {
    const out = html()
    expect(out).toContain('class="card card-padded admin-narrow"')
    expect(out).toContain('class="admin-list"')
    expect(out).toContain('class="admin-add"')
    // No inline style at all: the sizes and steps come from the shared
    // stylesheet, which is what adoption means.
    expect(out).not.toContain('style="')
  })

  it('says what to do with no venues rather than showing a bare list', () => {
    reads.venues = []
    const out = html()
    expect(out).toContain('No venues yet')
    expect(out).not.toContain('class="admin-row"')
  })

  it('renders the error state, with a retry, rather than an empty club', () => {
    reads.isError = true
    const out = html()
    expect(out).toContain('role="alert"')
    expect(out).toContain('Retry')
    expect(out).not.toContain('No venues yet')
  })

  it('renders the loading state as a labelled status', () => {
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
