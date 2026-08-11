// =====================================================================
// The Training-first product correction, stated as eighteen acceptance
// tests.
//
// Each one is a sentence about what a coach sees, written before the code
// that makes it true. Together they are the specification: if the product
// ever stops behaving this way, this file is what says so, and the
// sentence in the test name is what it says.
//
// HOW EACH IS PROVED. Nine of the eighteen exercise the shared seams
// directly, because the seams ARE the rule: every screen composes its list
// through applyEventFilter, so proving the rule there proves it for all of
// them at once. The rest render the presentational shells the screens use.
// The remaining gap, that a screen might hold the right seam and still
// open on the wrong default, is closed mechanically by the initialiser
// assertions in ./eventKind.invariant.test.ts.
//
// Names in fixtures are invented. No real child appears in this repo.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyEventFilter, DEFAULT_EVENT_FILTER, pickNextEvent } from './eventFilter'
import {
  ALL_EVENTS_LABEL,
  DEFAULT_EVENT_KIND,
  isTrainingEvent,
  spondEventLookup,
  TRAINING_LABEL,
} from './eventKind'
import { sessionFromSpondEvent, spondPlanSuggestions } from './spond'
import { applyRegisterScope, DEFAULT_REGISTER_SCOPE, hasRsvpContext } from './registerScope'
import { buildRegister, type RegisterEntry } from './register'
import { BIB_NONE, effectiveBib } from './bibs'
import { blankSession } from './data'
import type { Player, Session, SpondEvent, Team } from './data'
import { PlanFromSpondView } from '../components/PlanFromSpond'
import { RegisterScreenView } from '../routes/SessionRegister'

const ME = 'coach-me'
const THEM = 'coach-them'

const session = (over: Partial<Session> & Pick<Session, 'id' | 'name'>): Session => ({
  ...blankSession(THEM, null),
  date: '2026-08-11',
  time: '17:30',
  teamIds: ['titans'],
  ...over,
})

// One club week: two coaches, two training nights, a friendly and a gala.
const myTraining = session({ id: 'a', name: 'Titans Tuesday', coachId: ME })
const theirTraining = session({ id: 'b', name: 'Trojans Tuesday', coachId: THEM })
const friendly = session({ id: 'c', name: 'Friendly vs Horbury', coachId: ME })
const gala = session({ id: 'd', name: 'Summer gala', coachId: THEM })
const week = [myTraining, theirTraining, friendly, gala]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

const spondEvent = (over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'title'>): SpondEvent => ({
  startsAt: '2026-08-11T17:30:00Z',
  teamId: 'titans',
  teamName: 'Titans',
  spondType: null,
  accepted: 0,
  declined: 0,
  unanswered: 0,
  waiting: 0,
  cancelled: false,
  syncedAt: '2026-08-10T12:00:00Z',
  ...over,
})

const noop = () => {}

// ---- 1 to 5. What a coach lands on -----------------------------------

describe('1. the club schedule opens on Training, not on the rows you own', () => {
  it('lists both coaches training and neither fixture', () => {
    expect(ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: ME }))).toEqual(['a', 'b'])
  })
})

describe('2. the default does not depend on who is looking', () => {
  it('gives the same list to the coach who owns nothing as to the one who owns everything', () => {
    const asMe = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: ME }))
    const asThem = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: THEM }))
    const asNobody = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: null }))
    expect(asMe).toEqual(asThem)
    expect(asThem).toEqual(asNobody)
  })
})

