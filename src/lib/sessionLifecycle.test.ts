// The session lifecycle seam, pinned. Written before the module.
//
// The rule under test: a session stops being operational work when it has
// finished, and "finished" is derived, never trusted to a stored flag that
// nobody updates. Every assertion below builds its own "now" out of local
// wall clock parts, so the suite says the same thing on a laptop in
// Ossett, on a CI box in UTC and on a machine in Auckland.
//
// Nothing here reads the real clock. A test that did would pass today and
// fail on the night the fixture date went past, which is the exact class
// of bug this module exists to remove.
import { afterAll, describe, expect, it } from 'vitest'
import {
  DEFAULT_LIFECYCLE_SCOPE,
  FALLBACK_SESSION_MINUTES,
  isSessionActive,
  isSessionLive,
  isSessionPast,
  LIFECYCLE_SCOPE_LABELS,
  matchesLifecycleScope,
  plannedMinutes,
  sessionExpectedEnd,
  sessionLifecycle,
  sessionStart,
  type TimedEvent,
} from './sessionLifecycle'

// A local wall clock instant, built from parts. This is the whole point:
// "18:00" means six in the evening where the coach is standing, and a test
// that wrote '2026-08-11T18:00:00Z' would be asserting about UTC instead.
function at(y: number, m: number, d: number, hh = 0, mm = 0): Date {
  return new Date(y, m - 1, d, hh, mm, 0, 0)
}

const activities = (...durations: number[]) => durations.map((duration) => ({ duration }))

// A planned training night: a date, a start time and a plan that adds up.
const training = (over: Partial<TimedEvent> = {}): TimedEvent => ({
  date: '2026-08-11',
  time: '18:00',
  status: 'upcoming',
  activities: activities(15, 30, 20, 10),
  liveActivityIndex: null,
  liveActivityStartedAt: null,
  ...over,
})

// 18:00 + 75 planned minutes.
const ENDS = at(2026, 8, 11, 19, 15)

describe('the planned duration', () => {
  it('is the sum of the activity durations, the same figure the planner shows', () => {
    expect(plannedMinutes(training())).toBe(75)
  })

  it('falls back to one documented duration when the session has no plan yet', () => {
    // 7. A session with nothing in it is the commonest real case: a coach
    // creates the night from Spond and builds the drills later. Deriving
    // zero minutes would end it at its own start time.
    expect(FALLBACK_SESSION_MINUTES).toBe(90)
    expect(plannedMinutes(training({ activities: [] }))).toBe(FALLBACK_SESSION_MINUTES)
    expect(plannedMinutes(training({ activities: null }))).toBe(FALLBACK_SESSION_MINUTES)
    expect(plannedMinutes(training({ activities: undefined }))).toBe(FALLBACK_SESSION_MINUTES)
  })

  it('falls back when the activities carry no usable minutes between them', () => {
    // Zero is not a duration a coach chose, it is a plan nobody filled in.
    expect(plannedMinutes(training({ activities: activities(0, 0) }))).toBe(FALLBACK_SESSION_MINUTES)
  })
})

