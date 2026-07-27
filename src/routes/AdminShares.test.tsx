import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CapGate } from '../components/RequireCap'
import { moreItemsFor, navItemsFor } from '../components/nav'
import { screenFromPath } from '../lib/screen'
import {
  FORMER_MEMBER_LABEL,
  KILL_SWITCH_NOTE,
  NO_LINK_CONTROLS_NOTE,
  REVIEW_UNAVAILABLE_NOTE,
  REVOKE_CONFIRM_NOTE,
  SOURCE_DELETED_LABEL,
} from '../lib/sharesView'
import type { ManagedShare, ManagedSharesPage } from '../lib/queries'
import type { Member } from '../lib/data'
import type { PublicDrillSnapshot } from '../lib/publicShare'

// The Shared links screen. The presentational pieces render through the static
// renderer, the repo's standard, and the container's own branches (loading,
// error, empty, kill switch, paging, capability) render with the data hooks
// mocked, the same style as PublicShareControl.gating.test.tsx: no QueryClient,
// no DOM, no network. The wire shape and the pasted link handling are unit
// tested in src/lib/sharesView.test.ts, and the server is the real boundary.

// ---- Mocked data layer ------------------------------------------------------

let caps = new Set<string>(['shares.manage'])
let listResult: {
  data?: { pages: ManagedSharesPage[] }
  isPending: boolean
  isError: boolean
  error?: Error
  hasNextPage: boolean
  isFetchingNextPage: boolean
}
let detailResult: { data?: { snapshot: unknown; hasSnapshot: boolean }; isPending: boolean; isError: boolean; error?: Error }

vi.mock('../lib/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/queries')>()
  return {
    ...actual,
    useMyCapabilities: () => ({ caps, isPending: false }),
    useProfiles: () => ({ data: members }),
    useManagedShares: () => ({ ...listResult, refetch: vi.fn(), fetchNextPage: vi.fn() }),
    useManagedShareDetail: () => ({ ...detailResult, refetch: vi.fn() }),
    useRevokeManagedShare: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
    useMemberActiveShareCount: () => ({ data: null }),
  }
})

const {
  AdminShares,
  ShareFilterControls,
  ShareLookupField,
  ShareReviewBody,
  ShareReviewModal,
  ShareRow,
  SharesEmpty,
  SharesSummary,
  ShareStatusBadge,
  ShareTurnOffBody,
  ShareTurnOffModal,
} = await import('./AdminShares')

// ---- Fixtures ---------------------------------------------------------------

const SHARE_ID = '3f1c9d2e-4b7a-4c8d-9e10-5a6b7c8d9e0f'
const MEMBER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d'

const members: Member[] = [
  {
    id: MEMBER_ID,
    fullName: 'Alex Coach',
    avatar: null,
    avatarUrl: null,
    role: 'coach',
    teamId: null,
    joined: '',
    roles: [],
    teamIds: [],
    allTeams: false,
  },
]

function share(over: Partial<ManagedShare> = {}): ManagedShare {
  return {
    shareId: SHARE_ID,
    kind: 'drill',
    sourceId: '11111111-1111-1111-1111-111111111111',
    sourceTitle: 'Rondo under pressure',
    status: 'active',
    createdById: MEMBER_ID,
    createdByName: 'Alex Coach',
    unattributed: false,
    createdAt: '2026-06-16T10:00:00.000Z',
    expiresAt: null,
    refreshedAt: null,
    rotatedAt: null,
    revokedAt: null,
    snapshotVersion: 1,
    ...over,
  }
}

function page(over: Partial<ManagedSharesPage> = {}): ManagedSharesPage {
  return { shares: [share()], sharingEnabled: true, hasMore: false, nextCursor: null, total: 1, ...over }
}

