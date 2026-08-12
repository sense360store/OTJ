// =====================================================================
// The Training-first rule, tested on the SCREENS a coach actually opens.
//
// WHY THIS FILE EXISTS. Everything else pins the seams: eventKind decides
// correctly, eventFilter composes correctly, and eventKind.invariant reads
// the source and checks the screens mention the right constants. An
// adversarial review proved that combination is not enough. With the whole
// suite green it was possible to:
//
//   - change Sessions to `applyEventFilter(sessions, { ...filter, kind:
//     'all' }, ...)`, so the Training chip renders pressed over a list of
//     fixtures, and
//   - drop the Spond lookup from two of Home's three classification
//     points, so its hero announces "Your next training" over a fixture
//     while the week list below correctly excludes it.
//
// Both are the exact product failure this work exists to prevent, and both
// were invisible: a source-text check sees the identifier somewhere in the
// file and cannot see which call site uses it.
//
// So these render the real containers, with the data layer mocked, and
// assert on what comes out. A screen that stops filtering fails here.
// There is no DOM in this project, so this is static render only: it
// covers what a screen shows WHEN IT OPENS, which is exactly what "the
// default view is Training" is a claim about.
//
// THE SESSION LIFECYCLE RIDES ALONG, in the last section. It is a second
// rule about the same opening view: Upcoming is the other half of the
// default a coach lands on, and it is worth proving on the screen for the
// same reason Training is. It shares this harness rather than copying
// forty lines of mocks. What static render cannot reach is a chip a coach
// presses, so the Past VIEW itself is proved at the seams
// (../lib/eventFilter, ../lib/sessionCleanup.acceptance) and its copy in
// ../lib/sessionEmptyState; what is proved here is what opens.
//
// Names in fixtures are invented. No real child or coach appears.
// =====================================================================
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { blankSession } from '../lib/data'
import type { Session, SpondEvent } from '../lib/data'
import { spondEventLookup } from '../lib/eventKind'

const ME = 'coach-me'
const THEM = 'coach-them'

// ---- the club's week -------------------------------------------------

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
  ...blankSession(THEM, null),
  date: inDays(2),
  time: '17:30',
  status: 'upcoming',
  teamIds: ['titans'],
  ...over,
})

const spondEvent = (over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'title'>): SpondEvent => ({
  startsAt: '2026-08-12T17:30:00Z',
  teamId: 'titans',
  teamName: 'Titans',
  spondType: null,
  accepted: 3,
  declined: 0,
  unanswered: 0,
  waiting: 0,
  cancelled: false,
  syncedAt: '2026-08-11T12:00:00Z',
  ...over,
})

const MATCH_EVENT = spondEvent({ id: 'e-match', title: 'U8 v Horbury', spondType: 'MATCH' })
const TRAINING_EVENT = spondEvent({ id: 'e-train', title: 'Titans Tuesday', spondType: 'EVENT' })
const SYNCED = [MATCH_EVENT, TRAINING_EVENT]

// A linked fixture named so that no word in the exclusion list catches it:
// without the Spond link resolved, this reads as training.
const LINKED_FIXTURE = session({
  id: 's-linked-fixture',
  name: 'U8 v Horbury',
  coachId: ME,
  date: inDays(1),
  spondEventId: 'e-match',
})
const PLAIN_FIXTURE = session({ id: 's-friendly', name: 'Friendly vs Ossett Common', coachId: ME })
const GALA = session({ id: 's-gala', name: 'Summer gala', coachId: THEM })
const MY_TRAINING = session({ id: 's-mine', name: 'Titans Tuesday', coachId: ME, date: inDays(3) })
const THEIR_TRAINING = session({ id: 's-theirs', name: 'Trojans Thursday', coachId: THEM, date: inDays(4) })

const WEEK = [LINKED_FIXTURE, PLAIN_FIXTURE, GALA, MY_TRAINING, THEIR_TRAINING]

