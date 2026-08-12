// =====================================================================
// The stale live regression, pinned against the production rows that
// exposed it.
//
// WHAT HAPPENED. On 12 August 2026 the Sessions screen showed June
// sessions under Upcoming. Nothing had been deleted and no date was
// wrong. Five rows in the hosted database carried a live marker their
// driver never cleared:
//
//   a1e1855d  2026-06-16  Marking session: marking rivals
//               live_activity_index 0, stamped 2026-06-11
//   13637155  2026-06-16  Attacking session: 2v2 to score
//               live_activity_index 0, stamped 2026-06-16
//   f0307cef  2026-06-23  Marking and intercepting to defend, week 1
//               live_activity_index 0, stamped 2026-06-16
//   70b2415f  2026-07-28  Marking and intercepting to defend, week 6
//               live_activity_index 0, stamped 2026-06-16
//   66cfe51b  2026-08-01  Attacking Week 1
//               live_activity_index 0, stamped 2026-07-16
//
// Every one of them still says status 'upcoming', because the only thing
// that writes 'completed' is the live view's End, which is also the only
// thing that clears the live columns. So a driver who closed the tab left
// both facts stuck, and the lifecycle read the bare column as "this
// session is running now" for ever.
//
// THE FIX IS A READING RULE, NOT A CLEANUP. Nothing in this product
// rewrites those five rows. isSessionLive reads the marker as evidence
// with a date on it: current on the local day it belongs to, stale after.
// Every one of these tests therefore also asserts that the stored fields
// are exactly where they were, because a lifecycle that repaired its
// input would be a page render writing to the database.
//
// The suite runs in Europe/London (vite.config.ts), so the summer hours
// where BST and UTC disagree are actually exercised.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  isSessionActive,
  isSessionLive,
  liveActivityNow,
  isSessionOperational,
  isSessionPast,
  matchesLifecycleScope,
  sessionLifecycle,
  type TimedEvent,
} from './sessionLifecycle'
import { applyEventFilter, pickNextEvent } from './eventFilter'

// Local wall clock, which is what every one of these rules is stated in.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)

// The morning the screenshots were taken.
const TODAY = at(2026, 8, 12, 9, 0)

interface Row extends TimedEvent {
  id: string
  name: string
  coachId: string
}

const COACH = '523cec32-d847-4a5b-a843-e3aa8ae20572'

const row = (over: Partial<Row> & Pick<Row, 'id' | 'name' | 'date'>): Row => ({
  time: '17:30',
  status: 'upcoming',
  activities: [],
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  coachId: COACH,
  ...over,
})

// The five hosted rows, reduced to the fields the lifecycle reads.
const STALE_LIVE: Row[] = [
  row({
    id: 'a1e1855d',
    name: 'Marking session: marking rivals',
    date: '2026-06-16',
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-06-11T16:43:03.868Z',
  }),
  row({
    id: '13637155',
    name: 'Attacking session: 2v2 to score',
    date: '2026-06-16',
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-06-16T16:55:16.004Z',
  }),
  row({
    id: 'f0307cef',
    name: 'Marking and intercepting to defend · Week 1',
    date: '2026-06-23',
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-06-16T16:52:28.175Z',
  }),
  row({
    id: '70b2415f',
    name: 'Marking and intercepting to defend · Week 6',
    date: '2026-07-28',
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-06-16T16:56:03.395Z',
  }),
  row({
    id: '66cfe51b',
    name: 'Attacking Week 1',
    date: '2026-08-01',
    time: '09:00',
    liveActivityIndex: 0,
    liveActivityStartedAt: '2026-07-16T11:47:44.418Z',
  }),
]

// The two genuinely upcoming rows the hosted database also holds, so the
// filters below are asked to keep something as well as to drop something.
const FUTURE: Row[] = [
  row({ id: '46af1cdf', name: 'Lindley Moor – TITANS', date: '2026-08-22', time: '10:00' }),
  row({ id: 'e09b60a2', name: 'Clifton moor gala', date: '2026-08-29', time: '12:00' }),
]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const upcoming = (rows: Row[], now: Date) =>
  ids(applyEventFilter(rows, { kind: 'all', scope: 'upcoming', mine: false }, { userId: COACH, now }))