describe('when a session ends', () => {
  it('ends its planned minutes after it starts', () => {
    expect(sessionStart(training())?.getTime()).toBe(at(2026, 8, 11, 18, 0).getTime())
    expect(sessionExpectedEnd(training())?.getTime()).toBe(ENDS.getTime())
  })

  it('ends the fallback duration after it starts when there is no plan', () => {
    expect(sessionExpectedEnd(training({ activities: [] }))?.getTime()).toBe(at(2026, 8, 11, 19, 30).getTime())
  })

  it('runs to the end of its day when it has a date but no time', () => {
    // Nothing says when it started, so nothing may claim it has finished
    // until the day it was planned for is over.
    const allDay = training({ time: '', activities: [] })
    expect(sessionExpectedEnd(allDay)?.getTime()).toBe(at(2026, 8, 12, 0, 0).getTime() - 1)
    expect(isSessionActive(allDay, at(2026, 8, 11, 23, 59))).toBe(true)
    expect(isSessionPast(allDay, at(2026, 8, 12, 0, 1))).toBe(true)
  })

  it('never ends at all when it has no date to end from', () => {
    // A row with no date cannot be timed out. Showing an undated session is
    // a glance; hiding one is losing it.
    expect(sessionExpectedEnd(training({ date: '' }))).toBeNull()
    expect(sessionExpectedEnd(training({ date: null }))).toBeNull()
    expect(isSessionActive(training({ date: '' }), at(2030, 1, 1))).toBe(true)
  })

  it('treats an unreadable date or time as no start rather than as 1970', () => {
    expect(sessionStart(training({ date: 'not a date' }))).toBeNull()
    expect(isSessionActive(training({ date: 'not a date' }), at(2030, 1, 1))).toBe(true)
    // A broken time still leaves a usable day, so the session runs to the
    // end of it rather than losing its date as well.
    expect(sessionExpectedEnd(training({ time: 'half six', activities: [] }))?.getTime()).toBe(
      at(2026, 8, 12, 0, 0).getTime() - 1,
    )
  })
})

describe('active and past', () => {
  it('1. a session later this week is active', () => {
    expect(sessionLifecycle(training(), at(2026, 8, 9, 12, 0))).toBe('active')
    expect(isSessionActive(training(), at(2026, 8, 9, 12, 0))).toBe(true)
  })

  it('2. a session inside its planned duration is active', () => {
    expect(isSessionActive(training(), at(2026, 8, 11, 18, 30))).toBe(true)
    expect(isSessionActive(training(), at(2026, 8, 11, 19, 14))).toBe(true)
  })

  it('3. a session that started five minutes ago is not hidden', () => {
    // The failure this whole module exists to stop: a coach opens the app
    // at 18:05 with a bag of cones in one hand and finds tonight gone.
    expect(isSessionActive(training(), at(2026, 8, 11, 18, 5))).toBe(true)
    expect(isSessionPast(training(), at(2026, 8, 11, 18, 5))).toBe(false)
  })

  it('4. a session past its expected end has ended, and is past on a later day', () => {
    // The end of the session and the end of the day are two different
    // moments, and this test used to conflate them. Ending is what stops it
    // being "next"; the day turning over is what files it under Past.
    expect(sessionLifecycle(training(), at(2026, 8, 11, 19, 16))).toBe('endedToday')
    expect(isSessionActive(training(), at(2026, 8, 11, 20, 0))).toBe(false)
    expect(isSessionPast(training(), at(2026, 8, 11, 20, 0))).toBe(false)
    expect(isSessionPast(training(), at(2026, 8, 12, 9, 0))).toBe(true)
  })

  it('is still active exactly on its expected end, and ended one millisecond later', () => {
    // The boundary belongs to the session. A coach standing on the pitch at
    // the final whistle has not finished putting the cones away.
    expect(isSessionActive(training(), ENDS)).toBe(true)
    expect(isSessionActive(training(), new Date(ENDS.getTime() + 1))).toBe(false)
    expect(sessionLifecycle(training(), new Date(ENDS.getTime() + 1))).toBe('endedToday')
  })

  it('5. a completed session is past even when its date is in the future', () => {
    // The stored status is authoritative in one direction only: it can say
    // finished, and it is believed. It can also say upcoming forever, which
    // is why nothing above asks it.
    const done = training({ date: '2030-01-01', status: 'completed' })
    expect(sessionLifecycle(done, at(2026, 8, 11, 12, 0))).toBe('past')
  })

  it('6. a session being driven live is active past its expected end', () => {
    // A coach running long is still running the session, so a CURRENT live
    // marker holds the session open however far past its planned end the
    // clock has gone.
    const live = training({ liveActivityIndex: 2, liveActivityStartedAt: '2026-08-11T18:40:00Z' })
    expect(isSessionLive(live, at(2026, 8, 11, 21, 0))).toBe(true)
    expect(isSessionActive(live, at(2026, 8, 11, 21, 0))).toBe(true)
  })

  it('6b. a live marker nobody cleared does not hold the session open for ever', () => {
    // THE STALE LIVE REGRESSION. Pressing End is the only thing that clears
    // live_activity_index, so a driver who closed the tab in June left the
    // column set. Read as a bare column that says "this session is running",
    // which put 16 June under Upcoming on 12 August. Read as evidence with a
    // date on it, it says nothing at all, and the clock answers instead.
    const live = training({ liveActivityIndex: 2, liveActivityStartedAt: '2026-08-11T18:40:00Z' })
    expect(isSessionLive(live, at(2026, 8, 12, 9, 0))).toBe(false)
    expect(isSessionActive(live, at(2026, 8, 12, 9, 0))).toBe(false)
    expect(sessionLifecycle(live, at(2026, 8, 12, 9, 0))).toBe('past')
  })

  it('lets a completed status end a session the live columns never cleared', () => {
    // Precedence, unchanged and deliberately so: completed is still read
    // first, so a row that somehow carries both cannot be stuck active for
    // ever. What changed is only how far "completed" reaches. It now means
    // "has ended", and the local day decides whether that is endedToday or
    // past, so a session ended at 19:30 is still reachable that evening.
    const both = training({ status: 'completed', liveActivityIndex: 0, liveActivityStartedAt: '2026-08-11T18:00:00Z' })
    expect(sessionLifecycle(both, at(2026, 8, 11, 18, 10))).toBe('endedToday')
    expect(isSessionActive(both, at(2026, 8, 11, 18, 10))).toBe(false)
    // And on any later day it is past, live columns or not.
    expect(sessionLifecycle(both, at(2026, 8, 12, 9, 0))).toBe('past')
  })

  it('reads a Spond event by its own start instant', () => {
    // Two shapes, one rule, the same way the training classifier reads a
    // session's name and an event's title. A synced event carries an
    // absolute instant and no plan, so it gets the fallback duration.
    const startsAt = at(2026, 8, 11, 18, 0).toISOString()
    expect(isSessionActive({ startsAt }, at(2026, 8, 11, 19, 29))).toBe(true)
    expect(isSessionActive({ startsAt }, at(2026, 8, 11, 19, 31))).toBe(false)
    expect(isSessionPast({ startsAt }, at(2026, 8, 12, 9, 0))).toBe(true)
  })
})

