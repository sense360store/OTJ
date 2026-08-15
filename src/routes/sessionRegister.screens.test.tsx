// =====================================================================
// The real Players & groups container, rendered.
//
// The lib tests prove the model refuses an unknown link set and the view
// tests prove the markup renders what it is handed. Neither says the
// container CONNECTS them, and CLAUDE.md records how that gap bit once
// already (Training first: every seam test green while a screen filtered
// on its own literal). An adversarial review then produced three whole
// suite green regressions that all lived in this container: a paused
// query read as a known empty link set, the unlinked note silently not
// composed, and the event aggregate handed to a chip through an alias
// the source tripwire does not anchor on. So this renders TonightScreen
// itself, with only the data layer stubbed, and asserts on the markup.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegisteredPlayer, Session, SpondEvent, Team } from '../lib/data'
import type { RegisterEntry } from '../lib/register'

const AT = '2026-08-15T09:00:00.000Z'

const TEAMS: Team[] = [
  { id: 't1', name: 'Titans', bibColour: 'red' },
  { id: 't2', name: 'Trojans', bibColour: null },
]

const player = (id: string, name: string, teamId: string): RegisteredPlayer => ({
  registrationId: `reg-${id}`,
  playerId: id,
  seasonId: 'season',
  teamId,
  displayName: name,
  shirtNumber: null,
  status: 'registered',
  registeredDate: null,
  createdBy: null,
  updatedAt: AT,
})

// Four covered players, two linked. The linked pair splits going and not
// going; the event's own aggregate (20 accepted, 18 declined, 11
// unanswered over 49 invited) shares no figure with any chip, so an
// aggregate reaching a chip cannot hide behind a coincidence.
const PLAYERS: RegisteredPlayer[] = [
  player('p1', 'Alpha Synthetic', 't1'),
  player('p2', 'Beta Synthetic', 't1'),
  player('p3', 'Gamma Synthetic', 't2'),
  player('p4', 'Delta Synthetic', 't2'),
]

const ENTRIES: RegisterEntry[] = [
  {
    sessionId: 's1',
    playerId: 'p1',
    present: false,
    includedInGroups: true,
    bibColourOverride: null,
    source: 'roster',
  },
]

const SESSION: Session = {
  id: 's1',
  name: 'Titans Saturday',
  date: '2026-08-15',
  time: '10:00',
  ageGroup: '',
  venue: '',
  focus: '',
  status: 'upcoming',
  activities: [],
  coachId: 'coach-1',
  teamId: null,
  teamIds: ['t1', 't2'],
  venueId: null,
  intentions: [],
  space: '',
  sourceUrl: '',
  sourceLabel: '',
  programmeId: null,
  programmeWeek: null,
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  spondEventId: 'evt1',
  boardId: null,
  rights: 'internal_only',
}

const EVENT: SpondEvent = {
  id: 'evt1',
  title: 'Saturday Session',
  startsAt: AT,
  teamId: null,
  teamName: null,
  spondType: null,
  accepted: 20,
  declined: 18,
  unanswered: 11,
  waiting: 0,
  cancelled: false,
  syncedAt: AT,
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
  ...over,
})

// A query that has never dispatched: offline before the first fetch, or
// disabled while its gate loads. isLoading and isError are BOTH false.
const paused = () => query(undefined)

const mutation = () => ({
  mutate: () => {},
  mutateAsync: async () => ({}),
  isPending: false,
  isError: false,
  data: null,
  error: null,
  reset: () => {},
})

const state = {
  links: query({ available: true, links: [{ playerId: 'p1' }, { playerId: 'p2' }] }) as unknown,
  rsvp: query({
    p1: { status: 'accepted', syncedAt: AT },
    p2: { status: 'declined', syncedAt: AT },
  }) as unknown,
}

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'coach-1' }, profile: null }),
}))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: 's1' }),
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: new Set(['sessions.create', 'players.view']), isPending: false }),
  useTeams: () => query(TEAMS),
  useCurrentSeason: () => query({ id: 'season' }),
  useRegisteredPlayers: () => query(PLAYERS),
  useRegisterEntries: () => query(ENTRIES),
  useSessionSpondRsvp: () => state.rsvp,
  useSpondLinks: () => state.links,
  useSpondEvents: () => query([EVENT]),
  useSession: () => query(SESSION),
  useSpondSync: () => mutation(),
  useSaveTonight: () => mutation(),
  useLinkSessionSpondEvent: () => mutation(),
  useEventKindContext: () => ({ spondEvents: () => undefined, teamNames: ['Titans', 'Trojans'] }),
  useMediaMap: () => ({}),
  useMediaSrc: () => null,
}))

const { TonightScreen } = await import('./SessionRegister')
const html = () => renderToStaticMarkup(<TonightScreen session={SESSION} />)

const chip = (markup: string, label: string) => {
  const m = markup.match(new RegExp(`>${label} (\\d+)</button>`))
  return m ? Number(m[1]) : null
}

describe('the rendered screen over answered reads', () => {
  it('chips count stored replies, never the event aggregate', () => {
    const out = html()
    expect(chip(out, 'Going')).toBe(1)
    expect(chip(out, 'No reply')).toBe(0)
    expect(chip(out, 'Not going')).toBe(1)
    expect(chip(out, 'Waiting')).toBe(0)
    expect(chip(out, 'Everyone')).toBe(4)
    // The aggregate's own figures, absent from every chip however they
    // travelled: 20/18/11 appear nowhere but the labelled audience line.
    expect(out).not.toContain('>Going 20</button>')
    expect(out).not.toContain('>Not going 18</button>')
    expect(out).not.toContain('>No reply 11</button>')
    expect(out).toContain('Spond audience: 49 people invited')
  })

  it('composes the coverage line and the team gap, so the container cannot silently drop either', () => {
    const out = html()
    expect(out).toContain('2 of 4 players linked to Spond · 2 not linked')
    expect(out).toContain('Not linked: Trojans 2')
  })

  it('never says tonight anywhere on it, groups included', () => {
    const out = html()
    // The groups section must actually be in the checked markup: the
    // review mutation that parked the word there passed because the
    // earlier fixtures never rendered it.
    expect(out).toContain('Groups')
    expect(out).toContain('Players &amp; groups')
    expect(out.toLowerCase()).not.toContain('tonight')
  })
})

describe('the rendered screen over reads that never answered', () => {
  it('says nothing about links from a paused read, rather than "0 of 4 linked"', () => {
    const was = { links: state.links, rsvp: state.rsvp }
    state.links = paused()
    state.rsvp = paused()
    try {
      const out = html()
      // The squad itself still renders: a dead Spond read never blanks
      // the working screen.
      expect(out).toContain('Alpha Synthetic')
      // But the screen claims nothing it cannot know.
      expect(out).not.toContain('0 of 4')
      expect(out.toLowerCase()).not.toContain('not linked')
    } finally {
      state.links = was.links
      state.rsvp = was.rsvp
    }
  })

  it('claims no reply figure from a paused reply read', () => {
    const was = state.rsvp
    state.rsvp = paused()
    try {
      const out = html()
      // Links are known, replies are not: the coverage line stands and
      // the reply clause stays unsaid, rather than "0 with a reply".
      expect(out).toContain('2 of 4 players linked to Spond')
      expect(out).not.toContain('with a reply for this event')
    } finally {
      state.rsvp = was
    }
  })
})
