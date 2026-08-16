// =====================================================================
// Drill diagrams on the session surfaces, rendered.
//
// DRILL-02 asks three screens the same question and the invariant file
// pins that they all ask it of the one resolver. What a source text check
// cannot see is a screen calling the rule and then ignoring the answer,
// or handing it the wrong map, so this renders the REAL containers with
// the data layer stubbed and reads the markup.
//
// THE CASE THIS FILE EXISTS FOR is the England Football one. A drill
// derived from England Football Learning may not carry a hand drawn
// diagram: CLAUDE.md, Third-party content, "used unmodified, never
// recreated or redrawn". The drill page already refuses to render one and
// offers to remove it, and the state is reachable exactly as DrillDetail
// records, a coach draws on their own drill and records an FA source
// afterwards. Before the shared resolver, a session surface had no such
// rule at all. A breach here would be silent: a pitch appears on a screen
// nobody is auditing, and the drill page goes on behaving correctly.
//
// Fixtures are invented. No real drill, child or England Football URL
// content appears; the FA_URL below is a host match for the provenance
// rule and nothing is fetched.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyDiagram, type DrillDiagram } from '../lib/drillDiagram'
import type { Activity, Drill, Session } from '../lib/data'

const FA_URL = 'https://learn.englandfootball.com/an-activity'

// A diagram with one cone in it, so diagramIsEmpty is false and something
// would actually be drawn.
const DRAWN: DrillDiagram = {
  ...emptyDiagram(),
  elements: [{ type: 'cone', id: 'cone-1', x: 0.5, y: 0.5, colour: 'orange' }],
} as DrillDiagram

const drill = (id: string, over: Partial<Drill> = {}): Drill => ({
  id,
  title: `Drill ${id}`,
  corner: null,
  skill: 'Passing',
  ages: [],
  level: 'Foundation',
  duration: 15,
  players: '8',
  area: '30x20',
  equipment: [],
  mediaId: null,
  summary: 'A synthetic drill.',
  points: ['Head up'],
  tags: [],
  setupNotes: '',
  easier: [],
  harder: [],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  sourceKey: '',
  rights: 'internal_only',
  createdAt: '2026-08-16T00:00:00Z',
  ...over,
})

const ORDINARY = drill('d-ordinary')
const FA_DRILL = drill('d-fa', { title: 'Drill d-fa', sourceUrl: FA_URL })

const activity = (drillId: string): Activity => ({ phase: 'Skill', drillId, duration: 15 })

const session = (activities: Activity[]): Session =>
  ({
    id: 'sess-1',
    name: 'Tuesday training',
    date: '2026-08-18',
    time: '18:00',
    coachId: 'coach-1',
    activities,
    status: 'upcoming',
    intentions: [],
    space: '',
    teamIds: [],
    venueId: null,
    venue: '',
    teamId: null,
    boardId: null,
    spondEventId: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    programmeId: null,
    programmeWeek: null,
    sourceUrl: '',
    sourceLabel: '',
  }) as unknown as Session

// A watcher only reaches the live stage when somebody is driving, and
// isSessionLive counts a marker only on the local day it was written, so
// the timestamp is now rather than a fixed date. Nothing here tests the
// lifecycle rule; this is what it takes to get the watcher onto the stage
// where the diagram is.
const driven = (activities: Activity[]): Session =>
  ({
    ...session(activities),
    liveActivityIndex: 0,
    liveActivityStartedAt: new Date().toISOString(),
  }) as unknown as Session

// What the stubbed data layer is holding for one render.
const state = {
  session: session([activity('d-ordinary')]),
  drills: { 'd-ordinary': ORDINARY, 'd-fa': FA_DRILL } as Record<string, Drill>,
  diagrams: { 'd-ordinary': DRAWN, 'd-fa': DRAWN } as Record<string, DrillDiagram | null>,
  caps: new Set<string>(['sessions.create', 'sessions.manage']),
}

const query = <T,>(data: T, over: Record<string, unknown> = {}) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isRefetching: false,
  error: null,
  refetch: () => {},
  ...over,
})

