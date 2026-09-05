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
  { id: 't1', name: 'Titans', bibColour: 'red', sortOrder: null },
  { id: 't2', name: 'Trojans', bibColour: null, sortOrder: null },
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
  location: null,
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

// A session covering ONE team, so a child from the other is a guest rather
// than a squad member. The shared SESSION covers both teams, which is a
// whole club night, and on one of those every registered child is listed
// and nobody can be a guest at all.
const GUEST_SESSION: Session = { ...SESSION, id: 's2', teamIds: ['t1'], spondEventId: null }

// Gamma is on Trojans, which this session does not cover, and holds a
// manual entry: a child a coach added on the day.
const GUEST = 'Gamma Synthetic'
const WITH_GUEST: RegisterEntry[] = [
  ...ENTRIES,
  { sessionId: 's2', playerId: 'p3', present: false, includedInGroups: true, bibColourOverride: null, source: 'manual' },
]

const state = {
  links: query({ available: true, links: [{ playerId: 'p1' }, { playerId: 'p2' }] }) as unknown,
  rsvp: query({
    p1: { status: 'accepted', syncedAt: AT },
    p2: { status: 'declined', syncedAt: AT },
  }) as unknown,
  register: query(ENTRIES) as unknown,
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
  useRegisterEntries: () => state.register,
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
const html = (session: Session = SESSION) => renderToStaticMarkup(<TonightScreen session={session} />)

// The reads a session with no Spond event has: the stored rows, and no
// replies at all. GUEST_SESSION carries no spondEventId, so leaving the
// shared reply fixture in place would give it a response context it cannot
// have, and the Going default would then hide the guest behind a filter
// rather than showing the list this test is about.
//
// The rows move from "the guest is stored" to "the delete landed and the
// readback came back without them", which is the transition that never
// used to settle.
function withStoredRows<T>(rows: RegisterEntry[], run: () => T): T {
  const was = { register: state.register, rsvp: state.rsvp }
  state.register = query(rows)
  state.rsvp = query({})
  try {
    return run()
  } finally {
    state.register = was.register
    state.rsvp = was.rsvp
  }
}

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

  it('shows both populations, each naming itself, so neither reads as the other', () => {
    // THE REPORTED DEFECT, at the surface it was reported from. The coach
    // arrives holding the event's going figure (20 here, from an audience
    // of 49) and meets a Going chip of 1, and until both sentences were on
    // one screen the product offered nothing that reconciled them: the
    // headcount alone is a third number, not an answer.
    //
    // Rendered rather than composed, because the container silently
    // dropping one half is exactly the regression this file exists for,
    // and one half alone is worse than neither.
    const out = html()
    expect(out).toContain('Spond audience: 49 people invited · 20 of them going')
    expect(out).toContain('Players this session covers: 4 · 1 of them going')
    // Order matters, twice over: the figure the coach came in with, then
    // the one this screen is actually about, then the link coverage that
    // explains why the two differ. The pair leads because it is the
    // question they arrived with; the plumbing follows.
    expect(out.indexOf('49 people invited')).toBeLessThan(out.indexOf('Players this session covers'))
    expect(out.indexOf('Players this session covers')).toBeLessThan(out.indexOf('players linked to Spond'))
  })

  it('keeps the aggregate out of every chip even now that its figure is on screen', () => {
    // The rule that did not change. 20, 18 and 11 may appear in the
    // labelled sentence and nowhere else, and the chips still count
    // covered Hub players.
    const out = html()
    expect(chip(out, 'Going')).toBe(1)
    expect(out).not.toContain('>Going 20</button>')
    expect(out).not.toContain('>Not going 18</button>')
    expect(out).not.toContain('>No reply 11</button>')
    // Spond's own words never reach the screen, only the product's.
    for (const word of ['accepted', 'declined', 'unanswered']) {
      expect(out.toLowerCase()).not.toContain(word)
    }
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

describe('the rendered screen after a stored guest is removed', () => {
  // THE REPORTED DEFECT, at the surface a coach actually looks at. The
  // model suite in ../lib/tonightGuest.test.ts drives the draft through the
  // whole round trip; this proves the container reaches the markup with it,
  // because the seam being right while the screen ignored it is a mistake
  // this repo has already made twice.
  //
  // There is no DOM here, so the tick itself cannot be clicked. What is
  // rendered is the state that follows the save: the readback has landed
  // without the guest and draftAfterSave has cleared the draft against it.
  // Before the fix that combination was not reachable at all, because the
  // draft never went clean.

  it('lists the guest while their row is stored', () => {
    withStoredRows(WITH_GUEST, () => {
      const out = html(GUEST_SESSION)
      expect(out).toContain(GUEST)
      expect(out).toContain('Added on the day')
    })
  })

  it('says Saved and leaves the guest gone once the delete has landed', () => {
    withStoredRows(ENTRIES, () => {
      const out = html(GUEST_SESSION)
      expect(out).not.toContain(GUEST)
      expect(out).toContain('>Saved</span>')
      expect(out).not.toContain('Unsaved changes')
    })
  })

  it('offers no Save, because there is nothing left to write', () => {
    // The button is disabled exactly when the status is saved, so a coach
    // cannot press the thing that used to recreate the child.
    withStoredRows(ENTRIES, () => {
      expect(html(GUEST_SESSION)).toMatch(/<button class="btn btn-primary tn-save-btn" disabled=""/)
    })
  })

  it('stays Saved over repeated renders of the same readback', () => {
    withStoredRows(ENTRIES, () => {
      expect(html(GUEST_SESSION)).toBe(html(GUEST_SESSION))
      expect(html(GUEST_SESSION)).toContain('>Saved</span>')
    })
  })

  it('still reports Saved with a guest stored and untouched', () => {
    // The other end of the same claim: a stored guest is not itself a
    // pending change, so simply opening the screen over one is clean.
    withStoredRows(WITH_GUEST, () => {
      const out = html(GUEST_SESSION)
      expect(out).toContain('>Saved</span>')
      expect(out).not.toContain('Unsaved changes')
    })
  })
})

describe('the reply figure never stands on its own', () => {
  // The pair coming apart is the way this design fails, and the screen
  // reaches that state for real. A session whose coverage was never set
  // counts nobody, so the player sentence says nothing rather than claim
  // a squad of zero, and without this the aggregate would be left alone:
  // "20 of them going" over an audience of 49, with no second population
  // beside it, which is the exact reading the whole arrangement exists to
  // prevent.
  const UNSET: Session = { ...SESSION, id: 's3', teamIds: [], teamId: null }

  it('falls back to the headcount when there is no players sentence to pair with', () => {
    withStoredRows([], () => {
      const out = html(UNSET)
      // The session covers nobody, so it says so.
      expect(out).toContain('This session has no teams yet')
      expect(out).not.toContain('Players this session covers')
      // And the aggregate drops its reply figure with it.
      expect(out).toContain('Spond audience: 49 people invited')
      expect(out).not.toContain('of them going')
    })
  })

  it('carries the reply figure whenever the pair is whole', () => {
    // The same event, on a session that does cover children: both halves.
    const out = html()
    expect(out).toContain('Spond audience: 49 people invited · 20 of them going')
    expect(out).toContain('Players this session covers: 4')
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
      // The players sentence keeps the figure it has and drops the one it
      // does not: the rows are in hand, the replies are not. Asserted on
      // the span, because the event's own sentence beside it legitimately
      // carries a going figure that arrived with the event.
      expect(out).toContain('<span class="tn-players">Players this session covers: 4</span>')
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
      // And the pair goes half silent the same way: the event's own
      // sentence is unaffected (its figures came with the event), while
      // the players sentence withholds a reply it cannot prove.
      expect(out).toContain('Spond audience: 49 people invited · 20 of them going')
      expect(out).toContain('<span class="tn-players">Players this session covers: 4</span>')
    } finally {
      state.rsvp = was
    }
  })
})
