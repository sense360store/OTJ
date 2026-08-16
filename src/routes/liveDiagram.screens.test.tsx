// =====================================================================
// The real Live container, rendered, for DRILL-02.
//
// Live is the surface DRILL-02 exists for: a coach standing on the pitch
// with a phone, who should see the setup for the activity they are running
// without leaving the session. So this renders LiveSession itself, which
// dispatches to the driver stage or the watcher stage on capability, and
// asserts the diagram lands on the CURRENT activity in both.
//
// The failure this file is really about is Live keeping the previous
// activity's picture. There is no DOM in this repo's suite, so advancing is
// driven the way the screen itself derives its position: the session row's
// live activity index, which is the driver's restore point and the
// watcher's whole source of truth. Same container, same fixtures, one
// number different.
//
// It also pins what must NOT move: the timer, the transport controls and
// Mark done & next are still there, and rendering writes nothing.
// =====================================================================
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, Drill, MediaItem, Session } from '../lib/data'
import { DRILL_DIAGRAM_VERSION, type DrillDiagram } from '../lib/drillDiagram'

const AT = '2026-08-15T09:00:00.000Z'

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
  points: ['Open your body'],
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

const RONDO = drill({ id: 'd1', title: 'Rondo 4v1' })
const LADDER = drill({ id: 'd2', title: 'Finishing Ladder' })
const FA = drill({
  id: 'd3',
  title: 'England Football Passing',
  mediaId: 'm1',
  sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc',
})

const IMAGE: MediaItem = {
  id: 'm1',
  name: 'FA setup',
  type: 'image',
  kind: 'upload',
  storagePath: 'club/fa.png',
  embedUrl: '',
  size: '1 MB',
  dims: '800x600',
  length: '',
  createdAt: AT,
  sourceUrl: 'https://learn.englandfootball.com/coaching/activity/abc',
  sourceLabel: 'England Football Learning',
  rights: 'internal_only',
}

// Two diagrams that share no element type, so "the right one" is provable
// from the markup alone rather than by two identical pictures agreeing.
const RONDO_DIAGRAM: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'half_pitch', orientation: 'portrait' },
  elements: [
    { type: 'cone', id: 'cone-1', x: 0.3, y: 0.3, colour: 'orange' },
    { type: 'cone', id: 'cone-2', x: 0.7, y: 0.3, colour: 'orange' },
  ],
}
const LADDER_DIAGRAM: DrillDiagram = {
  version: DRILL_DIAGRAM_VERSION,
  surface: { kind: 'blank', orientation: 'landscape' },
  elements: [{ type: 'goal', id: 'goal-1', x: 0.5, y: 0.1, width: 0.3, facing: 'down' }],
}

const ACTIVITIES: Activity[] = [
  { phase: 'Skill', drillId: 'd1', duration: 20 },
  { phase: 'Game', drillId: 'd2', duration: 25 },
]

// Live today: the session's own day, with a current marker, which is what
// isSessionLive requires before the watcher shows a running stage at all.
const today = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const TODAY = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

const SESSION: Session = {
  id: 's1',
  name: 'Titans Saturday',
  date: TODAY,
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
  liveActivityIndex: 0,
  liveActivityStartedAt: new Date().toISOString(),
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

// Every mutate call this screen makes DURING RENDER lands here. Static
// rendering runs no effects, so this counter says nothing about a write moved
// into a useEffect; what holds that rule is the source check in
// drillDiagram.invariant.test.ts ("writes nothing from any of the session
// surfaces"), which refuses the word mutate in the seam at all. The stronger
// guard in this file is the closed vi.mock factory below: a new hook anywhere
// in the LiveSession subtree throws until somebody wires it up deliberately.
const writes: string[] = []
const mutation = (name: string) => () => ({
  mutate: () => {
    writes.push(name)
  },
  mutateAsync: async () => {
    writes.push(name)
    return {}
  },
  isPending: false,
  isError: false,
  data: null,
  error: null,
  reset: () => {},
})

const state = {
  drills: { d1: RONDO, d2: LADDER } as Record<string, Drill>,
  diagrams: { d1: RONDO_DIAGRAM, d2: LADDER_DIAGRAM } as Record<string, DrillDiagram | null>,
  session: SESSION,
  // The driver holds sessions.create and owns the session; a watcher holds
  // neither arm of the sessions update policy.
  caps: new Set(['sessions.create']),
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
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useActivityTitle: () => (a: Activity) => (a.drillId ? (state.drills[a.drillId]?.title ?? 'Removed drill') : 'Custom'),
  useLiveSessionSync: () => {},
  useSetLiveActivity: mutation('setLiveActivity'),
  useDrillDiagram: (id: string | undefined) => query(id ? (state.diagrams[id] ?? null) : null),
  useMediaSrc: () => ({ src: null, onError: () => {}, onLoad: () => {} }),
}))

const { LiveSession } = await import('./LiveSession')

function withState<T>(over: Partial<typeof state>, run: () => T): T {
  const was = { ...state }
  Object.assign(state, over)
  try {
    return run()
  } finally {
    Object.assign(state, was)
  }
}

// The driver stage: owns the session and holds sessions.create.
const asDriver = (over: Partial<Session> = {}) =>
  withState({ session: { ...SESSION, ...over }, caps: new Set(['sessions.create']) }, () =>
    renderToStaticMarkup(<LiveSession />),
  )

