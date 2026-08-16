// Two coaches press Plan this on the same Spond event.
//
// The database decides it, and must: a read-then-write check in the client
// cannot close a race, which is why 0048 adds a unique index and why the
// index is the authority. What this file pins is what the LOSING coach gets.
// Before it, the refusal arrived as a plain duplicate key error, the guarded
// submit seam reported "we couldn't create the session, check your
// connection", and the event stayed in the list inviting another go at
// something that could never work.
//
// Its own file, because the mocks it needs are the failure path: a guarded
// submit that has already failed with the link refusal, and a refetch hook
// whose calls can be counted. vi.mock is per file, so this cannot share
// PlanFromSpond.screen.test.tsx's success-path mocks.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SpondEvent } from '../lib/data'
import { SESSION_SPOND_LINK_TAKEN_ERROR } from '../lib/sessionSubmit'

// The connection wording carries an apostrophe, which the static renderer
// escapes to &#x27;. Matching the half after it keeps the assertion about the
// message rather than about HTML escaping.
const CONNECTION_WORDING = 'Check your connection and try again.'

const EVENT: SpondEvent = {
  id: 'e-train',
  title: 'Titans Tuesday',
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
}

const query = <T,>(data: T) => ({ data, isLoading: false, isPending: false, isError: false, error: null })

const refresh = vi.fn()
// The error the guarded submit reports, and the callback it was handed. Both
// are set by the mock so a test can drive the failure path a static render
// could never reach on its own.
let reportedError: unknown = null
let onFailure: ((err: unknown, input: unknown) => void) | undefined

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' }, profile: { team_id: 'titans' } }) }))
vi.mock('../hooks/useGuardedSubmit', () => ({
  useGuardedSubmit: (opts: { onFailure?: (err: unknown, input: unknown) => void }) => {
    onFailure = opts.onFailure
    return { submit: () => {}, pending: null, failed: reportedError !== null, error: reportedError }
  },
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: [], loading: false, error: null }),
}))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: new Set(['sessions.create']), isPending: false }),
  useMyTeams: () => query({ teamIds: ['titans'], allTeams: false }),
  useSpondEvents: () => query([EVENT]),
  useTeamMap: () => ({ titans: { id: 'titans', name: 'Titans', bibColour: null } }),
  useVenues: () => query([]),
  useRefreshSpondPlanning: () => refresh,
  useEventKindContext: () => ({ teamNames: ['Titans', 'Trojans'] }),
  SpondLinkTakenError: class SpondLinkTakenError extends Error {},
}))

const { PlanFromSpond } = await import('./PlanFromSpond')
const { SpondLinkTakenError } = await import('../lib/queries')

const render = () => renderToStaticMarkup(<PlanFromSpond />)

describe('losing the race to plan a Spond event', () => {
  it('says the event is already planned, not that the connection failed', () => {
    // REQUIREMENT 15. The sentence a coach can act on.
    reportedError = new SpondLinkTakenError()
    const out = render()
    expect(out).toContain(SESSION_SPOND_LINK_TAKEN_ERROR)
    expect(out).not.toContain(CONNECTION_WORDING)
    reportedError = null
  })

  it('still says the connection wording for every other failure', () => {
    // The specific message must not swallow the general one: a genuinely
    // failed write is still worth retrying and must still say so.
    reportedError = new Error('network down')
    const out = render()
    expect(out).toContain(CONNECTION_WORDING)
    expect(out).not.toContain(SESSION_SPOND_LINK_TAKEN_ERROR)
    reportedError = null
  })

  it('says nothing at all when nothing has failed', () => {
    reportedError = null
    const out = render()
    expect(out).not.toContain(CONNECTION_WORDING)
    expect(out).not.toContain(SESSION_SPOND_LINK_TAKEN_ERROR)
  })

  it('refetches the sessions and the synced events when the link is refused', () => {
    // The other half of recoverable: the losing coach's list catches up with
    // the coach who won, so the event stops being offered rather than sitting
    // there failing.
    refresh.mockClear()
    render()
    expect(onFailure).toBeTypeOf('function')
    onFailure?.(new SpondLinkTakenError(), null)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('does not refetch on an ordinary failure', () => {
    // A refetch on every failed create would fire a pair of network reads
    // every time a coach's connection dropped, which is the moment least
    // able to serve them.
    refresh.mockClear()
    render()
    onFailure?.(new Error('network down'), null)
    expect(refresh).not.toHaveBeenCalled()
  })
})
