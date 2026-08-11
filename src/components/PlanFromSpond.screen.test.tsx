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
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SpondEvent } from '../lib/data'

const spondEvent = (over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'title'>): SpondEvent => ({
  startsAt: '2999-01-02T17:30:00Z',
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

const query = <T,>(data: T) => ({ data, isLoading: false, isPending: false, isError: false, error: null })

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me' }, profile: { team_id: 'titans' } }) }))
vi.mock('../hooks/useGuardedSubmit', () => ({
  useGuardedSubmit: () => ({ submit: () => {}, pendingId: null, failed: false, isPending: false }),
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: [], loading: false, error: null }),
}))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: new Set(['sessions.create']), isPending: false }),
  useMyTeams: () => query({ teamIds: ['titans'], allTeams: false }),
  useSpondEvents: () => query([TRAINING, MATCH, GALA]),
  useTeamMap: () => ({ titans: { id: 'titans', name: 'Titans', bibColour: null } }),
}))

const { PlanFromSpond } = await import('./PlanFromSpond')

describe('the Plan from Spond container, as it opens', () => {
  const html = () => renderToStaticMarkup(<PlanFromSpond />)

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

  it('keeps the card on a screen whose only unplanned events are fixtures', () => {
    // hideWhenEmpty is judged against All events, so a fixtures-only week
    // still shows the card, and with it the chip that reveals them. Judging
    // it on the Training view hid the widening along with the rows.
    const out = renderToStaticMarkup(<PlanFromSpond hideWhenEmpty />)
    expect(out).toContain('Plan from Spond')
    expect(out).toContain('Titans Tuesday')
  })
})