// The watcher stage: no write capability at all.
const asWatcher = (over: Partial<Session> = {}) =>
  withState({ session: { ...SESSION, ...over }, caps: new Set<string>() }, () =>
    renderToStaticMarkup(<LiveSession />),
  )

describe('Live shows the current activity diagram', () => {
  it('draws the diagram for the activity the driver is on', () => {
    const html = asDriver({ liveActivityIndex: 0 })
    expect(html).toContain('Rondo 4v1')
    expect(html).toContain('data-el="cone"')
    expect(html).toContain('class="dd-surface dd-in-live"')
    // And not the other activity's picture.
    expect(html).not.toContain('data-el="goal"')
  })

  it('swaps to the correct diagram when the session advances', () => {
    // The failure this test exists for is Live keeping the previous
    // activity's picture. Position moves, picture moves with it.
    const first = asDriver({ liveActivityIndex: 0 })
    const second = asDriver({ liveActivityIndex: 1 })
    expect(first).toContain('data-el="cone"')
    expect(first).not.toContain('data-el="goal"')
    expect(second).toContain('data-el="goal"')
    expect(second).not.toContain('data-el="cone"')
    expect(second).toContain('Finishing Ladder')
  })

  it('shows a watcher the same diagram the driver is on', () => {
    const html = asWatcher({ liveActivityIndex: 1 })
    expect(html).toContain('Watching')
    expect(html).toContain('data-el="goal"')
    expect(html).not.toContain('data-el="cone"')
  })

  it('keeps the timer and the primary controls on the screen with a diagram up', () => {
    const html = asDriver({ liveActivityIndex: 0 })
    // The transport controls, the progress segments and the primary action.
    expect(html).toContain('timer-num')
    expect(html).toContain('live-controls')
    expect(html).toContain('live-foot')
    expect(html).toContain('Mark done &amp; next')
    // The foot carries the primary action and comes AFTER the stage, so the
    // diagram cannot push it out of the pinned bar it lives in.
    expect(html.indexOf('live-foot')).toBeGreaterThan(html.indexOf('dd-surface'))
  })

  it('keeps the diagram below the timer and above the coaching points', () => {
    const html = asDriver({ liveActivityIndex: 0 })
    expect(html.indexOf('dd-surface')).toBeGreaterThan(html.indexOf('timer-num'))
    expect(html.indexOf('dd-surface')).toBeLessThan(html.indexOf('Coaching points'))
  })

  it('leaves Live entirely normal for an activity whose drill has no diagram', () => {
    withState({ diagrams: { d1: null, d2: null } }, () => {
      const html = asDriver({ liveActivityIndex: 0 })
      expect(html).not.toContain('dd-surface')
      // Everything else is exactly as it was.
      expect(html).toContain('Rondo 4v1')
      expect(html).toContain('timer-num')
      expect(html).toContain('Mark done &amp; next')
      expect(html).toContain('Coaching points')
    })
  })

  it('survives a deleted drill without drawing anything or falling over', () => {
    withState({ drills: {}, diagrams: {} }, () => {
      const html = asDriver({ liveActivityIndex: 0 })
      expect(html).toContain('Removed drill')
      expect(html).not.toContain('dd-surface')
      expect(html).toContain('Mark done &amp; next')
    })
  })

  it('survives a corrupt stored diagram, which reads as no diagram', () => {
    // parseDrillDiagram returns null rather than throwing, for a hand edited
    // row and for a future version alike, so a bad row costs a picture and
    // not the session a coach is standing in the middle of.
    withState({ diagrams: { d1: null, d2: LADDER_DIAGRAM } }, () => {
      const html = asDriver({ liveActivityIndex: 0 })
      expect(html).not.toContain('dd-surface')
      expect(html).toContain('timer-num')
    })
  })

  it('shows an England Football drill its own media and no drawn diagram', () => {
    withState({ drills: { d1: FA, d2: LADDER }, diagrams: { d1: RONDO_DIAGRAM, d2: LADDER_DIAGRAM } }, () => {
      const html = asDriver({ liveActivityIndex: 0 })
      expect(html).toContain('England Football Passing')
      expect(html).not.toContain('data-el=')
      expect(html).toContain('timer-num')
    })
  })

  it('writes nothing by rendering, driver or watcher', () => {
    // A diagram is a read. Opening Live, or watching it, stores nothing.
    writes.length = 0
    asDriver({ liveActivityIndex: 0 })
    asWatcher({ liveActivityIndex: 1 })
    expect(writes).toEqual([])
  })

  it('puts no control inside the diagram on either stage', () => {
    for (const html of [asDriver({ liveActivityIndex: 0 }), asWatcher({ liveActivityIndex: 0 })]) {
      const from = html.indexOf('dd-surface')
      const surface = html.slice(from, html.indexOf('</div>', html.indexOf('</svg>', from)))
      expect(surface).not.toContain('<button')
      expect(surface).not.toContain('tabindex')
    }
  })

  it('names no child anywhere on the live screen', () => {
    const html = asDriver({ liveActivityIndex: 0 })
    for (const forbidden of ['playerId', 'player_id', 'spondMemberId', 'display_name', 'guardian']) {
      expect(html).not.toContain(forbidden)
    }
  })
})