// Nights that have finished. Dated whole days back, so the assertions
// below do not depend on the hour the suite runs at: a 17:30 session two
// days ago is over on any clock.
const LAST_WEEK_TRAINING = session({
  id: 's-was',
  name: 'Titans Tuesday',
  coachId: ME,
  date: inDays(-7),
})
const YESTERDAY_TRAINING = session({
  id: 's-yesterday',
  name: 'Gladiators Monday',
  coachId: THEM,
  date: inDays(-1),
})
const YESTERDAY_GALA = session({ id: 's-was-gala', name: 'Summer gala', coachId: THEM, date: inDays(-2) })

// ---- the data layer, stubbed ----------------------------------------
//
// One union mock for every hook the five containers reach for. Held in a
// mutable object so a test can vary the capability set or the club's week
// without re-mocking the module.

const state = {
  sessions: WEEK as Session[],
  caps: new Set(['sessions.create', 'club.manage', 'players.view']),
  spondEvents: SYNCED as SpondEvent[],
}

const query = <T,>(data: T) => ({
  data,
  isLoading: false,
  isPending: false,
  isError: false,
  isRefetching: false,
  isRefetchError: false,
  error: null,
  refetch: () => {},
})

vi.mock('../hooks/useNav', () => ({ useNav: () => () => {} }))
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: ME }, profile: { full_name: 'A Coach', team_id: 'titans' } }),
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => () => {},
  Link: ({ children }: { children?: unknown }) => <a>{children as never}</a>,
}))
vi.mock('../context/SessionsContext', () => ({
  useSessions: () => ({ sessions: state.sessions, loading: false, error: null }),
}))
// Heavy children with data layers of their own. Sessions and Home are the
// subjects here; their modals and the Spond card are covered elsewhere.
// Only the container is stubbed, so the rest of that module stays real.
vi.mock('../components/PlanFromSpond', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../components/PlanFromSpond')>()),
  PlanFromSpond: () => null,
}))
vi.mock('../components/DeleteSessionModal', () => ({ DeleteSessionModal: () => null }))
vi.mock('../components/DrillFormModal', () => ({ DrillFormModal: () => null }))
vi.mock('../components/ImportFAModal', () => ({ ImportFAModal: () => null }))
vi.mock('./Media', () => ({ UploadModal: () => null }))
vi.mock('./ParentHome', () => ({ ParentHome: () => <span>PARENT_HOME</span>, NoTeamNote: () => null }))

vi.mock('../lib/queries', () => ({
  useMyCapabilities: () => ({ caps: state.caps, isPending: false }),
  useSpondEventLookup: () => spondEventLookup(state.spondEvents),
  useSpondEvents: () => query(state.spondEvents),
  useTeams: () => query([{ id: 'titans', name: 'Titans', bibColour: null }]),
  useTeamMap: () => ({ titans: { id: 'titans', name: 'Titans', bibColour: null } }),
  useVenueMap: () => ({}),
  useMemberMap: () => ({}),
  useMyTeams: () => query({ teamIds: ['titans'], allTeams: true }),
  useDrills: () => query([]),
  useDrillMap: () => ({}),
  useTemplates: () => query([]),
  useMediaMap: () => ({}),
  useCurrentSeason: () => query({ id: 'season' }),
  useRegisteredPlayers: () => query([]),
  useSpondLinks: () => query({ available: true, links: [] }),
  useSpondMappings: () => query([]),
  useSpondSync: () => ({ mutate: () => {}, isPending: false, isError: false, data: null, error: null }),
  useInsertSpondMapping: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
  useDeleteSpondMapping: () => ({ mutate: () => {}, isPending: false, isError: false, error: null }),
}))

const { Sessions } = await import('./Sessions')
const { Home } = await import('./Home')
const { AdminSpond } = await import('./AdminSpond')
const { SpondAttendanceCard } = await import('../components/SpondAttendance')

beforeEach(() => {
  state.sessions = WEEK
  state.caps = new Set(['sessions.create', 'club.manage', 'players.view'])
  state.spondEvents = SYNCED
})

