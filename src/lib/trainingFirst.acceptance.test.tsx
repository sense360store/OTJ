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
import { DEFAULT_LIFECYCLE_SCOPE } from './sessionLifecycle'
import { buildRegister, type RegisterEntry } from './register'
import {
  buildTonightRows,
  countByResponse,
  draftDelta,
  draftFromEntries,
  draftIsDirty,
  selectAll,
  toggleIncluded,
  tonightGroups,
  visibleRows,
} from './tonight'
import type { RsvpStatus } from './spondRsvp'
import { BIB_NONE, effectiveBib } from './bibs'
import { blankSession } from './data'
import type { Player, Session, SpondEvent, Team } from './data'
import { PlanFromSpondView } from '../components/PlanFromSpond'

const ME = 'coach-me'
const THEM = 'coach-them'

// Midday on the club week below, built from local parts. Every list in this
// file is composed at this moment rather than at whatever time the suite
// happens to run, so a fixture dated today does not quietly become history
// halfway through an evening and take the assertions with it.
const NOW = new Date(2026, 7, 11, 12, 0, 0, 0)

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
    expect(ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: ME, now: NOW }))).toEqual(['a', 'b'])
  })
})

describe('2. the default does not depend on who is looking', () => {
  it('gives the same list to the coach who owns nothing as to the one who owns everything', () => {
    const asMe = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: ME, now: NOW }))
    const asThem = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: THEM, now: NOW }))
    const asNobody = ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: null, now: NOW }))
    expect(asMe).toEqual(asThem)
    expect(asThem).toEqual(asNobody)
  })
})

