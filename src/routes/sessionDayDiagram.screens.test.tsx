// =====================================================================
// The real Session Day container, rendered, for DRILL-02.
//
// The point of this file is the pair of things a helper test cannot say:
// that the diagram lands on the RIGHT activity, and that the two diagram
// systems COEXIST. Session Day already had a diagram affordance before
// this work and it means something else entirely: an uploaded image
// opened full screen through DiagramViewer, typed around MediaItem. The
// saved Drill Maker diagram is structured data drawn by DrillDiagramView.
// A change that quietly replaced one with the other would look right in
// isolation on either side, so both are asserted on one rendered screen.
//
// Following the sessionRegister.screens.test.tsx harness: mutable state,
// a query envelope, a full mock of ../lib/queries, and a top level await
// import so the mocks are in place before the module loads.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, Drill, MediaItem, Session } from '../lib/data'
import { DRILL_DIAGRAM_VERSION, type DrillDiagram } from '../lib/drillDiagram'

const AT = '2026-08-15T09:00:00.000Z'

// Two drills. The first carries BOTH an uploaded image and a drawn diagram,
// which is the coexistence case. The second carries neither.
const drill = (over: Partial<Drill>): Drill => ({
  id: 'd1',
  title: 'Rondo 4v1',
  corner: 'technical',
  skill: 'Passing',
  ages: ['U9'],
  level: 'Foundation',
  duration: 15,
  players: '5',
  area: '12x12',
  equipment: ['Cones'],
  mediaId: null,
  summary: 'Keep the ball.',
  points: [],
  tags: [],
  setupNotes: '',
  easier: [],
  harder: [],
  theme: '',
  format: '',
  sourceUrl: '',
  sourceLabel: '',
  sourceKey: '',
  createdAt: AT,
  rights: 'internal_only',
  ...over,
})

const BOTH = drill({ id: 'd1', title: 'Rondo 4v1', mediaId: 'm1' })
const PLAIN = drill({ id: 'd2', title: 'Finishing Ladder' })
const FA = drill({
  id: 'd3',
  title: 'England Football Passing',
  sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc',
  mediaId: 'm1',
})

const IMAGE: MediaItem = {
  id: 'm1',
  name: 'Rondo setup photo',
  type: 'image',
  kind: 'upload',
  storagePath: 'club/rondo.png',
  embedUrl: '',
  size: '1 MB',
  dims: '800x600',
  length: '',
  createdAt: AT,
  sourceUrl: '',
  sourceLabel: '',
  rights: 'internal_only',
}

// Distinct diagrams, so "the right activity got the right picture" is a
// real assertion rather than two identical pictures agreeing by accident.
const RONDO: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'half_pitch', orientation: 'portrait' },
  elements: [
    { type: 'player', id: 'player-1', x: 0.3, y: 0.3, colour: 'blue', label: '' },
    { type: 'player', id: 'player-2', x: 0.7, y: 0.3, colour: 'blue', label: '' },
    { type: 'cone', id: 'cone-1', x: 0.5, y: 0.5, colour: 'orange' },
  ],
}
const LADDER: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'blank', orientation: 'landscape' },
  elements: [{ type: 'goal', id: 'goal-1', x: 0.5, y: 0.1, width: 0.3, facing: 'down' }],
}

const ACTIVITIES: Activity[] = [
  { phase: 'Skill', drillId: 'd1', duration: 20 },
  { phase: 'Game', drillId: 'd2', duration: 25 },
]

const SESSION: Session = {
  id: 's1',
  name: 'Titans Saturday',
  date: '2026-08-15',
  time: '10:00',
  ageGroup: 'U9',
  venue: '',
  focus: 'Passing',
  status: 'upcoming',
  activities: ACTIVITIES,
  coachId: 'coach-1',
  teamId: null,
  teamIds: ['t1'],
  venueId: null,
  intentions: [],
  space: '',
  sourceUrl: '',
  sourceLabel: '',
  programmeId: null,
  programmeWeek: null,
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  spondEventId: null,
  boardId: null,
  rights: 'internal_only',
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

const mutation = () => ({
  mutate: () => {},
  mutateAsync: async () => ({}),
  isPending: false,
  isError: false,
  data: null,
  error: null,
  reset: () => {},
})

// The mutable knobs each test turns: which drills exist, and what the
// per drill diagram read answers.
const state = {
  drills: { d1: BOTH, d2: PLAIN } as Record<string, Drill>,
  diagrams: { d1: RONDO, d2: LADDER } as Record<string, DrillDiagram | null>,
  session: SESSION,
}

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'coach-1' }, profile: null }) }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 's1' }),
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))
vi.mock('../lib/queries', () => ({
  useSession: () => query(state.session),
  useDrillMap: () => state.drills,
  useMediaMap: () => ({ m1: IMAGE }),
  useTeamMap: () => ({ t1: { id: 't1', name: 'Titans', bibColour: 'red' } }),
  useTeams: () => query([{ id: 't1', name: 'Titans', bibColour: 'red' }]),
  useVenueMap: () => ({}),
  useProgrammeMap: () => ({}),
  usePlayers: () => query([]),
  useBoard: () => query(null),
  useLinkSessionBoard: () => mutation(),
  useMyCapabilities: () => ({ caps: new Set(['sessions.create', 'players.view']), isPending: false }),
  useActivityTitle: () => (a: Activity) => (a.drillId ? (state.drills[a.drillId]?.title ?? 'Removed drill') : 'Custom'),
  // The one read this work adds, per drill and shared with the drill page.
  useDrillDiagram: (id: string | undefined) => query(id ? (state.diagrams[id] ?? null) : null),
  useMediaSrc: () => ({ src: null, onError: () => {}, onLoad: () => {} }),
  useSpondEvents: () => query([]),
  useRegisteredPlayers: () => query([]),
  useRegisterEntries: () => query([]),
  useCurrentSeason: () => query({ id: 'season' }),
  useSessionSpondRsvp: () => query({}),
  useSpondLinks: () => query({ available: false, links: [] }),
  useSpondSync: () => mutation(),
  useSaveTonight: () => mutation(),
  useLinkSessionSpondEvent: () => mutation(),
  useEventKindContext: () => ({ spondEvents: () => undefined, teamNames: ['Titans'] }),
  useDeleteSession: () => mutation(),
  useSessionShares: () => query([]),
  useMintShare: () => mutation(),
  useRevokeShare: () => mutation(),
}))