// ---- Sessions --------------------------------------------------------

describe('the Sessions screen, as it opens', () => {
  const html = () => renderToStaticMarkup(<Sessions />)

  it('lists training and leaves the fixtures out', () => {
    // The mutation this catches: filtering with kind 'all' while the
    // Training chip still renders pressed.
    const out = html()
    expect(out).toContain('Titans Tuesday')
    expect(out).toContain('Trojans Thursday')
    expect(out).not.toContain('Friendly vs Ossett Common')
    expect(out).not.toContain('Summer gala')
  })

  it('leaves out a fixture planned from a Spond MATCH, whose title hides nothing', () => {
    // The mutation this catches: dropping the lookup from the filter
    // context. "U8 v Horbury" names no word the heuristic knows, so only
    // the resolved link can keep it out.
    expect(html()).not.toContain('U8 v Horbury')
  })

  it('shows another coach s training, so the default is not secretly Mine', () => {
    expect(html()).toContain('Trojans Thursday')
  })

  it('presses Training and offers All events unpressed', () => {
    const out = html()
    expect(out).toContain('aria-pressed="true">Training</button>')
    expect(out).toContain('aria-pressed="false">All events</button>')
    expect(out).toContain('aria-pressed="false">Mine</button>')
  })

  it('offers an empty Training view only the widening that can help', () => {
    // On the shipped default Mine is off and no team is chosen, so
    // suggesting either is advice that cannot change the result.
    state.sessions = [PLAIN_FIXTURE, GALA]
    const out = html()
    expect(out).toContain('Nothing matches this filter. Try All events.')
    expect(out).not.toContain('another team')
    expect(out).not.toContain('turn Mine off')
  })

  it('tells a club with no sessions at all to plan one, not to widen a filter', () => {
    state.sessions = []
    const out = html()
    expect(out).toContain('Plan your first session')
    expect(out).not.toContain('Nothing matches this filter')
  })
})

// ---- Home ------------------------------------------------------------

describe('the Home screen, as it opens', () => {
  const html = () => renderToStaticMarkup(<Home />)

  it('leads with training and never with a linked fixture', () => {
    // LINKED_FIXTURE is the soonest row AND owned by this coach, so an
    // unclassified hero would pick it. The mutation this catches: calling
    // pickNextEvent without the lookup.
    const out = html()
    expect(out).toContain('Your next training')
    expect(out).not.toContain('Your next session')
    // The hero heading is the session name.
    expect(out).toContain('<h2>Titans Tuesday</h2>')
  })

  it('never announces a fixture as training', () => {
    // The mutation this catches: calling isTrainingEvent without the
    // lookup for the eyebrow only, so the label and the list disagree.
    state.sessions = [LINKED_FIXTURE]
    const out = html()
    expect(out).toContain('<h2>U8 v Horbury</h2>')
    expect(out).toContain('Your next session')
    expect(out).not.toContain('Your next training')
  })

  it('keeps fixtures out of This week', () => {
    const out = html()
    expect(out).toContain('Trojans Thursday')
    expect(out).not.toContain('Summer gala')
    expect(out).not.toContain('Friendly vs Ossett Common')
  })

  it('presses Training in This week, with Mine off', () => {
    const out = html()
    expect(out).toContain('aria-pressed="true">Training</button>')
    expect(out).toContain('aria-pressed="false">All events</button>')
    expect(out).toContain('aria-pressed="false">Mine</button>')
  })

  it('sends a member without sessions.create to the parent dashboard untouched', () => {
    state.caps = new Set()
    expect(html()).toContain('PARENT_HOME')
  })
})

// ---- The Spond surfaces ---------------------------------------------

describe('the admin synced events list, as it opens', () => {
  it('shows the training event and not the match', () => {
    // The mutation this catches: matchesEventKind(e, 'all') on line 338.
    const out = renderToStaticMarkup(<AdminSpond />)
    expect(out).toContain('Titans Tuesday')
    expect(out).not.toContain('U8 v Horbury')
    expect(out).toContain('aria-pressed="true">Training</button>')
  })
})