describe('3. All events is the deliberate widening, and it widens to everything', () => {
  it('brings the friendly and the gala back', () => {
    expect(ids(applyEventFilter(week, { kind: 'all', mine: false }, { userId: ME }))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('is the only widening offered, so no screen can invent a third view', () => {
    expect(TRAINING_LABEL).toBe('Training')
    expect(ALL_EVENTS_LABEL).toBe('All events')
    expect(DEFAULT_EVENT_KIND).toBe('training')
  })
})

describe('4. ownership is a secondary narrowing that starts off', () => {
  it('is off in the default and narrows only when asked', () => {
    expect(DEFAULT_EVENT_FILTER.mine).toBe(false)
    expect(ids(applyEventFilter(week, { kind: 'training', mine: true }, { userId: ME }))).toEqual(['a'])
  })

  it('narrows to nothing rather than to everything when nobody is signed in', () => {
    // Fail closed. An unknown viewer must never be treated as the owner of
    // every row in the club.
    expect(ids(applyEventFilter(week, { kind: 'training', mine: true }, { userId: null }))).toEqual([])
  })
})

describe('5. the front page never claims an empty calendar while the club is training', () => {
  it("leads with the club's next training when this coach owns none", () => {
    // The old rule led with your own next session and showed "Nothing
    // scheduled yet" to everyone else, on nights the club was training.
    expect(pickNextEvent([theirTraining, gala], ME)?.id).toBe('b')
  })

  it('still prefers your own training when you have one', () => {
    expect(pickNextEvent([theirTraining, myTraining], ME)?.id).toBe('a')
  })
})

// ---- 6 to 9. Team, and the Spond surfaces ----------------------------

describe('6. team is a narrowing within the kind, never the split', () => {
  const titans = (s: Session) => s.teamIds.includes('titans')
  const trojans = (s: Session) => s.teamIds.includes('trojans')
  const byTeam = [
    myTraining,
    session({ id: 'e', name: 'Trojans Thursday', coachId: THEM, teamIds: ['trojans'] }),
    friendly,
  ]

  it('changing team leaves the kind exactly where it was', () => {
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: titans }))).toEqual(['a'])
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: trojans }))).toEqual(['e'])
    // The friendly is a Titans event and is still absent from the Titans
    // view, because the team filter never widened the kind.
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: titans }))).not.toContain('c')
  })
})

describe('7. Plan from Spond suggests training first', () => {
  const events = [
    spondEvent({ id: 's-train', title: 'Titans training' }),
    spondEvent({ id: 's-match', title: 'Friendly vs Horbury', startsAt: '2026-08-12T10:00:00Z' }),
  ]
  const opts = {
    events,
    plannedEventIds: new Set<string>(),
    scopeTeamIds: ['titans'],
    showAllTeams: false,
    now: new Date('2026-08-10T00:00:00Z'),
  }

  it('offers the training night when the caller names no kind', () => {
    expect(spondPlanSuggestions(opts).map((e) => e.id)).toEqual(['s-train'])
  })

  it('offers everything under All events', () => {
    expect(spondPlanSuggestions({ ...opts, kind: 'all' }).map((e) => e.id)).toEqual(['s-train', 's-match'])
  })
})

describe('8. the Plan from Spond surface shows Training as the view it is in', () => {
  it('presses the Training chip and offers All events beside it', () => {
    const html = renderToStaticMarkup(
      <PlanFromSpondView
        rows={[spondEvent({ id: 's1', title: 'Titans training' })]}
        eventsExist
        kind={DEFAULT_EVENT_KIND}
        onKind={noop}
        showAll={false}
        onShowAll={noop}
        showAllToggle
        onPlan={noop}
        loading={false}
        error={false}
      />,
    )
    expect(html).toContain('aria-pressed="true">Training</button>')
    expect(html).toContain('aria-pressed="false">All events</button>')
  })
})

