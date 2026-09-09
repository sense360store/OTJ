// =====================================================================
// VISUAL-02, Sessions: the real screen, rendered, in every state it has.
//
// WHAT THIS IS FOR. trainingFirst.screens.test.tsx covers what the list
// LEADS with (Training, Upcoming) and the seams cover the filter and the
// lifecycle. This mounts the route, with the data layer stubbed, because
// what this slice changed is page level: which vocabulary draws each part,
// and what each capability set is offered. That second half is the part
// that must not move at all, so it is asserted here against the screen a
// member actually gets rather than against the class names a diff shows.
//
// WHAT IT DOES NOT DO, and why the harness exists. There is no DOM here,
// so these are static renders: a chip a coach presses, a team chosen in
// the select, the focus ring and the hit areas are driven in a browser by
// tools/visual/checks.mjs and photographed by shoot.mjs.
//
// Every name in the fixtures is invented. No child appears on this screen
// by design.
// =====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { blankSession } from '../lib/data'
import type { Session } from '../lib/data'
import { ENDED_TODAY_LABEL } from '../lib/sessionLifecycle'

const ME = 'coach-me'
const THEM = 'coach-them'

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
  activities: [
    { phase: 'Warm-Up', drillId: 'd1', duration: 10 },
    { phase: 'Skill', drillId: 'd2', duration: 20 },
  ],
  ...over,
})

const MINE = session({ id: 's-mine', name: 'Titans Tuesday', coachId: ME, date: inDays(1), venueId: 'v1' })
const THEIRS = session({ id: 's-theirs', name: 'Trojans Thursday', coachId: THEM, date: inDays(3), teamIds: ['trojans'] })
const CLUB = session({ id: 's-club', name: 'Club Saturday', coachId: '', date: inDays(4), teamIds: [] })
const PAST = session({ id: 's-past', name: 'Last Tuesday', coachId: ME, date: inDays(-6) })
// Finished earlier today: one minute past midnight for ten minutes. Its
// test PINS THE CLOCK to midday on this row's own date, because between
// local midnight and 00:11 this session has not ended yet and the assertion
// would fail on a correct implementation. Found by the exact head Codex
// review; an eleven minute window a day is exactly the flake that gets
// rerun rather than read.
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
  caps: new Set<string>(['sessions.create']),
  myTeams: { teamIds: ['titans'], allTeams: false } as { teamIds: string[]; allTeams: boolean } | undefined,
}

const query = <T,>(data: T) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isSuccess: true,
  error: null,
  refetch: () => {},
})

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { id: ME, full_name: 'Sam Whitfield', club_id: 'club' } }),
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: state.sessions, loading: state.sessionsLoading, error: state.sessionsError }),
}))
// Heavy children with data layers of their own. Only the containers are
// stubbed, so the rest of each module stays real.
vi.mock('../components/PlanFromSpond', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/PlanFromSpond')>()),
  PlanFromSpond: () => null,
}))
vi.mock('../components/DeleteSessionModal', () => ({ DeleteSessionModal: () => null }))
vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useEventKindContext: () => ({ spondEvents: {}, teamNames: ['Titans', 'Trojans'] }),
  useTeams: () =>
    query([
      { id: 'titans', name: 'Titans', bibColour: null },
      { id: 'trojans', name: 'Trojans', bibColour: null },
    ]),
  useTeamMap: () => ({
    titans: { id: 'titans', name: 'Titans', bibColour: null },
    trojans: { id: 'trojans', name: 'Trojans', bibColour: null },
  }),
  useVenueMap: () => ({ v1: { id: 'v1', name: 'Southdale Fields' } }),
  useMemberMap: () => ({ [THEM]: { id: THEM, fullName: 'Priya Raghunathan' } }),
  useMyTeams: () => query(state.myTeams),
}))

const { Sessions } = await import('./Sessions')

const html = () => renderToStaticMarkup(<Sessions />)
const countOf = (s: string, needle: string) => s.split(needle).length - 1
const cards = (s: string) => s.match(/<div class="card card-padded session-card">[\s\S]*?<\/div><\/div>(?=<div class="card card-padded session-card">|<\/div>)/g) ?? []