describe('the linked Spond card on a session', () => {
  it('badges a linked MATCH, so the card and the filter agree about the row', () => {
    // The picker itself lives inside a modal that opens on a click, and
    // this project has no DOM. Its rule is extracted as pickerEvents and
    // tested directly in components/SpondAttendance.test.tsx; what is
    // reachable here is the card, which must not describe a fixture in
    // terms that contradict the screens leaving it out of Training.
    const out = renderToStaticMarkup(
      <SpondAttendanceCard
        spondEventId="e-match"
        teamId="titans"
        date="2026-08-12"
        time="17:30"
        canEdit
        onLink={() => {}}
      />,
    )
    expect(out).toContain('Match')
    expect(out).toContain('U8 v Horbury')
  })
})

// ---- The session lifecycle, on the screens ---------------------------

describe('the Sessions screen, on the night after training', () => {
  const html = () => renderToStaticMarkup(<Sessions />)

  it('opens on Upcoming, with Past offered beside it', () => {
    const out = html()
    expect(out).toContain('aria-pressed="true">Upcoming</button>')
    expect(out).toContain('aria-pressed="false">Past</button>')
  })

  it('leaves last night s training out of the list it opens on', () => {
    // The complaint this work started from: a session nobody ever marked
    // completed sitting in the operational list for ever.
    state.sessions = [YESTERDAY_TRAINING, MY_TRAINING]
    const out = html()
    expect(out).toContain('Titans Tuesday')
    expect(out).not.toContain('Gladiators Monday')
  })

  it('offers Past when there is history to reach, and not otherwise', () => {
    // The screen has to hand the note whether the club HAS history. This
    // is the half of that sentence a unit test cannot see.
    state.sessions = [LAST_WEEK_TRAINING, YESTERDAY_TRAINING]
    expect(html()).toContain('Nothing matches this filter. Try All events, or Past.')
    state.sessions = [PLAIN_FIXTURE, GALA]
    expect(html()).toContain('Nothing matches this filter. Try All events.')
  })

  it('never tells a club with a season behind it that nothing has finished', () => {
    // The Codex finding, at the screen. Under Upcoming with only history
    // in the club, the honest note points at Past; the claim about the
    // club is not made at all.
    state.sessions = [LAST_WEEK_TRAINING, YESTERDAY_GALA]
    expect(html()).not.toContain('No sessions have finished yet')
  })

  it('still tells a brand new club to plan a session', () => {
    state.sessions = []
    const out = html()
    expect(out).toContain('Plan your first session')
    expect(out).not.toContain('No sessions have finished yet')
  })
})

describe('the Home screen, on the night after training', () => {
  const html = () => renderToStaticMarkup(<Home />)

  it('never leads with a session that has already happened', () => {
    state.sessions = [YESTERDAY_TRAINING, MY_TRAINING]
    const out = html()
    expect(out).toContain('<h2>Titans Tuesday</h2>')
    expect(out).not.toContain('Gladiators Monday')
  })

  it('shows the honest empty hero rather than yesterday', () => {
    state.sessions = [LAST_WEEK_TRAINING, YESTERDAY_TRAINING, YESTERDAY_GALA]
    const out = html()
    expect(out).not.toContain('Gladiators Monday')
    expect(out).not.toContain('<h2>Titans Tuesday</h2>')
    expect(out).toContain('Nothing scheduled yet')
  })

  it('offers no Past chip at all, because it is the what is next surface', () => {
    expect(html()).not.toContain('>Past</button>')
  })
})