function drillSnapshot(over: Partial<PublicDrillSnapshot> = {}): PublicDrillSnapshot {
  return {
    snapshotVersion: 1,
    kind: 'drill',
    title: 'Rondo under pressure',
    summary: 'A possession square.',
    classification: { type: 'corner', value: 'technical' },
    skill: 'Passing',
    ages: ['U9'],
    level: 'Developing',
    duration: 15,
    playerGuidance: '6 to 8 players',
    area: '12 by 12 metres',
    equipment: ['cones'],
    setupNotes: 'Four on the square.',
    coachingPoints: ['Open the body.'],
    easier: [],
    harder: [],
    theme: null,
    format: null,
    sourceAttribution: null,
    media: [],
    snapshotAt: '2026-06-16T10:00:00.000Z',
    ...over,
  }
}

const fmt = (iso: string | null) => (iso ? iso.slice(0, 10) : 'Unknown')

function pageHtml(): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={['/admin/shares']}>
      <AdminShares />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  caps = new Set<string>(['shares.manage'])
  listResult = { data: { pages: [page()] }, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false }
  detailResult = { data: { snapshot: drillSnapshot(), hasSnapshot: true }, isPending: false, isError: false }
})

// ---- Nav and route capability gating ---------------------------------------

describe('Shared links nav gating', () => {
  it('shows the item to shares.manage holders', () => {
    expect(navItemsFor(new Set(['sessions.create', 'shares.manage'])).some((i) => i.id === 'admin-shares')).toBe(true)
    expect(navItemsFor(new Set(['shares.manage'])).some((i) => i.id === 'admin-shares')).toBe(true)
  })

  it('hides it from a coach who can only create shares, and from a parent', () => {
    expect(navItemsFor(new Set(['sessions.create', 'shares.create'])).some((i) => i.id === 'admin-shares')).toBe(false)
    expect(navItemsFor(new Set()).some((i) => i.id === 'admin-shares')).toBe(false)
  })

  it('does not ride in on club.manage alone', () => {
    expect(navItemsFor(new Set(['club.manage'])).some((i) => i.id === 'admin-shares')).toBe(false)
  })

  it('surfaces it in the mobile More sheet for holders only', () => {
    expect(moreItemsFor(new Set(['sessions.create', 'shares.manage'])).some((i) => i.id === 'admin-shares')).toBe(true)
    expect(moreItemsFor(new Set(['sessions.create'])).some((i) => i.id === 'admin-shares')).toBe(false)
  })

  it('maps its pathname to a screen key, so the nav entry can highlight', () => {
    expect(screenFromPath('/admin/shares')).toBe('admin-shares')
    expect(screenFromPath('/admin/spond')).toBe('admin-spond')
  })
})

