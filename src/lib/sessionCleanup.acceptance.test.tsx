// =====================================================================
// Past sessions get out of the way, stated as acceptance tests.
//
// Each one is a sentence about what a coach sees, written before the code
// that makes it true. Together they are the specification: if the product
// ever stops behaving this way, this file is what says so, and the
// sentence in the test name is what it says.
//
// HOW EACH IS PROVED. Most exercise the shared seams directly, because
// the seams ARE the rule: Home, Sessions and the parent dashboard all
// compose their lists through applyEventFilter and the lifecycle
// predicates, so proving the rule there proves it for all of them at
// once. The rest render the presentational shells the screens use. The
// remaining gap, that a screen might hold the right seam and still write
// its own cutoff, is closed mechanically by ./sessionLifecycle.invariant.
//
// NOTHING HERE READS THE REAL CLOCK. Every list is composed at a stated
// moment built from local wall clock parts, so the file says the same
// thing on any machine on any evening.
//
// Names in fixtures are invented. No real child appears in this repo.
// =====================================================================
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { applyEventFilter, DEFAULT_EVENT_FILTER, pickNextEvent } from './eventFilter'
import { spondEventLookup } from './eventKind'
import {
  DEFAULT_LIFECYCLE_SCOPE,
  isSessionActive,
  isSessionPast,
  LIFECYCLE_SCOPE_LABELS,
  matchesLifecycleScope,
} from './sessionLifecycle'
import { sessionFromSpondEvent, spondPlanSuggestions } from './spond'
import { buildRegister, type RegisterEntry } from './register'
import { blankSession } from './data'
import type { Player, Session, SpondEvent, Team } from './data'
import { PlanFromSpondView } from '../components/PlanFromSpond'

const ME = 'coach-me'
const THEM = 'coach-them'

// A local wall clock moment, built from parts. Tuesday 11 August 2026.
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)

// The moment every list below is composed at: the morning after Monday
// night's training, and the day of Tuesday night's.
const TUESDAY_MORNING = at(2026, 8, 11, 9, 0)
const TUESDAY_EVENING = at(2026, 8, 11, 22, 0)

const session = (over: Partial<Session> & Pick<Session, 'id' | 'name' | 'date'>): Session => ({
  ...blankSession(ME, null),
  time: '18:00',
  teamIds: ['titans'],
  activities: [
    { phase: 'Warm-Up', duration: 20 },
    { phase: 'Game', duration: 40 },
  ],
  ...over,
})

// Last night's training, tonight's, and next Tuesday's.
const yesterday = session({ id: 'mon', name: 'Titans Monday', date: '2026-08-10' })
const tonight = session({ id: 'tue', name: 'Titans Tuesday', date: '2026-08-11' })
const nextWeek = session({ id: 'next', name: 'Titans Tuesday', date: '2026-08-18' })
const club = [yesterday, tonight, nextWeek]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const upcoming = (rows: Session[], now: Date) =>
  ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: ME, now }))
const past = (rows: Session[], now: Date) =>
  ids(applyEventFilter(rows, { ...DEFAULT_EVENT_FILTER, scope: 'past' }, { userId: ME, now }))

// ---- 10 to 12. Where yesterday's training goes -----------------------

describe("10. yesterday's training is not on the front page", () => {
  it('is absent from what Home counts as still to come', () => {
    // Home narrows with isSessionActive before it picks a hero or counts
    // the week, which is the composition the invariant test pins.
    expect(club.filter((s) => isSessionActive(s, TUESDAY_MORNING)).map((s) => s.id)).toEqual(['tue', 'next'])
  })

  it('is absent however long its stored status has said upcoming', () => {
    // The point of deriving it. Nothing ever set this row to completed,
    // because only the live view's End does that and almost nobody uses it.
    expect(yesterday.status).toBe('upcoming')
    expect(isSessionPast(yesterday, TUESDAY_MORNING)).toBe(true)
  })

  it('takes the upcoming count down with it rather than inflating the week', () => {
    expect(club.filter((s) => isSessionActive(s, TUESDAY_MORNING))).toHaveLength(2)
  })
})

describe('11. yesterday s training is absent from the default Sessions view', () => {
  it('leaves tonight and next week, in that order', () => {
    expect(upcoming(club, TUESDAY_MORNING)).toEqual(['tue', 'next'])
  })

  it('is the default, not something a coach has to ask for', () => {
    expect(DEFAULT_EVENT_FILTER.scope).toBe(DEFAULT_LIFECYCLE_SCOPE)
    expect(DEFAULT_LIFECYCLE_SCOPE).toBe('upcoming')
  })
})