const { SessionDay } = await import('./SessionDay')

function render(): string {
  return renderToStaticMarkup(<SessionDay />)
}

// The markup of one setup card, so an assertion can be about ONE activity
// rather than about the page. Cards are keyed by their heading.
function card(html: string, title: string): string {
  const at = html.indexOf(title)
  expect(at, `no card titled ${title}`).toBeGreaterThan(-1)
  const next = html.indexOf('sd-card', at)
  return next === -1 ? html.slice(at) : html.slice(at, next)
}

function withState<T>(over: Partial<typeof state>, run: () => T): T {
  const was = { ...state }
  Object.assign(state, over)
  try {
    return run()
  } finally {
    Object.assign(state, was)
  }
}

describe('Session Day shows the saved drill diagram', () => {
  it('draws each activity its own diagram, through the canonical renderer', () => {
    const html = render()
    // The Rondo card has the half pitch with two players and a cone.
    const rondo = card(html, 'Rondo 4v1')
    expect(rondo).toContain('data-el="player"')
    expect(rondo).toContain('data-el="cone"')
    expect(rondo).toContain('class="dd-surface dd-in-sd"')
    // The ladder card has the goal, and no player or cone from the other one.
    const ladder = card(html, 'Finishing Ladder')
    expect(ladder).toContain('data-el="goal"')
    expect(ladder).not.toContain('data-el="cone"')
  })

  it('shows the uploaded image and the drawn diagram side by side', () => {
    // The coexistence rule, on the one screen that had a diagram affordance
    // before this work. Neither replaces the other and the structured diagram
    // is NOT folded into the media carousel.
    const rondo = card(render(), 'Rondo 4v1')
    expect(rondo).toContain('aria-label="Open diagram full screen"')
    expect(rondo).toContain('sd-thumb')
    expect(rondo).toContain('data-el="player"')
  })

  it('leaves the existing full screen media viewer behaviour alone', () => {
    // The uploaded image path is untouched: still a button, still opening the
    // MediaItem viewer, still one entry per image activity.
    const html = render()
    expect(html.match(/aria-label="Open diagram full screen"/g)).toHaveLength(1)
  })

  it('shows the media on an England Football drill and no drawn diagram', () => {
    // A stranded diagram on an FA derived drill is not shown anywhere but the
    // drill page, which explains it and offers to remove it. The FA's own
    // image keeps rendering: the drill loses the recreation, not the picture.
    withState({ drills: { d1: FA, d2: PLAIN }, diagrams: { d1: RONDO, d2: LADDER } }, () => {
      const fa = card(render(), 'England Football Passing')
      expect(fa).toContain('aria-label="Open diagram full screen"')
      expect(fa).not.toContain('data-el=')
    })
  })

  it('renders a normal card for an activity whose drill has no diagram', () => {
    withState({ diagrams: { d1: null, d2: null } }, () => {
      const html = render()
      expect(html).not.toContain('dd-surface')
      // And the cards themselves are still there and still complete.
      expect(html).toContain('Rondo 4v1')
      expect(html).toContain('Finishing Ladder')
      expect(html).toContain('aria-label="Open diagram full screen"')
    })
  })

  it('survives a deleted drill without drawing anything or falling over', () => {
    withState({ drills: {}, diagrams: {} }, () => {
      const html = render()
      expect(html).toContain('Removed drill')
      expect(html).not.toContain('dd-surface')
    })
  })

  it('draws the same drill twice when a session uses it twice', () => {
    // A repeated drill is ordinary planning. Both cards get the picture, and
    // the shared per drill cache key means it is still one read.
    const twice = { ...SESSION, activities: [ACTIVITIES[0], { ...ACTIVITIES[0] }] }
    withState({ session: twice }, () => {
      const html = render()
      expect(html.match(/dd-surface/g)).toHaveLength(2)
    })
  })

  it('keeps Players and groups on the screen beside the diagrams', () => {
    // The training day surface must not be displaced by this work.
    expect(render()).toContain('Players &amp; groups')
  })

  it('names no child and resolves no register identity onto a diagram', () => {
    // The diagram stays a reusable drill. Tonight's actual children are never
    // placed on it; that is the tactics board's job and it stays there.
    const html = render()
    const surfaceAt = html.indexOf('dd-surface')
    expect(surfaceAt).toBeGreaterThan(-1)
    for (const forbidden of ['playerId', 'player_id', 'spondMemberId', 'display_name', 'guardian']) {
      expect(html).not.toContain(forbidden)
    }
  })
})