beforeEach(() => {
  state.sessions = [MINE, THEIRS, CLUB, PAST]
  state.sessionsLoading = false
  state.sessionsError = false
  state.caps = new Set(['sessions.create'])
  state.myTeams = { teamIds: ['titans'], allTeams: false }
})
afterEach(() => {
  // The ended night's test pins the clock; every other test runs on the
  // real one, so it is released here rather than in that test's own body,
  // where a failing assertion would skip it.
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/* ---- the vocabulary ------------------------------------------------- */

describe('the Sessions screen draws with the shared vocabulary', () => {
  it('has exactly one h1, from PageHeader, with New session in its action slot', () => {
    const out = html()
    expect(countOf(out, '<h1')).toBe(1)
    expect(out).toContain('<div class="page-head"><div><h1>Sessions</h1>')
    expect(out).toMatch(/<div class="page-head-acts"><button type="button" class="btn btn-primary">[\s\S]*?New session<\/button>/)
  })

  it('puts every session card heading one level under the page title, as h2, with no h3 on the page', () => {
    const out = html()
    for (const name of ['Titans Tuesday', 'Trojans Thursday', 'Club Saturday']) expect(out).toContain(`<h2>${name}</h2>`)
    expect(out).not.toContain('<h3')
  })

  it('renders each session as the Card primitive, and every action as a Button or an IconButton', () => {
    const out = html()
    expect(countOf(out, 'class="card card-padded session-card"')).toBe(3)
    // No hand written class string is left: every .btn is a Button, which
    // always writes type="button" before the class, and every icon only
    // control is the IconButton, which is named by aria-label.
    for (const m of out.matchAll(/<button[^>]*class="(btn|icon-btn)[^"]*"/g)) expect(m[0]).toContain('type="button"')
    for (const m of out.matchAll(/<button[^>]*class="icon-btn[^"]*"[^>]*>/g)) {
      expect(m[0]).toContain('aria-label="')
      expect(m[0]).not.toContain('title=')
    }
  })

  it('writes no inline style except a plan segment\'s own share and phase', () => {
    // The route used to carry five inline sizes and hand tinted pills. The
    // design system invariant scans for fontSize; this is the whole style
    // attribute, so a margin or a colour cannot come back either. What is
    // left is data: a segment's minutes as its flex share and its phase as
    // its hue, the way a bib swatch writes its colour.
    const out = html()
    const styles = [...out.matchAll(/ style="([^"]*)"/g)].map((m) => m[1])
    expect(styles.length).toBeGreaterThan(0)
    for (const s of styles) expect(s).toMatch(/^flex:\d+;background:var\(--phase-[a-z]+\)$/)
  })

  it('names the plan bar in words, so the phases are never colour alone', () => {
    const out = html()
    expect(out).toContain('role="img" aria-label="Plan: Warm-Up 10 min, Skill 20 min"')
  })

  it('binds the team filter to a real label that is read and not shown', () => {
    const out = html()
    const m = out.match(/<label for="([^"]+)" class="sr-only">Team<\/label><select id="([^"]+)"/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(m![2])
    expect(out).toMatch(/<option value=""[^>]*>All teams<\/option><option value="club">Club<\/option>/)
  })

  it('carries the venue, the team, the owner and the counts as pills on the card', () => {
    const out = html()
    expect(out).toContain('Southdale Fields</span>')
    expect(out).toContain('Priya Raghunathan</span>')
    expect(out).toContain('2 activities</span>')
    expect(out).toContain('30 min</span>')
    expect(out).toContain('<span class="pill sc-date">')
    expect(out).toContain('<span class="avatar sc-age">')
  })

  it('shows a finished night as a Badge, a dot plus the word, never a tinted pill', () => {
    // Midday ON THE FIXTURE'S OWN DAY. Anchoring to a second reading of the
    // wall clock reintroduced the flake one door along: the fixtures are
    // built at module load, so a suite that loads at 23:59 and reaches this
    // line after midnight would compare yesterday's session against today's
    // noon, classify it as past, and drop the card out of Upcoming before
    // the badge was ever looked for. One date anchor, read from the row.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${ENDED.date}T12:00:00`))
    state.sessions = [ENDED, MINE]
    const out = html()
    expect(out).toContain(`<span class="badge"><span class="badge-dot" aria-hidden="true"></span>${ENDED_TODAY_LABEL}</span>`)
    expect(countOf(out, ENDED_TODAY_LABEL)).toBe(1)
  })
})

/* ---- the capability matrix, which must not have moved ------------- */

describe('what each capability set is offered', () => {
  it('coach: New session, Edit plan and Start and Delete on their own session, View plan and Watch on another coach\'s', () => {
    const out = html()
    const [mine, theirs, club] = cards(out)
    expect(mine).toContain('Titans Tuesday')
    expect(mine).toContain('Edit plan')
    expect(mine).toContain('>Start</button>')
    expect(mine).toContain('aria-label="Delete session"')
    expect(theirs).toContain('Trojans Thursday')
    expect(theirs).toContain('View plan')
    expect(theirs).toContain('>Watch</button>')
    expect(theirs).not.toContain('Delete session')
    expect(club).toContain('Club session</span>')
    expect(club).not.toContain('Delete session')
    // Every card offers Session day and Add to calendar.
    expect(countOf(out, 'Session day</button>')).toBe(3)
    expect(countOf(out, 'aria-label="Add to calendar"')).toBe(3)
    expect(countOf(out, 'aria-label="Delete session"')).toBe(1)
  })

  it('coach with sessions.manage: Edit plan, Start and Delete on every session', () => {
    state.caps = new Set(['sessions.create', 'sessions.manage'])
    const out = html()
    expect(countOf(out, 'Edit plan')).toBe(3)
    expect(countOf(out, '>Start</button>')).toBe(3)
    expect(countOf(out, 'aria-label="Delete session"')).toBe(3)
    expect(out).not.toContain('View plan')
  })

  it('coach: the kind chips, the lifecycle chips, the team select and Mine, in that order', () => {
    const out = html()
    const chips = [...out.matchAll(/<button class="chip[^"]*" aria-pressed="(true|false)">([^<]+)<\/button>/g)].map(
      (m) => `${m[2]}:${m[1]}`,
    )
    expect(chips).toEqual(['Training:true', 'All events:false', 'Upcoming:true', 'Past:false', 'Mine:false'])
    expect(out.indexOf('>Past</button>')).toBeLessThan(out.indexOf('<select'))
    expect(out.indexOf('<select')).toBeLessThan(out.indexOf('>Mine</button>'))
  })

  it('a member without sessions.create is offered no New session, no planner link, no Delete, and Watch rather than Start', () => {
    state.caps = new Set(['players.view'])
    const out = html()
    expect(out).not.toContain('New session')
    expect(out).not.toContain('page-head-acts')
    expect(out).not.toContain('Edit plan')
    expect(out).not.toContain('View plan')
    expect(out).not.toContain('Delete session')
    expect(out).not.toContain('>Start</button>')
    expect(out).toContain('<span class="sc-spacer"></span>')
    // The kind chips, the team select and Mine are coaching narrowings.
    expect(out).not.toContain('>Training</button>')
    expect(out).not.toContain('>Mine</button>')
    expect(out).not.toContain('<select')
    // Session day and Add to calendar stay: the day view is their detail.
    expect(countOf(out, 'Session day</button>')).toBeGreaterThan(0)
    expect(countOf(out, 'aria-label="Add to calendar"')).toBeGreaterThan(0)
  })

  it('parent: the schedule is scoped to their team, with My team and All club chips, and the club session stays in it', () => {
    state.caps = new Set()
    const out = html()
    expect(out).toContain("Your team&#x27;s training nights.")
    expect(out).toContain('aria-pressed="true">My team</button>')
    expect(out).toContain('aria-pressed="false">All club</button>')
    expect(out).toContain('<h2>Titans Tuesday</h2>')
    expect(out).toContain('<h2>Club Saturday</h2>')
    expect(out).not.toContain('Trojans Thursday')
    expect(out).toContain('>Watch</button>')
  })

  it('parent on every team: no scope toggle, the whole club', () => {
    state.caps = new Set()
    state.myTeams = { teamIds: ['titans', 'trojans'], allTeams: true }
    const out = html()
    expect(out).not.toContain('My team')
    expect(out).not.toContain('All club')
    expect(out).toContain('<h2>Trojans Thursday</h2>')
  })

  it('parent with no team: the shared info Note, and the club schedule behind it', () => {
    state.caps = new Set()
    state.myTeams = { teamIds: [], allTeams: false }
    const out = html()
    expect(out).toContain('Training nights across the club.')
    expect(out).toContain('class="note note-info parent-note"')
    expect(out).toContain('No team set yet')
    expect(out).not.toContain('My team')
    expect(out).toContain('<h2>Trojans Thursday</h2>')
  })
})

/* ---- the read and empty states -------------------------------------- */

describe('the read states and the empty schedule', () => {
  it('a read that has not answered is the labelled spinner and nothing else', () => {
    state.sessionsLoading = true
    const out = html()
    expect(out).toContain('class="loading" role="status"')
    expect(out).toContain('class="spinner"')
    expect(out).not.toContain('<h1')
  })

  it('a failed read is the announced danger state and nothing else, with no Retry', () => {
    // No Retry, and that is recorded rather than an omission: the sessions
    // read arrives through SessionsContext, which exposes no refetch.
    state.sessionsError = true
    const out = html()
    expect(out).toContain('class="state-error" role="alert"')
    expect(out).not.toContain('Retry')
    expect(out).not.toContain('<h1')
  })

  it('a club with no sessions is the Empty primitive telling a coach to plan one', () => {
    state.sessions = []
    const out = html()
    expect(out).toContain('<div class="empty">')
    expect(out).toContain('No sessions here yet')
    expect(out).toContain('Plan your first session')
    expect(out).not.toContain('session-card')
  })

  it('a parent with nothing scheduled for their team is told where the club schedule is', () => {
    state.caps = new Set()
    state.sessions = [THEIRS]
    const out = html()
    expect(out).toContain('Nothing scheduled for your team. Tap All club to see the whole club.')
  })
})
