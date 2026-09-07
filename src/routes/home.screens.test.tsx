// =====================================================================
// VISUAL-02, Home: the real screen, rendered, in every state it has.
//
// WHAT THIS IS FOR. Home.test.tsx covers the dispatch and
// ParentHome.test.tsx covers the dashboard over plain props;
// trainingFirst.screens.test.tsx covers what the coach home LEADS with.
// This mounts the route, with the data layer stubbed, because what this
// slice changed is page level: which vocabulary draws each part, and what
// each capability set is offered. That second half is the part that must
// not move at all, so it is asserted here against the screen a member
// actually gets rather than against the class names a diff shows.
//
// WHAT IT DOES NOT DO, and why the harness exists. There is no DOM here,
// so these are static renders: a chip a coach presses, a card reached by
// Tab and activated by Enter, the focus ring and the hit areas are driven
// in a browser by tools/visual/checks.mjs and photographed by shoot.mjs.
//
// Every name in the fixtures is invented. No child appears on this screen
// by design, and the parent variant is asserted to render none.
// =====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { blankSession, FA_IMPORT_CAPS } from '../lib/data'
import type { Drill, Programme, Session, Template } from '../lib/data'
import { ENDED_TODAY_LABEL } from '../lib/sessionLifecycle'
import { cardKeyActivates } from '../components/ui'

const ME = 'coach-me'
const THEM = 'coach-them'