describe('the five hosted rows with a live marker nobody cleared', () => {
  // REQUIREMENT 1. The reported case, exactly.
  it('are all past on 12 August 2026, marker or no marker', () => {
    for (const s of STALE_LIVE) {
      expect(sessionLifecycle(s, TODAY), s.id).toBe('past')
      expect(isSessionLive(s, TODAY), s.id).toBe(false)
      expect(isSessionActive(s, TODAY), s.id).toBe(false)
      expect(isSessionOperational(s, TODAY), s.id).toBe(false)
    }
  })

  it('are absent from the default Sessions view and present under Past', () => {
    const all = [...STALE_LIVE, ...FUTURE]
    expect(upcoming(all, TODAY)).toEqual(['46af1cdf', 'e09b60a2'])
    expect(
      ids(applyEventFilter(all, { kind: 'all', scope: 'past', mine: false }, { userId: COACH, now: TODAY })),
    ).toEqual(['66cfe51b', '70b2415f', 'f0307cef', 'a1e1855d', '13637155'])
  })

  it('are never what Home leads with', () => {
    // pickNextEvent reads isSessionActive, so this is the same rule seen
    // from the surface that put "Live now" on a June session.
    expect(pickNextEvent([...STALE_LIVE, ...FUTURE], COACH, undefined, TODAY)?.id).toBe('46af1cdf')
  })

  it('keep their stored live fields, because deciding is not writing', () => {
    // REQUIREMENT 17. The columns stay exactly as the database holds them.
    // No migration clears them and no render repairs them; they simply stop
    // meaning "this session is running".
    for (const s of STALE_LIVE) {
      const before = JSON.stringify(s)
      sessionLifecycle(s, TODAY)
      isSessionLive(s, TODAY)
      matchesLifecycleScope(s, 'upcoming', TODAY)
      expect(JSON.stringify(s), s.id).toBe(before)
      expect(s.liveActivityIndex).toBe(0)
      expect(s.liveActivityStartedAt).toBeTruthy()
    }
  })

  it('give the live view no activity to show a clock against', () => {
    // The watcher computes its clock from live_activity_started_at, so a
    // stale marker there is not a badge, it is a full live stage counting up
    // from June. liveActivityNow is the same rule with the index instead of
    // a boolean, so the two halves of the live view cannot disagree.
    for (const s of STALE_LIVE) {
      expect(liveActivityNow(s, TODAY), s.id).toBeNull()
    }
    const driven = row({
      id: 'driven',
      name: 'Being driven',
      date: '2026-08-12',
      time: '08:30',
      liveActivityIndex: 3,
      liveActivityStartedAt: new Date(2026, 7, 12, 8, 45).toISOString(),
    })
    expect(liveActivityNow(driven, TODAY)).toBe(3)
    // Index 0 is a real activity, not an absence: a rule written with a
    // falsy check would lose the first activity of every live session.
    expect(liveActivityNow({ ...driven, liveActivityIndex: 0 }, TODAY)).toBe(0)
  })

  it('were active on their own day, which is why the bare column looked right', () => {
    // The rule is not "ignore the marker". Each of these was genuinely live
    // on the evening it was written, and that is exactly the behaviour worth
    // keeping.
    const june16 = STALE_LIVE[1]
    expect(isSessionLive(june16, at(2026, 6, 16, 22, 0))).toBe(true)
    expect(sessionLifecycle(june16, at(2026, 6, 16, 22, 0))).toBe('active')
  })
})

describe('yesterday, which is the general form of the same bug', () => {
  // REQUIREMENT 2.
  const yesterday = row({
    id: 'y',
    name: 'Last night',
    date: '2026-08-11',
    time: '18:00',
    liveActivityIndex: 1,
    liveActivityStartedAt: '2026-08-11T18:40:00Z',
  })

  it('is past this morning', () => {
    expect(sessionLifecycle(yesterday, TODAY)).toBe('past')
    expect(isSessionPast(yesterday, TODAY)).toBe(true)
  })

  it('was still active at 23:30 on its own evening', () => {
    expect(sessionLifecycle(yesterday, at(2026, 8, 11, 23, 30))).toBe('active')
  })

  // REQUIREMENT 5. The transition is midnight, not an hour count.
  it('turns over at local midnight and nowhere else', () => {
    expect(sessionLifecycle(yesterday, at(2026, 8, 11, 23, 59))).toBe('active')
    expect(sessionLifecycle(yesterday, at(2026, 8, 12, 0, 0))).toBe('past')
  })
})