describe('Shared links route capability gate', () => {
  function renderAt(set: Set<string>): string {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={['/admin/shares']}>
        <Routes>
          <Route element={<CapGate caps={set} cap="shares.manage" redirect="/" />}>
            <Route path="admin/shares" element={<span>SHARES_PAGE</span>} />
          </Route>
          <Route path="/" element={<span>HOME</span>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('lets a shares.manage holder in', () => {
    expect(renderAt(new Set(['shares.manage']))).toContain('SHARES_PAGE')
  })

  it('redirects a coach with shares.create only, and a parent, away', () => {
    expect(renderAt(new Set(['sessions.create', 'shares.create']))).not.toContain('SHARES_PAGE')
    expect(renderAt(new Set())).not.toContain('SHARES_PAGE')
  })
})

// ---- Row rendering ----------------------------------------------------------

function rowHtml(s: ManagedShare): string {
  return renderToStaticMarkup(
    <ul>
      <ShareRow share={s} formatDate={fmt} onReview={() => {}} onTurnOff={() => {}} />
    </ul>,
  )
}

describe('ShareRow', () => {
  it('renders the source title, kind, status, dates and creator', () => {
    const html = rowHtml(share())
    expect(html).toContain('Rondo under pressure')
    expect(html).toContain('Drill')
    expect(html).toContain('Active')
    expect(html).toContain('Created 2026-06-16')
    expect(html).toContain('No expiry')
    expect(html).toContain('Made by Alex Coach')
  })

  it('renders an expiry date when the link has one', () => {
    expect(rowHtml(share({ expiresAt: '2026-09-01T00:00:00.000Z' }))).toContain('Expires 2026-09-01')
  })

  it('renders a neutral label when the source was deleted', () => {
    const html = rowHtml(share({ sourceTitle: null, sourceId: null }))
    expect(html).toContain(SOURCE_DELETED_LABEL)
  })

  it('marks a link whose creator has left the club as made by a former member', () => {
    const html = rowHtml(share({ createdById: null, createdByName: null, unattributed: true }))
    expect(html).toContain(`Made by ${FORMER_MEMBER_LABEL}`)
  })

  it('offers Review and Turn off as keyboard operable buttons with 44px touch targets', () => {
    const html = rowHtml(share())
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html).toContain('min-height:44px')
    expect(html).toContain('Review')
    expect(html).toContain('Turn off')
    // Each action names the link it acts on, so the two buttons are
    // distinguishable out of context.
    expect(html).toContain('aria-label="Review what Rondo under pressure makes public"')
    expect(html).toContain('aria-label="Turn off the link for Rondo under pressure"')
  })

  it('drops Turn off for a link that is already off, and keeps Review', () => {
    const html = rowHtml(share({ status: 'revoked', revokedAt: '2026-07-01T00:00:00.000Z' }))
    expect(html).toContain('Turned off')
    expect(html).toContain('Review')
    expect(html).not.toContain('aria-label="Turn off the link for')
  })

  it('renders an expired link with its own status, still reviewable', () => {
    const html = rowHtml(share({ status: 'expired', expiresAt: '2026-01-01T00:00:00.000Z' }))
    expect(html).toContain('Expired')
    expect(html).toContain('Review')
  })

  it('renders no share id, no share URL and no member id', () => {
    const html = rowHtml(share())
    expect(html).not.toContain(SHARE_ID)
    expect(html).not.toContain(MEMBER_ID)
    expect(html).not.toContain('/share/')
  })

  it('is a list item, never a table row', () => {
    const html = rowHtml(share())
    expect(html).toContain('<li')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<td')
  })
})

describe('ShareStatusBadge', () => {
  it('labels each status in the same words as the coach facing control', () => {
    expect(renderToStaticMarkup(<ShareStatusBadge status="active" />)).toContain('Active')
    expect(renderToStaticMarkup(<ShareStatusBadge status="expired" />)).toContain('Expired')
    expect(renderToStaticMarkup(<ShareStatusBadge status="revoked" />)).toContain('Turned off')
  })
})

// ---- Summary, filters and lookup -------------------------------------------

describe('SharesSummary', () => {
  it('reports the server total for the filter and the loaded breakdown', () => {
    const html = renderToStaticMarkup(
      <SharesSummary loaded={3} total={42} counts={{ active: 2, expired: 1, revoked: 0 }} />,
    )
    expect(html).toContain('42')
    expect(html).toContain('links match')
    expect(html).toContain('active')
    expect(html).toContain('expired')
    expect(html).toContain('turned off')
    // It never claims the breakdown covers more than the rows in hand.
    expect(html).toContain('cover the 3 shown')
  })

  it('falls back to the loaded count when the server total is unknown', () => {
    const html = renderToStaticMarkup(
      <SharesSummary loaded={1} total={null} counts={{ active: 1, expired: 0, revoked: 0 }} />,
    )
    expect(html).toContain('1')
    expect(html).toContain('link match')
  })
})

describe('ShareFilterControls', () => {
  function html(over = {}): string {
    return renderToStaticMarkup(
      <ShareFilterControls
        filters={{ status: 'all', kind: '', createdBy: '', unattributed: false, shareId: '', ...over }}
        members={members}
        onChange={() => {}}
      />,
    )
  }

  it('renders every filter with a visible label and a programmatic aria-label', () => {
    const h = html()
    for (const visible of ['Status', 'Kind', 'Made by']) expect(h).toContain(visible)
    for (const aria of [
      'aria-label="Filter by status"',
      'aria-label="Filter by kind"',
      'aria-label="Filter by who made the link"',
    ]) {
      expect(h).toContain(aria)
    }
  })

  it('offers every status and kind option', () => {
    const h = html()
    for (const option of ['Any status', 'Active', 'Expired', 'Turned off']) expect(h).toContain(option)
    for (const option of ['Any kind', 'Drill', 'Session', 'Programme']) expect(h).toContain(option)
  })

  it('carries the former member option inside the one creator control', () => {
    // One control, so a manager can never set a creator and unattributed at
    // once; the server answers 400 to a request carrying both.
    const h = html()
    expect(h).toContain(FORMER_MEMBER_LABEL)
    expect(h).toContain('Alex Coach')
    expect(h).toContain('Anyone')
  })

  it('selects the former member option when unattributed is set', () => {
    expect(html({ unattributed: true })).toContain('value="unattributed" selected')
  })

  it('keys the creator options by position, never by member id', () => {
    const h = html({ createdBy: MEMBER_ID })
    expect(h).not.toContain(MEMBER_ID)
    expect(h).toContain('value="0" selected')
  })

  it('keeps an honest placeholder when the filtered creator is not in the club list', () => {
    const h = html({ createdBy: '00000000-0000-4000-8000-000000000000' })
    expect(h).toContain('value="unresolved" selected')
    // The Anyone option is not the one selected, so the control never claims
    // the list is unfiltered while it is.
    expect(h).toContain('<option value="">Anyone</option>')
  })
})

describe('ShareLookupField', () => {
  it('explains that only the id is used and the rest of a link is discarded', () => {
    const h = renderToStaticMarkup(
      <ShareLookupField value="" error={null} onLookup={() => {}} onClear={() => {}} />,
    )
    expect(h).toContain('Only the id part of a link is used')
    expect(h).toContain('discarded')
    expect(h).toContain('aria-describedby="shares-lookup-note"')
    expect(h).toContain('aria-label="Find one link by id"')
    expect(h).toContain('min-height:44px')
  })

  it('shows a resolved id back to the manager, never a pasted secret', () => {
    // The field is uncontrolled and the page only ever hands it the resolved
    // id, so the fragment cannot survive a round trip through the screen.
    const h = renderToStaticMarkup(
      <ShareLookupField value={SHARE_ID} error={null} onLookup={() => {}} onClear={() => {}} />,
    )
    expect(h).toContain(`value="${SHARE_ID}"`)
    expect(h).not.toContain('#')
    expect(h).toContain('Clear')
  })

  it('announces an unrecognised paste through role="alert"', () => {
    const h = renderToStaticMarkup(
      <ShareLookupField value="" error="That is not a link we recognise." onLookup={() => {}} onClear={() => {}} />,
    )
    expect(h).toContain('role="alert"')
    expect(h).toContain('That is not a link we recognise.')
  })
})

describe('SharesEmpty', () => {
  it('says nothing has been published when no filter is applied', () => {
    const h = renderToStaticMarkup(<SharesEmpty active={false} onClear={() => {}} />)
    expect(h).toContain('No public links yet.')
    expect(h).not.toContain('Clear filters')
  })

  it('offers Clear filters when a filter is narrowing the list', () => {
    const h = renderToStaticMarkup(<SharesEmpty active onClear={() => {}} />)
    expect(h).toContain('No links match.')
    expect(h).toContain('Clear filters')
  })
})

// ---- Review panel -----------------------------------------------------------

describe('ShareReviewBody', () => {
  it('renders the stored public projection for a drill', () => {
    const h = renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={drillSnapshot()} />)
    expect(h).toContain('Rondo under pressure')
    expect(h).toContain('Open the body.')
  })

  it('renders a neutral note when there is no stored snapshot', () => {
    expect(renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={null} />)).toContain(
      REVIEW_UNAVAILABLE_NOTE,
    )
  })

  it('re-validates in the browser and refuses a snapshot of the wrong version', () => {
    const h = renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={drillSnapshot({ snapshotVersion: 99 })} />)
    expect(h).toContain(REVIEW_UNAVAILABLE_NOTE)
    expect(h).not.toContain('Rondo under pressure')
  })

  it('refuses a snapshot whose kind does not match the share', () => {
    const h = renderToStaticMarkup(<ShareReviewBody kind="session" snapshot={drillSnapshot()} />)
    expect(h).toContain(REVIEW_UNAVAILABLE_NOTE)
    expect(h).not.toContain('Rondo under pressure')
  })

  it('refuses a snapshot carrying a forbidden key, at any depth', () => {
    const tampered = { ...drillSnapshot(), storage_path: 'club/abc.png' } as unknown
    expect(renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={tampered} />)).toContain(
      REVIEW_UNAVAILABLE_NOTE,
    )
    const nested = {
      ...drillSnapshot(),
      media: [{ ref: 'm1', type: 'image', caption: 'c', sourceAttribution: null, link: null, _path: 'club/x.png' }],
    } as unknown
    expect(renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={nested} />)).toContain(
      REVIEW_UNAVAILABLE_NOTE,
    )
  })

  it('describes media rather than signing it, because a review is not a public read', () => {
    const withMedia = drillSnapshot({
      media: [{ ref: 'm1', type: 'image', caption: 'Setup', sourceAttribution: null, link: null }],
    })
    const h = renderToStaticMarkup(<ShareReviewBody kind="drill" snapshot={withMedia} />)
    expect(h).toContain('temporary link')
    expect(h).not.toContain('<img')
  })
})