vi.mock('react-router-dom', () => ({
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
  useParams: () => ({ sessionId: 'sess-1' }),
  useSearchParams: () => [new URLSearchParams(), () => {}],
  MemoryRouter: ({ children }: { children?: unknown }) => <>{children as never}</>,
}))

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'coach-1' } }) }))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useSession: () => query(state.session),
  useDrillMap: () => state.drills,
  useMediaMap: () => ({}),
  useTeamMap: () => ({}),
  useVenueMap: () => ({}),
  useProgrammeMap: () => ({}),
  useActivityTitle: () => (a: Activity) => (a.drillId ? (state.drills[a.drillId]?.title ?? 'Removed drill') : 'Activity'),
  // The seam under test: the batch read, stubbed with what the database
  // would hold. The FA drill IS holding a diagram here on purpose.
  useDrillDiagramMap: () => state.diagrams,
  useBoard: () => query(null),
  usePlayers: () => query([]),
  useLinkSessionBoard: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
  useLiveSessionSync: () => {},
  useSetLiveActivity: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
  // Session Day embeds the Players & groups card, which reads its own set.
  // None of it bears on the diagram; it is stubbed empty so the page renders.
  useTeams: () => query([]),
  useCurrentSeason: () => query({ id: 'season' }),
  useRegisteredPlayers: () => query([]),
  useRegisterEntries: () => query([]),
  useSaveTonight: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
  useSessionSpondRsvp: () => query({ available: false, byPlayer: {} }),
  useSpondEvents: () => query([]),
  useSpondLinks: () => query({ available: false, links: [] }),
  useSpondSync: () => ({ mutate: () => {}, isPending: false, isError: false, data: null, error: null }),
  useLinkSessionSpondEvent: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
}))

const { SessionDay } = await import('./SessionDay')
const { LiveSession } = await import('./LiveSession')

// The pitch only reaches the markup through DrillDiagramView, whose root
// carries this class. Its absence is the diagram not being drawn.
const PITCH = 'dd-surface'

const sessionDay = () => renderToStaticMarkup(<SessionDay />)
const live = () => renderToStaticMarkup(<LiveSession />)

function withState(over: Partial<typeof state>, run: () => string): string {
  const before = { ...state }
  Object.assign(state, over)
  try {
    return run()
  } finally {
    Object.assign(state, before)
  }
}

describe('Session Day shows a drill diagram', () => {
  it('draws the pitch for an ordinary drill that has one', () => {
    expect(sessionDay()).toContain(PITCH)
  })

  it('draws nothing when the drill has no diagram', () => {
    expect(withState({ diagrams: {} }, sessionDay)).not.toContain(PITCH)
  })

  it('draws nothing for an empty diagram', () => {
    expect(withState({ diagrams: { 'd-ordinary': emptyDiagram() } }, sessionDay)).not.toContain(PITCH)
  })

  it('REFUSES an England Football derived drill that is holding one', () => {
    const html = withState({ session: session([activity('d-fa')]) }, sessionDay)
    expect(html).not.toContain(PITCH)
    // And the screen still renders: the refusal is a missing diagram, not
    // a broken page.
    expect(html).toContain('Drill d-fa')
  })

  it('draws the ordinary drill and refuses the FA one in the same session', () => {
    // The mixed session is the case a per surface rule gets wrong: it is
    // not enough to refuse when every drill is FA derived.
    const html = withState({ session: session([activity('d-ordinary'), activity('d-fa')]) }, sessionDay)
    expect(html.split(PITCH).length - 1).toBe(1)
  })

  it('survives an activity whose drill was deleted after planning', () => {
    const html = withState({ session: session([activity('d-gone')]) }, sessionDay)
    expect(html).not.toContain(PITCH)
  })
})

describe('Live shows the current activity diagram', () => {
  it('draws it for the driver', () => {
    expect(live()).toContain(PITCH)
  })

  it('draws it for a watcher, who reads the same drill column', () => {
    const html = withState({ caps: new Set<string>(), session: driven([activity('d-ordinary')]) }, live)
    expect(html).toContain(PITCH)
  })

  it('keeps the timer and the controls when there is no diagram', () => {
    const html = withState({ diagrams: {} }, live)
    expect(html).not.toContain(PITCH)
    // The screen's reason for existing is still on it.
    expect(html).toContain('timer-ring')
    expect(html).toContain('live-controls')
  })

  it('puts the diagram after the controls, never between them and the coach', () => {
    const html = live()
    expect(html.indexOf('live-controls')).toBeLessThan(html.indexOf(PITCH))
  })

  it('REFUSES an England Football derived drill that is holding one', () => {
    const html = withState({ session: session([activity('d-fa')]) }, live)
    expect(html).not.toContain(PITCH)
    expect(html).toContain('timer-ring')
  })

  it('refuses it for a watcher too, since the licence binds every viewer', () => {
    const html = withState({ session: driven([activity('d-fa')]), caps: new Set<string>() }, live)
    expect(html).not.toContain(PITCH)
    // Proves the watcher was actually on the stage, so the absence above is
    // a refusal and not simply a screen that never got there.
    expect(html).toContain('timer-ring')
  })
})