describe('8. the clock is local, and the same in every timezone', () => {
  // Football is arranged in local wall clock time. Parsing "18:00" as UTC
  // moves a Yorkshire training night by an hour in summer, and by half a
  // day for anyone testing from the other side of the world.
  const original = process.env.TZ
  afterAll(() => {
    process.env.TZ = original
  })

  // Node re-reads process.env.TZ when it changes (v16 plus). Where a
  // runner ignores it, every assertion below still holds, because each one
  // compares against a date built from local parts in the same timezone.
  for (const tz of ['UTC', 'Europe/London', 'Pacific/Auckland', 'America/Los_Angeles']) {
    it(`reads 18:00 as six in the evening in ${tz}`, () => {
      process.env.TZ = tz
      const s = training()
      expect(sessionStart(s)?.getHours()).toBe(18)
      expect(sessionStart(s)?.getMinutes()).toBe(0)
      expect(isSessionActive(s, at(2026, 8, 11, 19, 14))).toBe(true)
      expect(isSessionActive(s, at(2026, 8, 11, 19, 16))).toBe(false)
      // Past is the NEXT local day, in whichever zone the runner is in.
      expect(isSessionPast(s, at(2026, 8, 12, 9, 0))).toBe(true)
    })
  }

  it('measures the planned duration in real minutes, so a clock change cannot shorten a session', () => {
    // The UK springs forward at 01:00 on 29 March 2026. A session timed by
    // adding 90 to the minute field would end at a wall clock time that
    // does not exist that night and lose half its length; adding ninety
    // real minutes to the start instant cannot.
    process.env.TZ = 'Europe/London'
    const late = training({ date: '2026-03-29', time: '00:30', activities: [] })
    const start = sessionStart(late)
    const end = sessionExpectedEnd(late)
    expect(end!.getTime() - start!.getTime()).toBe(FALLBACK_SESSION_MINUTES * 60_000)
  })
})