describe('ShareTurnOffBody', () => {
  it('states what turning a link off does, and which link it is', () => {
    const h = renderToStaticMarkup(<ShareTurnOffBody share={share()} />)
    expect(h).toContain(REVOKE_CONFIRM_NOTE)
    expect(h).toContain('Drill: Rondo under pressure')
  })

  it('names a deleted source neutrally', () => {
    const h = renderToStaticMarkup(<ShareTurnOffBody share={share({ sourceTitle: null })} />)
    expect(h).toContain(SOURCE_DELETED_LABEL)
  })
})

// ---- Modals -----------------------------------------------------------------

describe('ShareReviewModal', () => {
  it('is a labelled dialog carrying the stored projection and a Close control', () => {
    const h = renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)
    expect(h).toContain('role="dialog"')
    expect(h).toContain('aria-modal="true"')
    expect(h).toContain('What this link makes public')
    expect(h).toContain('Rondo under pressure')
    expect(h).toContain('min-height:44px')
    expect(h).toContain('Close')
  })

  it('says the copy is frozen, so a manager does not read it as the live content', () => {
    const h = renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)
    expect(h).toContain('frozen')
  })

  it('offers no link controls of any kind inside the review', () => {
    const h = renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)
    expect(h).not.toContain('Copy link')
    expect(h).not.toMatch(/Rotate|Refresh|Replace this link/)
  })

  it('shows the shared loading state while the detail read is in flight', () => {
    detailResult = { isPending: true, isError: false }
    expect(renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)).toContain('Loading')
  })

  it('offers a retry when the detail read fails', () => {
    detailResult = { isPending: false, isError: true, error: new Error('That link could not be found.') }
    const h = renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)
    expect(h).toContain('That link could not be found.')
    expect(h).toContain('Retry')
  })

  it('falls back to the neutral note when the club has no stored snapshot', () => {
    detailResult = { data: { snapshot: null, hasSnapshot: false }, isPending: false, isError: false }
    expect(renderToStaticMarkup(<ShareReviewModal share={share()} onClose={() => {}} />)).toContain(
      REVIEW_UNAVAILABLE_NOTE,
    )
  })
})

