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
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