describe('9. a fixture planned from Spond is still a fixture on every screen', () => {
  // The full round trip, because this is where the model leaked: a Spond
  // MATCH planned from All events becomes a session row, and a session row
  // has nowhere to keep spond_type. "U8 v Horbury" carries no word the
  // heuristic knows, so the fixture read as training on Sessions and on
  // Home. The link is resolved at the filter seam instead; there is still
  // one classifier and it has not learned a new title trick.
  const matchEvent = spondEvent({ id: 'e-match', title: 'U8 v Horbury', spondType: 'MATCH' })
  const trainingEvent = spondEvent({ id: 'e-train', title: 'Titans Tuesday', spondType: 'EVENT' })
  const lookup = spondEventLookup([matchEvent, trainingEvent])

  // Exactly what "Plan this" writes, built by the real function.
  const plannedMatch = { ...sessionFromSpondEvent(matchEvent, ME, 'titans'), id: 'planned-match' }
  const plannedTraining = { ...sessionFromSpondEvent(trainingEvent, THEM, 'titans'), id: 'planned-training' }
  const schedule = [plannedMatch, plannedTraining, myTraining]

  it('carries no classification of its own, which is the whole problem', () => {
    // Stated so the test says why the lookup exists rather than only that
    // it works. If a spondType ever appears on Session, this fails and the
    // design gets revisited on purpose.
    expect(plannedMatch.name).toBe('U8 v Horbury')
    expect(plannedMatch.spondEventId).toBe('e-match')
    expect('spondType' in plannedMatch).toBe(false)
  })

  it('is absent from the Sessions Training view', () => {
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: ME, spondEvents: lookup }))).toEqual([
      'planned-training',
      'a',
    ])
  })

  it('is present under All events', () => {
    expect(ids(applyEventFilter(schedule, { kind: 'all', mine: false }, { userId: ME, spondEvents: lookup }))).toEqual([
      'planned-match',
      'planned-training',
      'a',
    ])
  })

  it("is never Home's next training, even when it is soonest and owned", () => {
    expect(pickNextEvent(schedule, ME, lookup)?.id).toBe('a')
  })

  it("is not labelled training by Home's hero either", () => {
    // The eyebrow reads the same classifier, so it cannot call a fixture
    // "your next training" while the list below leaves it out.
    expect(isTrainingEvent(plannedMatch, lookup)).toBe(false)
  })

  it('takes the linked training session with it, but only the fixture out', () => {
    expect(isTrainingEvent(plannedTraining, lookup)).toBe(true)
  })
})

describe('9b. one classifier answers for every surface', () => {
  it('gives the schedule, the planner and the Spond screens the same answer for the same row', () => {
    // The same row, asked as a session and as a synced event. Two shapes,
    // one rule: if these could disagree, a coach would see a session on one
    // screen and not on another and have no way to tell which was right.
    const asSession = { name: 'Friendly vs Horbury' }
    const asEvent = { title: 'Friendly vs Horbury' }
    expect(isTrainingEvent(asSession)).toBe(isTrainingEvent(asEvent))
    expect(isTrainingEvent(asSession)).toBe(false)

    // And the whole club week, classified once, matches what the schedule
    // shows under the default.
    // Wrapped, not passed by reference: the second parameter is the Spond
    // lookup, and Array.filter would hand it the index. TypeScript refuses
    // that, which is the guard, but writing it out says why.
    const trainingRows = week.filter((s) => isTrainingEvent(s))
    expect(ids(trainingRows)).toEqual(ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: null })))
  })

  it("lets Spond's own classification overrule a title that reads like training", () => {
    expect(isTrainingEvent({ title: 'Titans training', spondType: 'MATCH' })).toBe(false)
  })

  it('never hides a real training session behind a word in its name', () => {
    // The default view is only worth having if a coach can trust it, so
    // the heuristic is allowed to show a gala and never to hide a session.
    // "Saturday Pre-Match" is seeded in supabase/seed.sql as a full
    // session and was hidden from Sessions and Home by a bare word match.
    for (const name of [
      'Saturday Pre-Match',
      'Match day warm up',
      'Cup week training',
      'League restart training',
      'Post-match recovery',
    ]) {
      expect(isTrainingEvent({ name })).toBe(true)
    }
  })
})

// ---- 10 to 15. Tonight, organised from Spond -------------------------

const teams: Team[] = [
  { id: 'titans', name: 'Titans', bibColour: 'red' },
  { id: 'trojans', name: 'Trojans', bibColour: null },
]

const player = (id: string, displayName: string, teamId: string | null): Player => ({
  id,
  teamId,
  displayName,
  shirtNumber: null,
  createdBy: null,
})

const roster = [
  player('p-going', 'Alpha Synthetic', 'titans'),
  player('p-quiet', 'Bravo Synthetic', 'titans'),
  player('p-unlinked', 'Charlie Synthetic', 'titans'),
]