describe('ShareTurnOffModal', () => {
  it('asks for a confirmation before anything is turned off', () => {
    const h = renderToStaticMarkup(<ShareTurnOffModal share={share()} onClose={() => {}} onDone={() => {}} />)
    expect(h).toContain('role="dialog"')
    expect(h).toContain('Turn this link off?')
    expect(h).toContain(REVOKE_CONFIRM_NOTE)
    expect(h).toContain('Cancel')
    expect(h).toContain('Turn off this link')
    expect(h).toContain('min-height:44px')
  })
})

// ---- The screen -------------------------------------------------------------

describe('AdminShares screen', () => {
  it('renders the club list with its heading, summary and rows', () => {
    listResult = {
      data: { pages: [page({ total: 3 })] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    }
    const html = pageHtml()
    expect(html).toContain('Shared links')
    expect(html).toContain('Every public link the club has made')
    expect(html).toContain('Rondo under pressure')
    expect(html).toContain('3</b> links match')
  })

  it('offers NO Copy link, NO Replace link and NO Update control anywhere', () => {
    // The secret is not recoverable, and rotating or refreshing another
    // member's share is not permitted; both stay with the share's owner.
    const html = pageHtml()
    expect(html).not.toContain('Copy link')
    expect(html).not.toContain('Replace this link')
    expect(html).not.toContain('Update what people see')
    expect(html).not.toMatch(/Rotate|Refresh/)
    expect(html).toContain(NO_LINK_CONTROLS_NOTE)
  })

  it('never renders a share id, a member id or a public share URL', () => {
    const html = pageHtml()
    expect(html).not.toContain(SHARE_ID)
    expect(html).not.toContain(MEMBER_ID)
    expect(html).not.toContain('/share/')
    expect(html).not.toMatch(/token_hash|tokenHash|snapshot_path|storage_path|_mid|_path/)
  })

  it('carries a polite live region and an aria-busy wrapper for state changes', () => {
    const html = pageHtml()
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('role="status"')
  })

  it('renders the shared Loading state while the first page is in flight', () => {
    listResult = { isPending: true, isError: false, hasNextPage: false, isFetchingNextPage: false }
    const html = pageHtml()
    expect(html).toContain('Loading')
    expect(html).toContain('aria-busy="true"')
  })

  it('renders a retryable error state', () => {
    listResult = {
      isPending: false,
      isError: true,
      error: new Error('Could not read the club’s public links.'),
      hasNextPage: false,
      isFetchingNextPage: false,
    }
    const html = pageHtml()
    expect(html).toContain('Could not read the club')
    expect(html).toContain('Try again')
  })

  it('renders the empty state when the club has published nothing', () => {
    listResult = {
      data: { pages: [page({ shares: [], total: 0 })] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    }
    expect(pageHtml()).toContain('No public links yet.')
  })

  it('offers Load more only while the server says another page exists', () => {
    expect(pageHtml()).not.toContain('Load more')
    listResult = {
      data: { pages: [page({ hasMore: true, nextCursor: '2026-06-16T10:00:00.000Z' })] },
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
    }
    const html = pageHtml()
    expect(html).toContain('Load more')
    // The cursor is a paging detail, never rendered.
    expect(html).not.toContain('nextCursor')
  })

  it('flattens every loaded page into one list', () => {
    listResult = {
      data: {
        pages: [
          page({ shares: [share()] }),
          page({
            shares: [
              share({ shareId: '99999999-9999-4999-8999-999999999999', sourceTitle: 'Tuesday session', kind: 'session' }),
            ],
          }),
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    }
    const html = pageHtml()
    expect(html).toContain('Rondo under pressure')
    expect(html).toContain('Tuesday session')
  })

  it('shows the club kill switch note when public sharing is off', () => {
    listResult = {
      data: { pages: [page({ sharingEnabled: false })] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    }
    expect(pageHtml()).toContain(KILL_SWITCH_NOTE)
  })

  it('renders nothing at all without shares.manage, before the guard redirects', () => {
    caps = new Set<string>(['shares.create', 'sessions.create'])
    expect(pageHtml()).toBe('')
  })
})