describe('a session genuinely being run today', () => {
  // REQUIREMENT 3.
  const tonight = row({
    id: 't',
    name: 'Tonight',
    date: '2026-08-12',
    time: '18:00',
    activities: [{ duration: 30 }, { duration: 30 }],
    liveActivityIndex: 1,
    liveActivityStartedAt: new Date(2026, 7, 12, 19, 20).toISOString(),
  })

  it('stays active well past its planned end', () => {
    // Planned 18:00 to 19:00. The coach is still going at 21:45.
    expect(sessionLifecycle(tonight, at(2026, 8, 12, 21, 45))).toBe('active')
    expect(isSessionLive(tonight, at(2026, 8, 12, 21, 45))).toBe(true)
  })

  it('is what Home leads with, over a session that has not started', () => {
    // pickNextEvent takes a list ALREADY ordered soonest first and picks the
    // first row that qualifies; that contract is unchanged by the ordering
    // seam and ./sessionOrder.test.ts pins it from the other side.
    expect(pickNextEvent([tonight, ...FUTURE], COACH, undefined, at(2026, 8, 12, 21, 45))?.id).toBe('t')
  })
})

describe('a session that ended earlier today', () => {
  // REQUIREMENT 4, restated here because the stale live rule must not
  // narrow it: a night that finished at 19:30 is still tonight's work.
  const ended = row({
    id: 'e',
    name: 'Finished at half seven',
    date: '2026-08-12',
    time: '18:00',
    activities: [{ duration: 90 }],
  })

  it('stays in the default view all evening', () => {
    expect(sessionLifecycle(ended, at(2026, 8, 12, 22, 30))).toBe('endedToday')
    expect(matchesLifecycleScope(ended, 'upcoming', at(2026, 8, 12, 22, 30))).toBe(true)
  })

  it('moves to Past at local midnight', () => {
    expect(sessionLifecycle(ended, at(2026, 8, 13, 0, 1))).toBe('past')
  })
})