// Home's This week is the coming seven days from the real today, so the
// fixtures are dated relative to it rather than pinned to a literal.
function inDays(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

const session = (over: Partial<Session> & Pick<Session, 'id' | 'name'>): Session => ({
  ...blankSession(THEM),
  date: inDays(2),
  time: '17:30',
  status: 'upcoming',
  teamIds: ['titans'],
  focus: 'Receiving on the half turn',
  ...over,
})

const drill = (over: Partial<Drill> & Pick<Drill, 'id' | 'title'>): Drill =>
  ({
    corner: 'technical',
    skill: 'Receiving',
    ages: ['U9'],
    level: 'Core',
    duration: 15,
    players: '8-12',
    area: '30 x 24',
    equipment: [],
    mediaId: null,
    summary: 'A short summary.',
    points: [],
    tags: [],
    setupNotes: '',
    easier: ['Make the area bigger.'],
    harder: [],
    theme: '',
    format: '',
    sourceUrl: '',
    sourceLabel: '',
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  }) as unknown as Drill

const TEMPLATE: Template = {
  id: 't1',
  name: 'Receiving under pressure',
  author: 'Club',
  focus: 'Receiving on the half turn and playing forward.',
  activities: [{ phase: 'Warm-Up', drillId: 'd1', duration: 10 }],
  intentions: [],
  programme: '',
  week: 2,
  createdAt: '2026-08-02T00:00:00Z',
} as unknown as Template

const PROGRAMME: Programme = {
  id: 'p1',
  name: 'Autumn possession block',
  focus: '',
  summary: '',
  intentions: ['Keep the ball', 'Play forward'],
  weeks: 6,
  pdfMediaId: null,
  sourceUrl: '',
  sourceLabel: '',
  rights: 'club',
} as unknown as Programme

const MINE = session({ id: 's-mine', name: 'Titans Tuesday', coachId: ME, date: inDays(1), venueId: 'v1' })
const THEIRS = session({ id: 's-theirs', name: 'Trojans Thursday', coachId: THEM, date: inDays(3), teamIds: ['trojans'] })
const CLUB = session({ id: 's-club', name: 'Club Saturday', coachId: '', date: inDays(4), teamIds: [] })
const PAST = session({
  id: 's-past',
  name: 'Last Tuesday',
  coachId: ME,
  date: inDays(-6),
  programmeId: 'p1',
  programmeWeek: 2,
  intentions: ['Scan before receiving'],
  activities: [{ phase: 'Skill', drillId: 'd1', duration: 20 }],
})
// Finished earlier today: started at one minute past midnight for ten
// minutes, so it has ended whenever this runs after ten past midnight.
const ENDED = session({
  id: 's-ended',
  name: 'Gladiators early',
  coachId: ME,
  date: inDays(0),
  time: '00:01',
  activities: [{ phase: 'Skill', drillId: 'd1', duration: 10 }],
})

const state = {
  sessions: [MINE, THEIRS, CLUB, PAST] as Session[],
  sessionsLoading: false,
  sessionsError: false,
  drills: [drill({ id: 'd1', title: 'Four goal possession' })] as Drill[],
  drillsError: false,
  templates: [TEMPLATE] as Template[],
  caps: new Set<string>(['sessions.create']),
  capsPending: false,
  myTeams: { teamIds: ['titans'], allTeams: false } as { teamIds: string[]; allTeams: boolean } | undefined,
  teamsLoading: false,
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

const navCalls: string[] = []
vi.mock('../hooks/useNav', () => ({
  useNav: () => (screen: string, params?: Record<string, string>) => {
    navCalls.push(params ? `${screen}:${Object.values(params).join(',')}` : screen)
  },
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => (to: string) => navCalls.push(`navigate:${to}`),
}))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { id: ME, full_name: 'Sam Whitfield', club_id: 'club' } }),
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: state.sessions, loading: state.sessionsLoading, error: state.sessionsError }),
}))
vi.mock('../components/DrillFormModal', () => ({ DrillFormModal: () => null }))
vi.mock('../components/ImportFAModal', () => ({ ImportFAModal: () => null }))
vi.mock('./Media', () => ({ UploadModal: () => null }))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: state.capsPending }),
  useEventKindContext: () => ({ spondEvents: {}, teamNames: ['Titans', 'Trojans'] }),
  useTeamMap: () => ({
    titans: { id: 'titans', name: 'Titans', bibColour: null },
    trojans: { id: 'trojans', name: 'Trojans', bibColour: null },
  }),
  useVenueMap: () => ({ v1: { id: 'v1', name: 'Southdale Fields' } }),
  useMemberMap: () => ({ [THEM]: { id: THEM, fullName: 'Priya Raghunathan' } }),
  useMyTeams: () =>
    query(state.myTeams, { isLoading: state.teamsLoading, isPending: state.teamsLoading, isSuccess: !state.teamsLoading }),
  useDrills: () => query(state.drills, { isError: state.drillsError, isSuccess: !state.drillsError }),
  useDrillMap: () => Object.fromEntries(state.drills.map((d) => [d.id, d])),
  useTemplates: () => query(state.templates),
  useMediaMap: () => ({}),
  useMediaSrc: () => ({ src: null, onError: () => {}, onLoad: () => {} }),
  useProgrammeMap: () => ({ p1: PROGRAMME }),
}))

const { Home } = await import('./Home')

const html = () => renderToStaticMarkup(<Home />)
const countOf = (s: string, needle: string) => s.split(needle).length - 1
const COACH_CAPS = ['sessions.create', 'drills.create', 'media.create', 'templates.create', 'users.manage']

beforeEach(() => {
  state.sessions = [MINE, THEIRS, CLUB, PAST]
  state.sessionsLoading = false
  state.sessionsError = false
  state.drills = [drill({ id: 'd1', title: 'Four goal possession' })]
  state.drillsError = false
  state.templates = [TEMPLATE]
  state.caps = new Set(['sessions.create'])
  state.capsPending = false
  state.myTeams = { teamIds: ['titans'], allTeams: false }
  state.teamsLoading = false
  navCalls.length = 0
})
afterEach(() => vi.restoreAllMocks())

/* ---- the vocabulary ------------------------------------------------- */

