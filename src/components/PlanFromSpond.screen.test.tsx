// The Plan from Spond CONTAINER, as it opens.
//
// PlanFromSpond.test.tsx covers the presentational half, which renders
// whatever rows it is handed. That leaves the container's own decision
// untested, and an adversarial review used the gap: changing
// `const rows = suggest(kind)` to `suggest('all')` left the whole suite
// green while the Training chip rendered pressed above a list of fixtures.
// This renders the real container with the data layer stubbed.
//
// Its own file because the screens suite stubs this container out (Sessions
// mounts it), and a module cannot be both mocked and under test at once.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SpondEvent } from '../lib/data'

const spondEvent = (over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'title'>): SpondEvent => ({
  startsAt: '2999-01-02T17:30:00Z',
  location: null,
  teamId: 'titans',
  teamName: 'Titans',
  spondType: null,
  accepted: 4,
  declined: 0,
  unanswered: 0,
  waiting: 0,
  cancelled: false,
  syncedAt: '2999-01-01T12:00:00Z',
  ...over,
})

const TRAINING = spondEvent({ id: 'e-train', title: 'Titans Tuesday' })
const MATCH = spondEvent({ id: 'e-match', title: 'U8 v Horbury', spondType: 'MATCH' })
const GALA = spondEvent({ id: 'e-gala', title: 'Summer gala' })

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  error: null,
  ...over,
})

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' }, profile: { team_id: 'titans' } }) }))
vi.mock('../hooks/useGuardedSubmit', () => ({
  useGuardedSubmit: () => ({ submit: () => {}, pendingId: null, failed: false, isPending: false }),
}))
// Mutable so a test can put a session in the club before rendering. The
// container's whole "is this already planned?" decision reads this list.
let clubSessions: { id: string; coachId: string; spondEventId: string | null }[] = []
const TEAMS = [
  { id: 'titans', name: 'Titans', bibColour: null },
  { id: 'trojans', name: 'Trojans', bibColour: null },
]
let teamsRead: { data: unknown; isLoading: boolean; isError: boolean } = query(TEAMS)
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: clubSessions, loading: false, error: null }),
}))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: new Set(['sessions.create']), isPending: false }),
  useMyTeams: () => query({ teamIds: ['titans'], allTeams: false }),
  useSpondEvents: () => query([TRAINING, MATCH, GALA]),
  // The club's teams as a QUERY, because the container waits for this
  // read before it will plan anything: a club event covers every team,
  // and a session saved over an unanswered read would cover nobody.
  // Mutable, so a case can put the read in a state the flags alone
  // describe wrongly.
  useTeams: () => teamsRead,
  // The club's venues, read so a new session can default to the one the
  // event's location names. Empty here: this file is about which rows the
  // container offers, and the venue rule has its own tests.
  useVenues: () => query([]),
  // The duplicate link refusal (0048) is recognised by class and the catch up
  // refetch is a named hook, so both are stubbed here rather than dragging a
  // query client into a static render.
  useRefreshSpondPlanning: () => () => {},
  useEventKindContext: () => ({ teamNames: ['Titans', 'Trojans'] }),
  SpondLinkTakenError: class SpondLinkTakenError extends Error {},
}))

const { PlanFromSpond } = await import('./PlanFromSpond')

describe('the Plan from Spond container, as it opens', () => {
  const html = () => renderToStaticMarkup(<PlanFromSpond />)

  beforeEach(() => {
    clubSessions = []
    teamsRead = query(TEAMS)
  })

  it('suggests the training night and neither the match nor the gala', () => {
    const out = html()
    expect(out).toContain('Titans Tuesday')
    expect(out).not.toContain('U8 v Horbury')
    expect(out).not.toContain('Summer gala')
  })

  it('presses Training and offers All events beside it', () => {
    const out = html()
    expect(out).toContain('aria-pressed="true">Training</button>')
    expect(out).toContain('aria-pressed="false">All events</button>')
  })

  // REQUIREMENT 10. Already planned is a question about the CLUB.
  it('drops an event another coach has already planned', () => {
    // A mirrored Spond event holds at most one Hub session (0048), so an
    // event with a session is planned no matter who owns that session.
    // Asking it per coach offered the event to everybody else, and the
    // database then refused whoever pressed second.
    clubSessions = [{ id: 's1', coachId: 'another-coach', spondEventId: 'e-train' }]
    expect(html()).not.toContain('Titans Tuesday')
  })

  it('drops an event the signed in coach has already planned, as it always did', () => {
    clubSessions = [{ id: 's1', coachId: 'me', spondEventId: 'e-train' }]
    expect(html()).not.toContain('Titans Tuesday')
  })

  it('keeps offering an event no session links, whoever owns the other sessions', () => {
    // The narrowing must be the LINK, not the existence of somebody else's
    // sessions: dropping every event because another coach owns a session
    // would empty the surface.
    clubSessions = [
      { id: 's1', coachId: 'another-coach', spondEventId: 'e-gala' },
      { id: 's2', coachId: 'another-coach', spondEventId: null },
    ]
    expect(html()).toContain('Titans Tuesday')
  })

  it('keeps the card on a screen whose only unplanned events are fixtures', () => {
    // hideWhenEmpty is judged against All events, so a fixtures-only week
    // still shows the card, and with it the chip that reveals them. Judging
    // it on the Training view hid the widening along with the rows.
    const out = renderToStaticMarkup(<PlanFromSpond hideWhenEmpty />)
    expect(out).toContain('Plan from Spond')
    expect(out).toContain('Titans Tuesday')
  })
})

// =====================================================================
// What proves the club's teams are known.
//
// A club event covers every team the club has, and Plan this SAVES before
// the coach sees anything, into a planner that will not re-seed a stored
// row. So the container must not offer it over a read that has not
// answered. What "answered" means is the whole of these three cases, and
// the flags get two of them wrong on their own.
// =====================================================================
describe('the teams read, in the states its flags describe badly', () => {
  const html = () => renderToStaticMarkup(<PlanFromSpond />)
  const ROW = 'Titans Tuesday'
  const TEAMS_ERROR = 'so a session cannot be given the ones it covers'

  it('keeps planning through a failed REFETCH, because the teams are in hand', () => {
    // tanstack query keeps the previous data and sets status error when a
    // background refetch fails, and useTeams sets no staleTime under a
    // bare QueryClient, so this happens on any window focus that catches a
    // blip. The list is cached, correct, and exactly what plan() would
    // write; taking the card down over it would stop a coach planning for
    // no reason at all.
    teamsRead = query(TEAMS, { isError: true })
    const out = html()
    expect(out).toContain(ROW)
    expect(out).not.toContain(TEAMS_ERROR)
  })

  it('stops on a failed FIRST read, where there is nothing to plan with', () => {
    teamsRead = query(undefined, { isError: true })
    const out = html()
    expect(out).not.toContain(ROW)
    expect(out).toContain(TEAMS_ERROR)
  })

  it('waits on a read that never dispatched, which neither flag reports', () => {
    // Offline before the first fetch, or disabled while a gate loads:
    // isLoading and isError are BOTH false with no data. Gating on the
    // flags would read this as an answered club of no teams and let a
    // coach save a session covering nobody.
    teamsRead = query(undefined)
    const out = html()
    expect(out).not.toContain(ROW)
    expect(out).toContain('Loading…')
  })
})