// =====================================================================
// The adversarial half: every shape a live marker can arrive in, including
// the ones that cannot happen if the driver behaves.
// =====================================================================
describe('every shape the live columns can arrive in', () => {
  it('a marker stamped weeks before the session it sits on is stale', () => {
    // a1e1855d in production: dated 16 June, stamped 11 June. Neither date
    // is today, so nothing about it is current.
    const s = STALE_LIVE[0]
    expect(isSessionLive(s, TODAY)).toBe(false)
    expect(sessionLifecycle(s, TODAY)).toBe('past')
  })

  it('a live index with no timestamp falls back to the session s own day', () => {
    // Nothing dates the marker, so the session dates it. Today keeps it,
    // June does not. This shape is not written by the driver, which always
    // writes both, so it exists here to pin the fallback rather than a
    // behaviour anybody relies on.
    const today = row({ id: 'a', name: 'No stamp, today', date: '2026-08-12', liveActivityIndex: 0 })
    const june = row({ id: 'b', name: 'No stamp, June', date: '2026-06-16', liveActivityIndex: 0 })
    expect(isSessionLive(today, TODAY)).toBe(true)
    expect(isSessionLive(june, TODAY)).toBe(false)
    expect(sessionLifecycle(june, TODAY)).toBe('past')
  })

  it('a timestamp with no live index is not live at all', () => {
    // The index is what says a session is being driven. A leftover
    // timestamp on its own says nothing, and must not resurrect anything.
    const s = row({
      id: 'c',
      name: 'Stamp only',
      date: '2026-08-12',
      liveActivityIndex: null,
      liveActivityStartedAt: new Date(2026, 7, 12, 8, 55).toISOString(),
    })
    expect(isSessionLive(s, TODAY)).toBe(false)
    // Still active, because it is today and has not ended: the clock
    // decides, which is the point.
    expect(sessionLifecycle(s, TODAY)).toBe('active')
  })

  it('an unreadable timestamp falls back rather than throwing or hiding', () => {
    const s = row({
      id: 'd',
      name: 'Bad stamp',
      date: '2026-08-12',
      liveActivityIndex: 0,
      liveActivityStartedAt: 'not a date',
    })
    expect(isSessionLive(s, TODAY)).toBe(true)
    const old = row({ ...s, id: 'd2', date: '2026-06-16' })
    expect(isSessionLive(old, TODAY)).toBe(false)
  })

  it('completed beats a stale live index, and beat it before as well', () => {
    const s = row({
      id: 'f',
      name: 'Ended in June',
      date: '2026-06-16',
      status: 'completed',
      liveActivityIndex: 0,
      liveActivityStartedAt: '2026-06-16T16:55:16Z',
    })
    expect(sessionLifecycle(s, TODAY)).toBe('past')
  })

  it('a future session carrying contradictory live columns is not live', () => {
    // It is still active, because it has not happened. What it must not do
    // is claim somebody is running it, which is what a Live badge on next
    // Saturday's gala would say.
    const s = row({
      id: 'g',
      name: 'Next Saturday',
      date: '2026-08-22',
      time: '10:00',
      liveActivityIndex: 2,
      liveActivityStartedAt: '2026-06-16T16:55:16Z',
    })
    expect(isSessionLive(s, TODAY)).toBe(false)
    expect(sessionLifecycle(s, TODAY)).toBe('active')
  })

  it('an overnight session survives its own midnight', () => {
    // 23:00 start, 120 planned minutes, so it ends at 01:00 the next day.
    // At 00:30 the marker's day has turned over, and the CLOCK keeps the
    // session because its expected end has not passed.
    const s = row({
      id: 'h',
      name: 'Late one',
      date: '2026-08-11',
      time: '23:00',
      activities: [{ duration: 120 }],
      liveActivityIndex: 0,
      liveActivityStartedAt: '2026-08-11T22:05:00Z',
    })
    expect(isSessionLive(s, at(2026, 8, 12, 0, 30))).toBe(false)
    expect(sessionLifecycle(s, at(2026, 8, 12, 0, 30))).toBe('active')
    // And once it has run out, it is still reachable for the rest of the
    // day it ended on.
    expect(sessionLifecycle(s, at(2026, 8, 12, 1, 30))).toBe('endedToday')
  })

  it('a driver still pressing Next after midnight keeps the session', () => {
    // The marker is rewritten on every activity change, so a coach genuinely
    // running into the small hours has evidence dated today. This is the
    // case a bare column read and a calendar day rule agree on, and an hour
    // count would have got wrong in one direction or the other.
    const s = row({
      id: 'i',
      name: 'Still going',
      date: '2026-08-11',
      time: '18:00',
      liveActivityIndex: 4,
      liveActivityStartedAt: new Date(2026, 7, 12, 0, 40).toISOString(),
    })
    expect(isSessionLive(s, at(2026, 8, 12, 1, 0))).toBe(true)
    expect(sessionLifecycle(s, at(2026, 8, 12, 1, 0))).toBe('active')
  })

  it('reads the local day, not the UTC one, on a British Summer Time evening', () => {
    // 23:30 BST on 11 August is already 22:30 UTC on the 11th, but a marker
    // stamped at 23:30 BST on a session dated the 11th is the same LOCAL
    // day, which is the question a coach is asking. Comparing UTC dates
    // would answer a different question for one hour of every summer
    // evening.
    const s = row({
      id: 'j',
      name: 'Late BST',
      date: '2026-08-11',
      time: '23:00',
      liveActivityIndex: 0,
      liveActivityStartedAt: new Date(2026, 7, 11, 23, 30).toISOString(),
    })
    expect(new Date(s.liveActivityStartedAt!).toISOString().slice(0, 10)).toBe('2026-08-11')
    expect(isSessionLive(s, at(2026, 8, 11, 23, 45))).toBe(true)
    expect(isSessionLive(s, at(2026, 8, 12, 0, 15))).toBe(false)
  })

  it('reads the local day across the winter clock change too', () => {
    // 25 October 2026 is a 25 hour day in London. A session that evening is
    // live on its own day and stale the next, exactly as in summer.
    const s = row({
      id: 'k',
      name: 'Clocks go back',
      date: '2026-10-25',
      time: '18:00',
      liveActivityIndex: 0,
      liveActivityStartedAt: new Date(2026, 9, 25, 18, 30).toISOString(),
    })
    expect(isSessionLive(s, at(2026, 10, 25, 23, 0))).toBe(true)
    expect(isSessionLive(s, at(2026, 10, 26, 0, 30))).toBe(false)
    expect(sessionLifecycle(s, at(2026, 10, 26, 0, 30))).toBe('past')
  })
})
