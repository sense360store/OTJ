// =====================================================================
// COACH-9: the protected session share, checked rather than built.
//
// A coach sends a session to another coach from the session day surface, and
// nothing operational leaves the app. Two halves are pinned here:
//
//   - REACHABLE. The real Session Day container offers the Share action to a
//     coach (sessions.create) and to no parent. The dialog behind it holds the
//     club link, which is the canonical protected page.
//   - PROTECTED. The route that link opens, /session-day/:sessionId, sits
//     inside the auth guard, and the anonymous public route is the only route
//     outside it. That is read from App.tsx as source text, because a route
//     tree is a static thing and the realistic mistake is moving one line.
//
// The payload half (exactly a url, a title and a text) is pinned as a pure
// function in src/lib/share.test.ts, and this file pins that the dialog builds
// the payload through that function rather than composing its own.
//
// Harness: the sessionDayDiagram.screens.test.tsx pattern, with the caps as
// the one mutable knob.
// =====================================================================
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Activity, Drill, Session } from '../lib/data'

const AT = '2026-08-15T09:00:00.000Z'

const DRILL: Drill = {
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
}

const ACTIVITIES: Activity[] = [{ phase: 'Skill', drillId: 'd1', duration: 20 }]

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

// The one knob: who is looking. A coach holds sessions.create; a parent holds
// nothing that creates.
const state = {
  caps: new Set<string>(['sessions.create', 'players.view']),
  userId: 'coach-1',
}

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: state.userId }, profile: null }) }))
vi.mock('react-router-dom', () => ({
  useParams: () => ({ sessionId: 's1' }),
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))
vi.mock('../lib/queries', () => ({
  useSession: () => query(SESSION),
  useDrillMap: () => ({ d1: DRILL }),
  useMediaMap: () => ({}),
  useTeamMap: () => ({ t1: { id: 't1', name: 'Titans', bibColour: 'red' } }),
  useTeams: () => query([{ id: 't1', name: 'Titans', bibColour: 'red' }]),
  useVenueMap: () => ({}),
  useProgrammeMap: () => ({}),
  usePlayers: () => query([]),
  useBoard: () => query(null),
  useLinkSessionBoard: () => mutation(),
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useActivityTitle: () => (a: Activity) => (a.drillId ? DRILL.title : 'Custom'),
  useDrillDiagram: () => query(null),
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
  // The share dialog's own reads, mounted only once the dialog opens; a static
  // render never opens it, so these are inert here.
  useContentShareStatus: () => query(null),
  usePreviewContentShare: () => mutation(),
  useCreateContentShare: () => mutation(),
  useRefreshContentShare: () => mutation(),
  useRotateContentShare: () => mutation(),
  useRevokeContentShare: () => mutation(),
}))

const { SessionDay } = await import('./SessionDay')

const SHARE_BUTTON = /<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Share<\/button>/

function render(): string {
  return renderToStaticMarkup(<SessionDay />)
}

function withCaps<T>(caps: string[], userId: string, run: () => T): T {
  const was = { caps: state.caps, userId: state.userId }
  state.caps = new Set(caps)
  state.userId = userId
  try {
    return run()
  } finally {
    state.caps = was.caps
    state.userId = was.userId
  }
}

const SRC = join(import.meta.dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('COACH-9: the session share is reachable where intended', () => {
  it('offers Share to the owning coach on the session day surface', () => {
    const html = render()
    expect(html).toContain('Titans Saturday')
    expect(html).toMatch(SHARE_BUTTON)
  })

  it('offers Share to any coach, not only the owner: the link is the protected page and grants nothing', () => {
    withCaps(['sessions.create', 'players.view'], 'coach-2', () => {
      expect(render()).toMatch(SHARE_BUTTON)
    })
  })

  it('offers no Share to a parent', () => {
    withCaps([], 'parent-1', () => {
      const html = render()
      expect(html).toContain('Titans Saturday')
      expect(html).not.toMatch(SHARE_BUTTON)
      expect(html).not.toContain('aria-haspopup="dialog"')
    })
  })

  it('does not open the dialog on render, so no share payload is built by looking at the page', () => {
    // The payload is built inside the click handler and nowhere else; a
    // static render carries no club link and no public link.
    const html = render()
    expect(html).not.toContain('/session-day/s1')
    expect(html).not.toContain('Share inside the club')
  })
})

describe('COACH-9: the share dialog builds the club link through the one payload function', () => {
  it('composes the payload with clubLinkPayload(kind, sourceId, title) and no other fields', () => {
    // SOURCE TEXT. The realistic mistake is an inline literal that grows a
    // fourth field one day. The dialog hands the seam the kind, the id and the
    // title and nothing else.
    const dialog = read('components/ShareModal.tsx')
    expect(dialog).toContain('shareInternal(clubLinkPayload(kind, sourceId, title))')
    expect(dialog.match(/shareInternal\(/g) ?? []).toHaveLength(1)
    expect(dialog).not.toMatch(/shareInternal\(\{/)
  })

  it('hands the dialog a session’s name as its title, never a register, group or Spond fact', () => {
    // SOURCE TEXT. Session Day mounts ShareAction with the session's id and
    // name; the props it passes name no operational field.
    const page = read('routes/SessionDay.tsx')
    const start = page.indexOf('<ShareAction')
    const block = page.slice(start, page.indexOf('/>', start))
    expect(block).toContain('kind="session"')
    expect(block).toContain('sourceId={session.id}')
    expect(block).toContain('title={session.name}')
    for (const banned of ['register', 'entries', 'players', 'bib', 'group', 'spond', 'rsvp', 'venue', 'date', 'time']) {
      expect(block.toLowerCase(), banned).not.toContain(banned)
    }
  })
})

describe('COACH-9: the route the link opens is protected', () => {
  const app = read('App.tsx')

  it('places /session-day/:sessionId inside RequireAuth, and the public share route outside it', () => {
    // SOURCE TEXT over the route tree. The guard opens once; every protected
    // route sits before its close; the anonymous route sits after it.
    const guardOpen = app.indexOf('<Route element={<RequireAuth />}>')
    const sessionDay = app.indexOf('path="session-day/:sessionId"')
    const publicShare = app.indexOf('path="/share/:shareId"')
    expect(guardOpen).toBeGreaterThan(-1)
    expect(sessionDay).toBeGreaterThan(guardOpen)
    expect(publicShare).toBeGreaterThan(sessionDay)
    // Exactly one guard, exactly one public route, and nothing protected
    // declared after the public route.
    expect(app.match(/<Route element=\{<RequireAuth \/>\}>/g) ?? []).toHaveLength(1)
    expect(app.match(/path="\/share\/:shareId"/g) ?? []).toHaveLength(1)
    const after = app.slice(publicShare)
    expect(after).not.toContain('session-day')
    expect(after).not.toContain('RequireAuth')
  })

  it('keeps the club link the canonical session day path the router serves', () => {
    // The seam's path and the router's route are the same string, so a shared
    // club link opens the page the app itself navigates to.
    expect(app).toContain('path="session-day/:sessionId"')
    expect(read('lib/share.ts')).toContain('session: (id) => `/session-day/${id}`')
  })
})