describe('3. All events is the deliberate widening, and it widens to everything', () => {
  it('brings the friendly and the gala back', () => {
    expect(ids(applyEventFilter(week, { kind: 'all', scope: 'upcoming', mine: false }, { userId: ME, now: NOW }))).toEqual([
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
    expect(ids(applyEventFilter(week, { kind: 'training', scope: 'upcoming', mine: true }, { userId: ME, now: NOW }))).toEqual(['a'])
  })

  it('narrows to nothing rather than to everything when nobody is signed in', () => {
    // Fail closed. An unknown viewer must never be treated as the owner of
    // every row in the club.
    expect(ids(applyEventFilter(week, { kind: 'training', scope: 'upcoming', mine: true }, { userId: null, now: NOW }))).toEqual([])
  })
})

describe('5. the front page never claims an empty calendar while the club is training', () => {
  it("leads with the club's next training when this coach owns none", () => {
    // The old rule led with your own next session and showed "Nothing
    // scheduled yet" to everyone else, on nights the club was training.
    expect(pickNextEvent([theirTraining, gala], ME, undefined, NOW)?.id).toBe('b')
  })

  it('still prefers your own training when you have one', () => {
    expect(pickNextEvent([theirTraining, myTraining], ME, undefined, NOW)?.id).toBe('a')
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
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: titans, now: NOW }))).toEqual(['a'])
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: trojans, now: NOW }))).toEqual(['e'])
    // The friendly is a Titans event and is still absent from the Titans
    // view, because the team filter never widened the kind.
    expect(ids(applyEventFilter(byTeam, DEFAULT_EVENT_FILTER, { userId: ME, teamMatch: titans, now: NOW }))).not.toContain('c')
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
        scope={DEFAULT_LIFECYCLE_SCOPE}
        onScope={noop}
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
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: ME, spondEvents: lookup, now: NOW }))).toEqual([
      'planned-training',
      'a',
    ])
  })

  it('is present under All events', () => {
    expect(ids(applyEventFilter(schedule, { kind: 'all', scope: 'upcoming', mine: false }, { userId: ME, spondEvents: lookup, now: NOW }))).toEqual([
      'planned-match',
      'planned-training',
      'a',
    ])
  })

  it("is never Home's next training, even when it is soonest and owned", () => {
    expect(pickNextEvent(schedule, ME, lookup, NOW)?.id).toBe('a')
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
    expect(ids(trainingRows)).toEqual(ids(applyEventFilter(week, DEFAULT_EVENT_FILTER, { userId: null, now: NOW })))
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

const registerOf = (entries: RegisterEntry[] = []) => buildRegister(roster, ['titans'], teams, entries, false)

// ---- 10 to 15. Tonight, organised from Spond -------------------------
//
// These clauses were written against the Register screen, whose product
// framing this PR corrects: the question is not "who arrived?" but "who
// am I including in tonight's groups?". The truths that survive the
// reframing are restated here against the Tonight model, and the ones
// that only made sense as attendance are gone on purpose.

const tonightRows = (rsvpByPlayer: Record<string, { status: RsvpStatus }>) =>
  buildTonightRows(buildRegister(roster, ['titans'], teams, [], false), teams, rsvpByPlayer)

describe('10. Going means the parent accepted in Spond', () => {
  it('lists an accepted child whether or not the coach has selected them', () => {
    const rows = tonightRows({ 'p-going': { status: 'accepted' } })
    expect(visibleRows(rows, 'going').map((r) => r.playerId)).toEqual(['p-going'])
  })
})

describe('11. Going never means the coach included them', () => {
  it('keeps the response and the selection as two independent facts', () => {
    // A Going child need not be selected, and a Not going child may be:
    // Spond suggests the pool, the coach decides tonight's groups.
    const rows = tonightRows({ 'p-going': { status: 'accepted' }, 'p-quiet': { status: 'declined' } })
    const draft = toggleIncluded(draftFromEntries([]), 'p-quiet')
    expect(visibleRows(rows, 'going').map((r) => r.playerId)).toEqual(['p-going'])
    expect(draft.included['p-going']).toBeUndefined()
    expect(draft.included['p-quiet']).toBe(true)
  })
})

describe('12. a child with no Spond link is not a child who did not reply', () => {
  it('is counted under Everyone and under no reply state', () => {
    const rows = tonightRows({ 'p-quiet': { status: 'unanswered' } })
    const counts = countByResponse(rows)
    expect(counts.unanswered).toBe(1)
    expect(counts.all).toBe(3)
    expect(visibleRows(rows, 'unanswered').map((r) => r.playerId)).toEqual(['p-quiet'])
  })
})

describe('13. an unlinked child is found under Everyone, never under a reply state', () => {
  it('appears in Everyone and in none of the four', () => {
    const rows = tonightRows({ 'p-going': { status: 'accepted' } })
    expect(visibleRows(rows, 'all').map((r) => r.playerId)).toContain('p-unlinked')
    for (const f of ['going', 'unanswered', 'declined', 'waiting'] as const) {
      expect(visibleRows(rows, f).map((r) => r.playerId)).not.toContain('p-unlinked')
    }
  })
})

describe('14. a club with no Spond still organises the night', () => {
  it('carries the whole roster with every reply count at zero', () => {
    const rows = tonightRows({})
    expect(rows).toHaveLength(3)
    expect(countByResponse(rows)).toEqual({ going: 0, unanswered: 0, declined: 0, waiting: 0, all: 3 })
  })

  it('cannot be rendered empty out of missing context', () => {
    // Everyone is the working view and it is the complete roster, so a
    // club with no Spond can never be shown "nobody is coming".
    expect(visibleRows(tonightRows({}), 'all')).toHaveLength(3)
  })
})

describe('15. nothing persists until the coach saves', () => {
  it('writes nothing for a selection, and only the changed rows on save', () => {
    const rows = tonightRows({ 'p-going': { status: 'accepted' } })
    const draft = selectAll(draftFromEntries([]), visibleRows(rows, 'going'))
    expect(draftIsDirty(draft, [])).toBe(true)
    const delta = draftDelta(draft, [], 'reg')
    expect(delta.map((c) => c.playerId)).toEqual(['p-going'])
  })

  it('is only clean when the readback equals the draft', () => {
    const draft = selectAll(draftFromEntries([]), tonightRows({}))
    const partial: RegisterEntry[] = [
      { sessionId: 'reg', playerId: 'p-going', present: false, includedInGroups: true, bibColourOverride: null, source: 'roster' },
    ]
    expect(draftIsDirty(draft, partial)).toBe(true)
  })
})

// ---- 16 to 18. Inclusion and bibs -----------------------------------

describe('16. inclusion is the coach s decision, whatever Spond says', () => {
  it('lets a Not going child be included, because they turned up anyway', () => {
    const rows = tonightRows({ 'p-going': { status: 'declined' } })
    const draft = toggleIncluded(draftFromEntries([]), 'p-going')
    expect(rows.find((r) => r.playerId === 'p-going')?.response).toBe('declined')
    expect(draft.included['p-going']).toBe(true)
  })

  it('lets a Going child be left out, because Spond is a suggestion', () => {
    const rows = tonightRows({ 'p-going': { status: 'accepted' } })
    const draft = draftFromEntries([])
    expect(visibleRows(rows, 'going')).toHaveLength(1)
    expect(draft.included['p-going']).toBeUndefined()
  })

  it('never moves an included child out because their reply changed', () => {
    const rows = tonightRows({ 'p-going': { status: 'accepted' } })
    const draft = selectAll(draftFromEntries([]), visibleRows(rows, 'going'))
    const afterChange = tonightRows({ 'p-going': { status: 'declined' } })
    expect(tonightGroups(afterChange, draft).flatMap((g) => g.rows.map((r) => r.playerId))).toEqual(['p-going'])
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
      { sessionId: 'reg', playerId: 'p-going', present: false, includedInGroups: false, bibColourOverride: 'blue', source: 'roster' },
    ]
    const rows = registerOf(entries).groups[0].rows
    const overridden = rows.find((r) => r.player.id === 'p-going')
    expect(overridden?.bibColour).toBe('blue')
    expect(overridden?.overridden).toBe(true)
    expect(rows.find((r) => r.player.id === 'p-quiet')?.bibColour).toBe('red')
  })
})