// ---- The same-day regression, at the screens --------------------------
//
// The model half is ../lib/sameDaySession.test.ts. This is the half that
// matters to a coach: with the clock fixed at 22:30 on the evening of a
// session that ended at 19:30, does the screen they open actually still
// show it, and does it still offer the way in to Session Day?
//
// The clock is FAKED rather than the fixtures dated relatively, because
// this rule is about the hour, not the day: a relative fixture would say
// nothing at 00:30 and something different at 23:00.
describe('the screens on the evening of a session that has already ended', () => {
  // 22:30 local on Tuesday 11 August 2026. The reported hour.
  const THAT_EVENING = new Date(2026, 7, 11, 22, 30, 0, 0)
  // 18:00 with no activities: the production session, which the fallback
  // duration ends at 19:30.
  const TONIGHT_ENDED = session({
    id: 's-ended-today',
    name: 'Titans Tuesday',
    coachId: ME,
    date: '2026-08-11',
    time: '18:00',
    activities: [],
  })
  const NEXT_WEEK = session({
    id: 's-next-week',
    name: 'Trojans Thursday',
    coachId: ME,
    date: '2026-08-18',
    time: '18:00',
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(THAT_EVENING)
    state.sessions = [TONIGHT_ENDED, NEXT_WEEK]
    state.spondEvents = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Sessions still lists tonight, on the view it opens on', () => {
    const out = renderToStaticMarkup(<Sessions />)
    expect(out).toContain('aria-pressed="true">Upcoming</button>')
    expect(out).toContain('Titans Tuesday')
  })

  it('Sessions says the session has ended rather than pretending it is upcoming', () => {
    expect(renderToStaticMarkup(<Sessions />)).toContain('Ended earlier today')
  })

  it('Sessions still offers the way in to Session day', () => {
    // REQUIREMENT: Session Day and Tonight stay reachable on the same
    // calendar day. The card's own button is that route.
    expect(renderToStaticMarkup(<Sessions />)).toContain('Session day')
  })

  it('Home still lists tonight in the week, marked', () => {
    const out = renderToStaticMarkup(<Home />)
    expect(out).toContain('Titans Tuesday')
    expect(out).toContain('Ended earlier today')
  })

  it('Home does not lead with it, because it is not what is next', () => {
    const out = renderToStaticMarkup(<Home />)
    // The hero is the next session, not the one that finished at 19:30.
    expect(out).toContain('<h2>Trojans Thursday</h2>')
    expect(out).not.toContain('<h2>Titans Tuesday</h2>')
  })

  it('Home shows the honest empty hero when tonight is all there is', () => {
    state.sessions = [TONIGHT_ENDED]
    const out = renderToStaticMarkup(<Home />)
    expect(out).not.toContain('<h2>Titans Tuesday</h2>')
    expect(out).toContain('Nothing scheduled yet')
    // And it is STILL in the week list below, which is the whole point:
    // not the hero, not gone.
    expect(out).toContain('Ended earlier today')
  })

  it('after local midnight it leaves the default view', () => {
    vi.setSystemTime(new Date(2026, 7, 12, 0, 30, 0, 0))
    const out = renderToStaticMarkup(<Sessions />)
    expect(out).not.toContain('Titans Tuesday')
    expect(out).not.toContain('Ended earlier today')
  })
})