describe('12. yesterday s training is still there under Past', () => {
  it('is one tap away, with the label the screens use', () => {
    expect(past(club, TUESDAY_MORNING)).toEqual(['mon'])
    expect(LIFECYCLE_SCOPE_LABELS.past).toBe('Past')
  })

  it('joins it there as soon as tonight has finished, without touching the row', () => {
    const before = JSON.stringify(club)
    expect(past(club, TUESDAY_EVENING)).toEqual(['mon', 'tue'])
    expect(JSON.stringify(club)).toBe(before)
  })

  it('never falls between the two views', () => {
    // Every row is in exactly one of them at any moment. A session that
    // was in neither would be a session a coach could not reach at all.
    for (const now of [TUESDAY_MORNING, TUESDAY_EVENING]) {
      for (const s of club) {
        expect(matchesLifecycleScope(s, 'upcoming', now) === matchesLifecycleScope(s, 'past', now)).toBe(false)
      }
    }
  })
})

// ---- 13 to 14. What a schedule leads with ----------------------------

describe('13. a finished session is never the next training', () => {
  it('is skipped even when it is the first row in a schedule ordered by date', () => {
    // The sessions read is ordered ascending, so last night is genuinely
    // first in the array. Being first is not being next.
    expect(pickNextEvent(club, ME, undefined, TUESDAY_MORNING)?.id).toBe('tue')
  })

  it('leaves the honest empty state when everything has happened', () => {
    expect(pickNextEvent([yesterday], ME, undefined, TUESDAY_MORNING)).toBeUndefined()
  })
})

describe('14. the next valid training takes its place', () => {
  it('moves the hero on the moment tonight ends', () => {
    expect(pickNextEvent(club, ME, undefined, TUESDAY_EVENING)?.id).toBe('next')
  })

  it('holds the hero while a coach is still running tonight', () => {
    // Running long is not finishing. The live state is written by the
    // driver, so it says something about now.
    const running = { ...tonight, liveActivityIndex: 1, liveActivityStartedAt: '2026-08-11T19:40:00Z' }
    expect(pickNextEvent([yesterday, running, nextWeek], ME, undefined, TUESDAY_EVENING)?.id).toBe('tue')
  })

  it('holds the hero five minutes after the whistle for kick off', () => {
    // The failure that started this: opening the app at 18:05 and finding
    // tonight gone.
    expect(pickNextEvent(club, ME, undefined, at(2026, 8, 11, 18, 5))?.id).toBe('tue')
  })

  it('prefers a coach s own next training, exactly as it did before', () => {
    // The lifecycle narrows what may be chosen. It does not reorder the
    // preferences inside what is left.
    const theirs = { ...session({ id: 'theirs', name: 'Trojans Tuesday', date: '2026-08-11' }), coachId: THEM }
    expect(pickNextEvent([theirs, tonight], ME, undefined, TUESDAY_MORNING)?.id).toBe('tue')
  })
})

// ---- 15. Spond driven events -----------------------------------------

describe('15. a past Spond event does not clutter the default Training list', () => {
  const spondEvent = (over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'title' | 'startsAt'>): SpondEvent => ({
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

  const ranLastNight = spondEvent({
    id: 'e-mon',
    title: 'Titans training',
    startsAt: at(2026, 8, 10, 18, 0).toISOString(),
  })
  const runsTonight = spondEvent({
    id: 'e-tue',
    title: 'Titans training',
    startsAt: at(2026, 8, 11, 18, 0).toISOString(),
  })
  const opts = {
    events: [ranLastNight, runsTonight],
    plannedEventIds: new Set<string>(),
    scopeTeamIds: ['titans'],
    showAllTeams: false,
    now: TUESDAY_MORNING,
  }

  it('offers only the night still to come', () => {
    expect(spondPlanSuggestions(opts).map((e) => e.id)).toEqual(['e-tue'])
  })

  it('keeps the one that ran reachable rather than deleting or hiding it', () => {
    expect(spondPlanSuggestions({ ...opts, scope: 'past' }).map((e) => e.id)).toEqual(['e-mon'])
    // And the mirror still holds both. Nothing about this rule removes a
    // synced row; spond-sync retention is untouched.
    expect(opts.events).toHaveLength(2)
  })

  it('shows Upcoming as the view it is in, with Past beside it', () => {
    const html = renderToStaticMarkup(
      <PlanFromSpondView
        rows={[runsTonight]}
        eventsExist
        kind="training"
        onKind={() => {}}
        scope={DEFAULT_LIFECYCLE_SCOPE}
        onScope={() => {}}
        showAll={false}
        onShowAll={() => {}}
        showAllToggle
        onPlan={() => {}}
        loading={false}
        error={false}
      />,
    )
    expect(html).toContain('aria-pressed="true">Upcoming</button>')
    expect(html).toContain('aria-pressed="false">Past</button>')
  })

  it('keeps a session planned from a past Spond event out of the default view too', () => {
    // The round trip. A session planned from an event carries the event's
    // own date and time, so the same rule reaches it through the row it
    // became; the Spond lookup still answers what KIND of night it was.
    const planned = { ...sessionFromSpondEvent(ranLastNight, ME, 'titans'), id: 'planned-mon' }
    const lookup = spondEventLookup([ranLastNight, runsTonight])
    const rows = [planned, tonight]
    expect(ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: ME, spondEvents: lookup, now: TUESDAY_MORNING }))).toEqual([
      'tue',
    ])
    expect(
      ids(
        applyEventFilter(rows, { ...DEFAULT_EVENT_FILTER, scope: 'past' }, {
          userId: ME,
          spondEvents: lookup,
          now: TUESDAY_MORNING,
        }),
      ),
    ).toEqual(['planned-mon'])
  })
})