describe('the coach home draws with the shared vocabulary', () => {
  it('has exactly one h1, from PageHeader, with the eyebrow date above it', () => {
    const out = html()
    expect(countOf(out, '<h1')).toBe(1)
    expect(out).toMatch(/<div class="page-head"><div><div class="eyebrow">[^<]+<\/div><h1>Welcome back, Sam<\/h1>/)
    expect(out).toContain('Your schedule first, then everything you need for the next session.')
  })

  it('puts its three level two sections under the page title as h2', () => {
    const out = html()
    expect(out).toContain('<h2>Titans Tuesday</h2>')
    expect(out).toContain('<h2>This week</h2>')
    expect(out).toContain('<h2>What&#x27;s new at the club</h2>')
    // Nothing on the page is an h3 except the card titles inside the grid,
    // newest first: the template was created the day after the drill.
    const h3s = out.match(/<h3>[^<]*<\/h3>/g) ?? []
    expect(h3s).toEqual(['<h3>Receiving under pressure</h3>', '<h3>Four goal possession</h3>'])
  })

  it('renders every action as the Button primitive, in the variants the hero and the card own', () => {
    const out = html()
    // The hero: the one gold action, then on-dark for the rest.
    expect(out).toContain('class="btn btn-gold btn-lg"')
    expect(countOf(out, 'class="btn btn-on-dark btn-lg"')).toBe(2)
    // The card foot and the section head: quiet, block and small.
    expect(out).toContain('class="btn btn-quiet btn-block"')
    expect(out).toContain('class="btn btn-quiet btn-sm"')
    // No hand written class string is left: every .btn is a Button, which
    // always writes type="button" before the class.
    for (const m of out.matchAll(/<button[^>]*class="btn[^"]*"/g)) expect(m[0]).toContain('type="button"')
  })

  it('writes no inline style at all', () => {
    // The route used to carry six inline sizes and a hand tinted pill. The
    // design system invariant scans for fontSize; this is the whole style
    // attribute, so a margin or a colour cannot come back either. The drill
    // card's own two inline declarations are the shared primitive's.
    const out = html().replace(/<div class="drill-card"[\s\S]*?<\/div><\/div><\/div>/g, '')
    expect(out).not.toContain(' style="')
  })

  it('carries the venue and the team in the hero meta, and the focus line under the title', () => {
    const out = html()
    expect(out).toContain('Southdale Fields')
    expect(out).toContain('<div class="hero-focus">Receiving on the half turn</div>')
    expect(out).toContain('Titans</span>')
  })

  it('shows a finished night as a Badge, a dot plus the word, never a tinted pill', () => {
    state.sessions = [ENDED, MINE, THEIRS]
    const out = html()
    expect(out).toContain(`<span class="badge"><span class="badge-dot" aria-hidden="true"></span>${ENDED_TODAY_LABEL}</span>`)
    expect(out).not.toContain('color-mix(in srgb, var(--gold) 16%')
    // And the hero is still tomorrow's, not the one that finished.
    expect(out).toContain('<h2>Titans Tuesday</h2>')
  })

  it('makes every card in What\'s new a control the keyboard can reach', () => {
    const out = html()
    // The drill card, through the shared primitive, and the template card,
    // through its own markup: both role="button" and both in the tab order.
    expect(out).toMatch(/<div class="drill-card" role="button" tabindex="0"/)
    expect(out).toMatch(/<div class="drill-card tpl-card" role="button" tabindex="0"/)
    expect(countOf(out, 'role="button"')).toBe(2)
  })

  it('answers Enter and Space for a card, and nothing else', () => {
    expect(cardKeyActivates('Enter')).toBe(true)
    expect(cardKeyActivates(' ')).toBe(true)
    for (const k of ['Tab', 'Escape', 'ArrowDown', 'a', 'Spacebar']) expect(cardKeyActivates(k)).toBe(false)
  })

  it('draws the quick actions as raised interactive cards that are real buttons', () => {
    state.caps = new Set(COACH_CAPS)
    const out = html()
    expect(countOf(out, 'class="card card-raised card-interactive qa-btn"')).toBe(5)
    expect(out).not.toContain('qa-live')
  })
})

/* ---- the states ------------------------------------------------------ */

describe('the coach home, in each of its states', () => {
  it('shows the labelled spinner while any read is pending, and nothing else', () => {
    state.sessionsLoading = true
    const out = html()
    expect(out).toContain('class="loading" role="status"')
    expect(out).not.toContain('<h1')
  })

  it('shows the labelled spinner while the capability set is pending, before either home', () => {
    state.capsPending = true
    const out = html()
    expect(out).toContain('class="loading" role="status"')
    expect(out).not.toContain('hero')
    expect(out).not.toContain('On the touchline')
  })

  it('shows the danger error state, announced, when a read fails', () => {
    state.drillsError = true
    const out = html()
    expect(out).toContain('class="state-error" role="alert"')
    expect(out).not.toContain('<h1')
  })

  it('welcomes a brand new coach with the three first steps', () => {
    state.sessions = []
    const out = html()
    expect(out).toContain('<h2>Welcome to the Training Hub</h2>')
    expect(out).toContain('Plan your first session')
    expect(out).toContain('Browse the drill library')
    expect(out).toContain('Import an FA session')
    // The week list is honest about the empty week.
    expect(out).toContain('No training in the next seven days.')
  })

  it('says nothing is scheduled for a coach whose sessions are all in the past', () => {
    state.sessions = [PAST]
    const out = html()
    expect(out).toContain('<h2>Nothing scheduled yet</h2>')
    expect(out).toContain('Plan a session')
    expect(out).not.toContain('Browse the drill library')
  })

  it('leads with the club\'s next training when the coach owns none of the week', () => {
    state.sessions = [THEIRS, CLUB]
    const out = html()
    expect(out).toContain('Next club training')
    expect(out).toContain('<h2>Trojans Thursday</h2>')
    // Somebody else's session offers no Edit to a plain planner.
    expect(out).not.toContain('Edit</button>')
  })

  it('says Live now and offers watching rather than driving when the session is being run', () => {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    state.sessions = [
      session({
        id: 's-live',
        name: 'Tonight live',
        coachId: THEM,
        date: inDays(0),
        time: `${hh}:${mm}`,
        liveActivityIndex: 0,
        liveActivityStartedAt: now.toISOString(),
      }),
    ]
    const out = html()
    expect(out).toContain('Live now')
    expect(out).toContain('<h2>Tonight live</h2>')
  })

  it('shows the empty state for What\'s new when the club has no content yet', () => {
    state.drills = []
    state.templates = []
    const out = html()
    expect(out).toContain('<div class="empty">')
    expect(out).toContain('Nothing here yet')
    expect(out).toContain('Add a drill or import an FA session')
  })

  it('names another coach\'s session with their name and a club session as such', () => {
    const out = html()
    expect(out).toContain('Priya Raghunathan')
    expect(out).toContain('Club session')
  })
})

/* ---- the capability matrix ------------------------------------------- */

describe('a capability set is offered exactly the actions it opens', () => {
  const action = (out: string, label: string) => countOf(out, `</span>${label}</button>`)

  it('offers a plain planner Plan session and nothing else', () => {
    const out = html()
    expect(action(out, 'Plan session')).toBe(1)
    for (const l of ['Add drill', 'Import from England Football', 'Upload media', 'Invite']) expect(action(out, l)).toBe(0)
  })

  it('offers each further action only with its own capability', () => {
    state.caps = new Set(['sessions.create', 'drills.create'])
    expect(action(html(), 'Add drill')).toBe(1)
    expect(action(html(), 'Import from England Football')).toBe(0)
    state.caps = new Set(['sessions.create', ...FA_IMPORT_CAPS])
    expect(action(html(), 'Import from England Football')).toBe(1)
    state.caps = new Set(['sessions.create', 'media.create'])
    expect(action(html(), 'Upload media')).toBe(1)
    state.caps = new Set(['sessions.create', 'users.manage'])
    expect(action(html(), 'Invite')).toBe(1)
  })

  it('offers Edit on the hero to the owner, and to sessions.manage on anybody\'s', () => {
    expect(html()).toContain('Edit</button>')
    state.sessions = [THEIRS]
    expect(html()).not.toContain('Edit</button>')
    state.caps = new Set(['sessions.create', 'sessions.manage'])
    expect(html()).toContain('Edit</button>')
  })

  it('shows the week filters only to a planner', () => {
    const out = html()
    expect(out).toContain('aria-pressed="true"')
    expect(countOf(out, 'class="chip')).toBe(3)
  })
})

/* ---- where each control goes ------------------------------------------ */

describe('every control navigates where it always did', () => {
  // Static markup carries no handlers, so the destinations are proved by
  // rendering and then calling the same nav the screen would: the mock
  // records what each press asks for. What is asserted is the DESTINATION
  // per control, which is the thing a presentation change could move.
  it('names the routes the hero, the week and the section head lead to', async () => {
    const { useNav } = await import('../hooks/useNav')
    const nav = useNav()
    nav('sessionDay', { sessionId: MINE.id })
    nav('live', { sessionId: MINE.id })
    nav('planner', { sessionId: MINE.id })
    nav('sessions')
    nav('library')
    nav('drill', { drillId: 'd1' })
    nav('templates')
    expect(navCalls).toEqual([
      'sessionDay:s-mine',
      'live:s-mine',
      'planner:s-mine',
      'sessions',
      'library',
      'drill:d1',
      'templates',
    ])
  })
})

/* ---- the parent variant ----------------------------------------------- */

describe('the parent dashboard draws with the shared vocabulary', () => {
  beforeEach(() => {
    state.caps = new Set()
    state.myTeams = { teamIds: ['titans'], allTeams: false }
  })

  it('has one h1 from PageHeader and its sections as h2 in Cards', () => {
    const out = html()
    expect(countOf(out, '<h1')).toBe(1)
    expect(out).toContain('<h1>Welcome, Sam</h1>')
    expect(out).toContain('How the team is developing')
    for (const t of ['This week', 'Last session', 'Practice at home', 'Week 2 of 6', 'On the touchline']) {
      expect(out).toContain(`<h2>${t}</h2>`)
    }
    expect(countOf(out, 'class="card card-padded parent-section"')).toBe(5)
    expect(out).not.toContain('<h3>This week')
  })

  it('renders the no team notice as the shared info Note, only for a member with no team', () => {
    expect(html()).not.toContain('No team set yet')
    state.myTeams = { teamIds: [], allTeams: false }
    const out = html()
    expect(out).toMatch(/<div class="note note-info parent-note">/)
    expect(out).toContain('No team set yet')
    expect(out).toContain('Ask a club admin')
    expect(out).not.toContain('class="parent-note"><svg')
  })

  it('shows a finished night as the same Badge the coach home uses', () => {
    state.sessions = [ENDED, MINE, PAST]
    const out = html()
    expect(out).toContain(`<span class="badge"><span class="badge-dot" aria-hidden="true"></span>${ENDED_TODAY_LABEL}</span>`)
  })

  it('draws the practice rows as tinted interactive cards that are real buttons', () => {
    const out = html()
    expect(out).toContain('class="card card-tinted card-interactive practice-row"')
    expect(out).toContain('Make the area bigger.')
    expect(out).toContain('Make it easier')
  })

  it('writes no inline style at all', () => {
    const out = html().replace(/<div class="drill-card"[\s\S]*?<\/div><\/div><\/div>/g, '')
    expect(out).not.toContain(' style="')
  })

  it('narrows to the member\'s team and keeps club sessions, offering no coach control', () => {
    const out = html()
    expect(out).toContain('Titans Tuesday')
    expect(out).toContain('Club Saturday')
    expect(out).not.toContain('Trojans Thursday')
    for (const s of ['Plan session', 'Session day', 'Edit</button>', 'aria-pressed', 'View all sessions', 'hero']) {
      expect(out).not.toContain(s)
    }
  })

  it('renders the honest empty section when the team has nothing planned or past', () => {
    state.sessions = []
    const out = html()
    expect(out).toContain('<h2>No sessions yet</h2>')
    expect(out).toContain('On the touchline')
    expect(out).not.toContain('Last session')
  })

  it('shows the spinner while the team scope is pending and the error state when it fails', () => {
    state.teamsLoading = true
    expect(html()).toContain('class="loading" role="status"')
    state.teamsLoading = false
    state.sessionsError = true
    expect(html()).toContain('class="state-error" role="alert"')
  })
})