// ---- The stale live marker, and the order, at the screens -------------
//
// The model half is ../lib/staleLiveSession.test.ts and
// ../lib/sessionOrder.test.ts. This is the half a coach reported: on the
// morning of 12 August 2026, Sessions showed June sessions under Upcoming
// and the recent ones were nowhere obvious. Both symptoms come from rows
// nobody ever touched again, so both are proved here against the screen
// rather than only against the seam.
//
// The clock is FAKED, because these are claims about a particular morning.
describe('the screens on the morning after a season of live markers nobody cleared', () => {
  // 09:00 on Wednesday 12 August 2026, when the screenshots were taken.
  const THAT_MORNING = new Date(2026, 7, 12, 9, 0, 0, 0)

  // The hosted row that made this visible: 16 June, still saying upcoming,
  // still carrying live_activity_index 0 from the evening it was driven.
  const JUNE_STALE_LIVE = session({
    id: 's-june',
    name: 'Attacking session: 2v2 to score',
    coachId: ME,
    date: '2026-06-16',
    time: '17:30',
    activities: [],
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-06-16T16:55:16.004Z',
  })
  const LAST_NIGHT = session({
    id: 's-aug11',
    name: 'Training',
    coachId: ME,
    date: '2026-08-11',
    time: '18:00',
    activities: [],
  })
  const IN_TEN_DAYS = session({
    id: 's-aug22',
    name: 'Lindley Moor',
    coachId: ME,
    date: '2026-08-22',
    time: '10:00',
  })
  const IN_SEVENTEEN_DAYS = session({
    id: 's-aug29',
    name: 'Clifton moor',
    coachId: ME,
    date: '2026-08-29',
    time: '12:00',
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(THAT_MORNING)
    state.sessions = [JUNE_STALE_LIVE, LAST_NIGHT, IN_TEN_DAYS, IN_SEVENTEEN_DAYS]
    state.spondEvents = []
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Sessions leaves the June session out of the view it opens on', () => {
    const out = renderToStaticMarkup(<Sessions />)
    expect(out).not.toContain('Attacking session')
    expect(out).toContain('Lindley Moor')
  })

  it('Sessions lists what is coming soonest first', () => {
    const out = renderToStaticMarkup(<Sessions />)
    expect(out.indexOf('Lindley Moor')).toBeLessThan(out.indexOf('Clifton moor'))
  })

  it('Home does not lead with the June session, and never calls it live', () => {
    const out = renderToStaticMarkup(<Home />)
    expect(out).toContain('<h2>Lindley Moor</h2>')
    expect(out).not.toContain('Attacking session')
    // The badge the stale marker produced: "Live now" on a session that
    // finished in June.
    expect(out).not.toContain('Live now')
  })

  it('Home does not call a FUTURE session live because of a marker left on it', () => {
    // The hero is the only place a stale marker can still reach once the
    // lifecycle is right, because a stale row is past and past is never the
    // hero. A future session carrying contradictory live columns IS still
    // the hero (it is still to come), and reading the column there put
    // "Live now" on a session ten days away.
    state.sessions = [{ ...IN_TEN_DAYS, liveActivityIndex: 2, liveActivityStartedAt: '2026-06-16T16:55:16.004Z' }]
    const out = renderToStaticMarkup(<Home />)
    expect(out).toContain('<h2>Lindley Moor</h2>')
    expect(out).not.toContain('Live now')
    // And it says what it should say instead: how far away the night is.
    expect(out).toContain('In 10 days')
  })

  it('Home does call tonight live while somebody is actually driving it', () => {
    // The other direction, so the badge is not simply switched off. A
    // session being driven now, marker stamped this morning, still leads
    // with Live now.
    state.sessions = [
      {
        ...LAST_NIGHT,
        id: 's-now',
        name: 'Being driven',
        date: '2026-08-12',
        time: '08:30',
        liveActivityIndex: 1,
        liveActivityStartedAt: new Date(2026, 7, 12, 8, 45).toISOString(),
      },
    ]
    const out = renderToStaticMarkup(<Home />)
    expect(out).toContain('<h2>Being driven</h2>')
    expect(out).toContain('Live now')
  })

  // Home's "Watch live" quick action is DELIBERATELY NOT COVERED HERE, and
  // that is a finding rather than an omission: it renders only when the
  // action list is empty, and the action list always holds Plan session for
  // anybody who reaches CoachHome at all, because both are gated on
  // sessions.create. A member without it gets ParentHome instead. So the
  // branch is unreachable, and a test asserting it would only be asserting
  // that ParentHome renders. Its liveNow read still goes through the seam,
  // which ../lib/sessionLifecycle.invariant.test.ts enforces from the
  // source side.

  it('Sessions still opens on Upcoming with Past beside it, unchanged', () => {
    const out = renderToStaticMarkup(<Sessions />)
    expect(out).toContain('aria-pressed="true">Upcoming</button>')
    expect(out).toContain('aria-pressed="false">Past</button>')
  })
})