// ---- 16 to 18. Nothing is deleted, and nothing is written ------------

describe('16. no historical session is deleted, or altered, by any of this', () => {
  it('returns a narrowed view over the same rows, leaving the source list whole', () => {
    const before = JSON.parse(JSON.stringify(club))
    const view = applyEventFilter(club, DEFAULT_EVENT_FILTER, { userId: ME, now: TUESDAY_EVENING })
    expect(view).toHaveLength(1)
    expect(club).toHaveLength(3)
    expect(club).toEqual(before)
  })

  it("leaves a past session's saved groups, bibs and quick adds exactly where they were", () => {
    // The organisation of a night that has happened is the record of it.
    // Nothing in this rule reads or writes the rows Tonight saves.
    const roster: Player[] = [
      { id: 'p1', teamId: 'titans', displayName: 'Alpha Synthetic', shirtNumber: null, createdBy: null },
      { id: 'p2', teamId: 'titans', displayName: 'Bravo Synthetic', shirtNumber: null, createdBy: null },
    ]
    const teams: Team[] = [{ id: 'titans', name: 'Titans', bibColour: 'red' }]
    const entries: RegisterEntry[] = [
      { sessionId: 'mon', playerId: 'p1', present: true, bibColourOverride: 'blue', source: 'roster' },
      { sessionId: 'mon', playerId: 'p2', present: true, bibColourOverride: null, source: 'manual' },
    ]
    const view = buildRegister(roster, ['titans'], teams, entries, false)
    expect(view.presentTotal).toBe(2)
    expect(view.groups[0].rows.find((r) => r.player.id === 'p1')?.bibColour).toBe('blue')
    expect(view.groups[0].rows.find((r) => r.player.id === 'p2')?.manual).toBe(true)
    // Composing the night takes no lifecycle input at all: it is the same
    // function, with the same arguments, for a session from any night.
    expect(buildRegister(roster, ['titans'], teams, entries, false)).toEqual(view)
  })
})

describe('17. filtering a session into Past writes nothing', () => {
  it('does not reconcile a stale status, however plainly stale it is', () => {
    // A page render is not an instruction to change a record. Reconciling
    // here would be a hidden write on every list that happened to paint.
    const stale = { ...yesterday }
    applyEventFilter([stale], DEFAULT_EVENT_FILTER, { userId: ME, now: TUESDAY_EVENING })
    pickNextEvent([stale], ME, undefined, TUESDAY_EVENING)
    isSessionPast(stale, TUESDAY_EVENING)
    expect(stale.status).toBe('upcoming')
    expect(stale).toEqual(yesterday)
  })
})

describe('18. a screen remounted after the session ended still calls it Past', () => {
  it('recomputes from the clock rather than from anything it stored', () => {
    expect(upcoming(club, TUESDAY_MORNING)).toContain('tue')
    expect(upcoming(club, TUESDAY_EVENING)).not.toContain('tue')
    expect(upcoming(club, TUESDAY_EVENING)).not.toContain('tue')
    expect(past(club, TUESDAY_EVENING)).toContain('tue')
  })
})

// ---- Where the Going view went ---------------------------------------
//
// This file used to close with a block proving that the Going view lists
// only children whose parent accepted. That rule now lives one layer down
// and is stronger than the version proved here: ../lib/tonight makes the
// Spond response and the coach's inclusion two independent facts, so
// `visibleRows(rows, 'going')` reads the reply state and nothing else, and
// there is no pinning rule left for a stray tap to exploit.
// ./tonight.test.ts owns those cases now, and registerScope.ts, which this
// file imported, no longer exists.