const fresh = '2026-08-10T17:00:00Z'
const registerOf = (entries: RegisterEntry[] = []) => buildRegister(roster, ['titans'], teams, entries, false)
const names = (html: string) => [...html.matchAll(/reg-name-main">([^<]+)</g)].map((m) => m[1])

const registerScreen = (over: Partial<Parameters<typeof RegisterScreenView>[0]> = {}) =>
  renderToStaticMarkup(
    <RegisterScreenView
      session={session({ id: 'reg', name: 'Titans Tuesday' })}
      teams={teams}
      players={roster}
      entries={[]}
      canMark
      onToggle={noop}
      onBib={noop}
      onRemove={noop}
      onQuickAdd={noop}
      {...over}
    />,
  )

describe('10. Going means the parent accepted in Spond', () => {
  it('lists an accepted child nobody has ticked in', () => {
    const out = applyRegisterScope(registerOf(), DEFAULT_REGISTER_SCOPE, {
      'p-going': { status: 'accepted', syncedAt: fresh },
    })
    expect(out.view.groups.flatMap((g) => g.rows.map((r) => r.player.id))).toEqual(['p-going'])
    expect(out.view.presentTotal).toBe(0)
  })
})

describe('11. Going never means the coach ticked them in', () => {
  it('does not admit a child to Going on the strength of a tick alone', () => {
    // Bravo is present and has not replied. Presence keeps his row on
    // screen, because nothing the coach recorded may vanish; it does not
    // make Going a statement about attendance, which is what the accepted
    // and unticked child above proves.
    const entries: RegisterEntry[] = [
      { sessionId: 'reg', playerId: 'p-quiet', present: true, bibColourOverride: null, source: 'roster' },
    ]
    const out = applyRegisterScope(registerOf(entries), 'going', {
      'p-quiet': { status: 'unanswered', syncedAt: fresh },
    })
    expect(out.view.presentTotal).toBe(1)
    // The membership rule is still the reply: with no tick, an unanswered
    // child is not in Going.
    const untouched = applyRegisterScope(registerOf(), 'going', {
      'p-quiet': { status: 'unanswered', syncedAt: fresh },
    })
    expect(untouched.view.groups).toEqual([])
  })
})

describe('12. a child with no Spond link is not a child who did not reply', () => {
  it('shows no reply pill for them at all', () => {
    const html = registerScreen({
      scope: 'all',
      rsvpByPlayer: { 'p-quiet': { status: 'unanswered', syncedAt: fresh } },
    })
    expect(html).toContain('No reply')
    // One pill on the whole screen, for the one child who has a reply to
    // show. Charlie is unlinked and gets nothing, not a "No reply".
    expect([...html.matchAll(/reg-rsvp/g)]).toHaveLength(1)
    expect(names(html)).toContain('Charlie Synthetic')
  })
})

describe('13. an unlinked child is found under Everyone, never under Going', () => {
  it('is absent from Going and present in Everyone', () => {
    const context = { 'p-going': { status: 'accepted' as const, syncedAt: fresh } }
    expect(names(registerScreen({ scope: 'going', rsvpByPlayer: context }))).toEqual(['Alpha Synthetic'])
    expect(names(registerScreen({ scope: 'all', rsvpByPlayer: context }))).toEqual([
      'Alpha Synthetic',
      'Bravo Synthetic',
      'Charlie Synthetic',
    ])
  })

  it('says how many it is holding back rather than narrowing in silence', () => {
    const html = registerScreen({
      scope: 'going',
      rsvpByPlayer: { 'p-going': { status: 'accepted', syncedAt: fresh } },
    })
    expect(html).toContain('2 hidden')
  })
})

describe('14. a club with no Spond gets the complete register and no Going view', () => {
  it('offers no toggle and lists everybody', () => {
    expect(hasRsvpContext({})).toBe(false)
    const html = registerScreen()
    expect(html).not.toContain('Going')
    expect(names(html)).toEqual(['Alpha Synthetic', 'Bravo Synthetic', 'Charlie Synthetic'])
  })

  it('cannot be talked into an empty register by a caller asking for Going', () => {
    // Missing context beats a requested scope, every time. "Nobody is
    // coming" must not be renderable out of absence.
    expect(names(registerScreen({ scope: 'going', rsvpByPlayer: {} }))).toHaveLength(3)
  })

  it('ignores replies belonging to children this session does not cover', () => {
    // A Titans session linked to a shared club event receives replies for
    // Trojans and Gladiators children, because the lookup is joined from a
    // club wide link read. Counting those as context would engage Going,
    // find nobody here accepted, and render an empty register under the
    // words "nobody has accepted".
    const html = registerScreen({
      scope: 'going',
      rsvpByPlayer: { 'a-child-on-another-team': { status: 'accepted', syncedAt: fresh } },
    })
    expect(names(html)).toHaveLength(3)
    expect(html).not.toContain('accepted')
  })
})

describe('15. a failed Spond refresh costs the context nothing', () => {
  it('keeps every reply it already had, and the register with it', () => {
    const html = registerScreen({
      scope: 'going',
      rsvpByPlayer: { 'p-going': { status: 'accepted', syncedAt: fresh } },
      onRefresh: noop,
      refreshFailed: true,
    })
    expect(html).toContain('Alpha Synthetic')
    expect(html).toContain('Could not refresh')
    // Degraded to slightly older replies, not to an error page.
    expect(html).not.toContain('Something went wrong')
  })
})

// ---- 16 to 18. Attendance and bibs -----------------------------------

describe('16. attendance is the coach s own record, markable whatever Spond says', () => {
  it('leaves every row tappable inside the Going view', () => {
    const html = registerScreen({
      scope: 'going',
      rsvpByPlayer: { 'p-going': { status: 'accepted', syncedAt: fresh } },
    })
    expect(html).toContain('aria-label="Mark Alpha Synthetic present"')
    expect(html).toContain('Add player')
  })

  it('keeps a declined child tickable and visible once ticked', () => {
    const entries: RegisterEntry[] = [
      { sessionId: 'reg', playerId: 'p-going', present: true, bibColourOverride: null, source: 'roster' },
    ]
    const html = registerScreen({
      entries,
      scope: 'going',
      rsvpByPlayer: { 'p-going': { status: 'declined', syncedAt: fresh } },
    })
    expect(html).toContain('Not going')
    expect(html).toContain('aria-pressed="true"')
  })
})

describe('17. a bib needs no configuration beyond the team', () => {
  it('dresses every child in their team colour with nothing set per player', () => {
    const view = registerOf()
    for (const row of view.groups[0].rows) {
      expect(row.bibColour).toBe('red')
      expect(row.overridden).toBe(false)
    }
  })

  it('leaves a team with no colour wearing nothing, rather than guessing one', () => {
    const trojan = [player('p-t', 'Delta Synthetic', 'trojans')]
    const view = buildRegister(trojan, ['trojans'], teams, [], false)
    expect(view.groups[0].rows[0].bibColour).toBeNull()
  })
})

describe('18. a bib override is per player, per session, and includes wearing none', () => {
  it('runs override, then team default, then nothing', () => {
    expect(effectiveBib('blue', 'red')).toBe('blue')
    expect(effectiveBib(null, 'red')).toBe('red')
    expect(effectiveBib(BIB_NONE, 'red')).toBeNull()
    expect(effectiveBib(null, null)).toBeNull()
  })

  it('shows the override on the row without changing anyone else', () => {
    const entries: RegisterEntry[] = [
      { sessionId: 'reg', playerId: 'p-going', present: false, bibColourOverride: 'blue', source: 'roster' },
    ]
    const rows = registerOf(entries).groups[0].rows
    const overridden = rows.find((r) => r.player.id === 'p-going')
    expect(overridden?.bibColour).toBe('blue')
    expect(overridden?.overridden).toBe(true)
    expect(rows.find((r) => r.player.id === 'p-quiet')?.bibColour).toBe('red')
  })
})