describe('9. a session that runs past midnight', () => {
  it('stays active into the small hours and ends when it actually ends', () => {
    const lateNight = training({ time: '23:00', activities: activities(45, 45) })
    expect(sessionExpectedEnd(lateNight)?.getTime()).toBe(at(2026, 8, 12, 0, 30).getTime())
    expect(isSessionActive(lateNight, at(2026, 8, 11, 23, 59))).toBe(true)
    expect(isSessionActive(lateNight, at(2026, 8, 12, 0, 15))).toBe(true)
    expect(isSessionActive(lateNight, at(2026, 8, 12, 0, 31))).toBe(false)
    // It ended at 00:30 on the 12th, so the 12th is the day it finished on
    // and it stays reachable through it. Past on the 13th.
    expect(sessionLifecycle(lateNight, at(2026, 8, 12, 0, 31))).toBe('endedToday')
    expect(isSessionPast(lateNight, at(2026, 8, 13, 0, 1))).toBe(true)
  })

  it('does not treat a new calendar day as the end of yesterday evening', () => {
    // The old rule compared date strings, so every session became past the
    // instant the date rolled over, whatever time it had been running.
    const lateNight = training({ time: '23:30', activities: activities(60) })
    expect(isSessionActive(lateNight, at(2026, 8, 12, 0, 0))).toBe(true)
  })
})

describe('the Upcoming and Past scopes', () => {
  it('default to Upcoming, which is the operational view', () => {
    expect(DEFAULT_LIFECYCLE_SCOPE).toBe('upcoming')
    expect(LIFECYCLE_SCOPE_LABELS).toEqual({ upcoming: 'Upcoming', past: 'Past' })
  })

  it('split the same rule two ways, with nothing falling between them', () => {
    // Three lifecycle states, still two scopes, and every state belongs to
    // exactly one of them: endedToday sits with Upcoming, because the
    // default view is the operational one and tonight is operational until
    // the day turns over.
    const during = at(2026, 8, 11, 18, 30)
    const laterThatEvening = at(2026, 8, 11, 20, 0)
    const nextMorning = at(2026, 8, 12, 9, 0)
    for (const now of [during, laterThatEvening, nextMorning]) {
      const inUpcoming = matchesLifecycleScope(training(), 'upcoming', now)
      const inPast = matchesLifecycleScope(training(), 'past', now)
      expect(inUpcoming).toBe(!inPast)
    }
    expect(matchesLifecycleScope(training(), 'upcoming', during)).toBe(true)
    expect(matchesLifecycleScope(training(), 'upcoming', laterThatEvening)).toBe(true)
    expect(matchesLifecycleScope(training(), 'upcoming', nextMorning)).toBe(false)
    expect(matchesLifecycleScope(training(), 'past', nextMorning)).toBe(true)
  })
})

describe('17 and 18. deriving the answer, every time, and writing nothing', () => {
  it('leaves the session it was asked about exactly as it found it', () => {
    // Nothing here reconciles a stale status, because reconciling one
    // would be a write, and a page render is not an instruction to change
    // a record.
    const s = training()
    const before = JSON.stringify(s)
    sessionLifecycle(s, at(2026, 8, 11, 20, 0))
    isSessionPast(s, at(2026, 8, 11, 20, 0))
    expect(JSON.stringify(s)).toBe(before)
    expect(s.status).toBe('upcoming')
  })

  it('gives the same answer to a screen mounted again after the session ended', () => {
    // A remount recomputes from the clock. The row is untouched and still
    // says upcoming; the derived answer is past both times it is asked.
    const s = training()
    expect(sessionLifecycle(s, at(2026, 8, 11, 18, 30))).toBe('active')
    expect(sessionLifecycle(s, at(2026, 8, 11, 20, 0))).toBe('endedToday')
    expect(sessionLifecycle(s, at(2026, 8, 12, 9, 0))).toBe('past')
    expect(s.status).toBe('upcoming')
  })
})
