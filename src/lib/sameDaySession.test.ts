// =====================================================================
// The same-day regression, pinned against the production session that
// exposed it.
//
// WHAT HAPPENED. Session 243aab0d-02a1-4ebe-887f-d2de588fc29e, 2026-08-11
// at 18:00, status upcoming, with no planned activities. The lifecycle
// rule gave it the 90 minute fallback, so at 19:30 it became `past` and
// left every operational surface: no hero, no row in the default Sessions
// list, no offer as the night to organise. The session was not deleted,
// its Spond link was intact and its saved register rows were intact. A
// coach at 22:30 that evening simply could not find it.
//
// The rule was not wrong about the session having ended. It was wrong
// about what ending means for a night the coach is still standing in.
// "Finished" and "yesterday" are two different questions and the model
// only had one answer, so this file pins both of them.
//
// Every test injects `now`, and the suite runs in Europe/London
// (vite.config.ts), so the hours where BST and UTC disagree are actually
// exercised rather than accidentally skipped.
// =====================================================================
import { describe, expect, it } from 'vitest'
import {
  isSessionActive,
  isSessionEndedToday,
  isSessionPast,
  matchesLifecycleScope,
  sessionLifecycle,
} from './sessionLifecycle'
import { pickNextEvent } from './eventFilter'

// The production row, reduced to the fields the lifecycle reads.
const PRODUCTION_SESSION = {
  date: '2026-08-11',
  time: '18:00',
  status: 'upcoming' as const,
  activities: [],
}

// Local wall clock, which is what every one of these rules is stated in.
const at = (y: number, m: number, d: number, hh: number, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)

describe('the 11 August 2026 session, hour by hour', () => {
  it('is active before it starts', () => {
    expect(sessionLifecycle(PRODUCTION_SESSION, at(2026, 8, 11, 17, 30))).toBe('active')
  })

  it('is active while it runs', () => {
    expect(sessionLifecycle(PRODUCTION_SESSION, at(2026, 8, 11, 18, 45))).toBe('active')
  })

  // REQUIREMENT 1. The reported hour.
  it('is still discoverable at 22:30 on the same evening', () => {
    const now = at(2026, 8, 11, 22, 30)
    expect(sessionLifecycle(PRODUCTION_SESSION, now)).toBe('endedToday')
    expect(isSessionPast(PRODUCTION_SESSION, now)).toBe(false)
    // The default view a coach lands on must still hold it.
    expect(matchesLifecycleScope(PRODUCTION_SESSION, 'upcoming', now)).toBe(true)
  })

  it('has ended by 19:31, which is the half of the old rule that was right', () => {
    const now = at(2026, 8, 11, 19, 31)
    expect(isSessionActive(PRODUCTION_SESSION, now)).toBe(false)
    expect(isSessionEndedToday(PRODUCTION_SESSION, now)).toBe(true)
  })

  it('is still discoverable one minute before local midnight', () => {
    const now = at(2026, 8, 11, 23, 59)
    expect(sessionLifecycle(PRODUCTION_SESSION, now)).toBe('endedToday')
    expect(matchesLifecycleScope(PRODUCTION_SESSION, 'upcoming', now)).toBe(true)
  })

  // REQUIREMENT 2. After local midnight it moves, normally.
  it('is past one minute after local midnight', () => {
    const now = at(2026, 8, 12, 0, 1)
    expect(sessionLifecycle(PRODUCTION_SESSION, now)).toBe('past')
    expect(isSessionPast(PRODUCTION_SESSION, now)).toBe(true)
    expect(matchesLifecycleScope(PRODUCTION_SESSION, 'upcoming', now)).toBe(false)
    expect(matchesLifecycleScope(PRODUCTION_SESSION, 'past', now)).toBe(true)
  })

  it('is past at the very first instant of the next day', () => {
    // The boundary itself, not a minute either side of it.
    expect(sessionLifecycle(PRODUCTION_SESSION, at(2026, 8, 12, 0, 0))).toBe('past')
  })

  it('stays past on later days', () => {
    expect(sessionLifecycle(PRODUCTION_SESSION, at(2026, 8, 13, 9, 0))).toBe('past')
    expect(sessionLifecycle(PRODUCTION_SESSION, at(2026, 12, 25, 9, 0))).toBe('past')
  })
})

// REQUIREMENT 3. Discoverable is not the same as next.
describe('an ended session is never the next one', () => {
  const tomorrow = { date: '2026-08-12', time: '18:00', status: 'upcoming' as const, activities: [] }

  it('does not lead a schedule once it has ended, even before midnight', () => {
    const now = at(2026, 8, 11, 22, 30)
    const next = pickNextEvent([PRODUCTION_SESSION, tomorrow], null, undefined, now)
    expect(next).toBe(tomorrow)
  })

  it('leads nothing at all when it is the only session left today', () => {
    // An honest empty "what is next" beats pointing a coach at a night
    // that finished three hours ago.
    expect(pickNextEvent([PRODUCTION_SESSION], null, undefined, at(2026, 8, 11, 22, 30))).toBeUndefined()
  })

  it('still leads the schedule before it ends', () => {
    const now = at(2026, 8, 11, 17, 0)
    expect(pickNextEvent([PRODUCTION_SESSION, tomorrow], null, undefined, now)).toBe(PRODUCTION_SESSION)
  })
})

describe('what the third state must not swallow', () => {
  it('does not resurrect yesterday', () => {
    // The whole point of the original lifecycle work. A session from the
    // previous calendar day is past however recently it ended.
    const lateLastNight = { date: '2026-08-11', time: '23:00', status: 'upcoming' as const, activities: [] }
    // 00:30 on the 12th: it ended half an hour ago, but its day is over.
    expect(sessionLifecycle(lateLastNight, at(2026, 8, 12, 1, 0))).toBe('endedToday')
    // Its expected end (00:30 on the 12th) IS today, so it stays reachable
    // through the day it actually finished on, and no longer.
    expect(sessionLifecycle(lateLastNight, at(2026, 8, 13, 0, 1))).toBe('past')
  })

  it('does not make every historic session active', () => {
    const lastMonth = { date: '2026-07-11', time: '18:00', status: 'upcoming' as const, activities: [] }
    expect(sessionLifecycle(lastMonth, at(2026, 8, 11, 22, 30))).toBe('past')
    expect(isSessionActive(lastMonth, at(2026, 8, 11, 22, 30))).toBe(false)
  })

  it('keeps a live session active however late it runs, on its own day', () => {
    const running = { ...PRODUCTION_SESSION, liveActivityIndex: 2, liveActivityStartedAt: '2026-08-11T21:00:00Z' }
    expect(sessionLifecycle(running, at(2026, 8, 11, 23, 30))).toBe('active')
  })

  it('does not let a marker nobody cleared carry the session into the next day', () => {
    // The other half of the same rule, and the reason the stale live
    // regression existed: "the driver has not pressed End" is not evidence
    // that anybody is driving, because pressing End is the ONLY thing that
    // clears the columns. A driver who closed the tab leaves them set for
    // ever. See isSessionLive in ./sessionLifecycle.
    const running = { ...PRODUCTION_SESSION, liveActivityIndex: 2, liveActivityStartedAt: '2026-08-11T21:00:00Z' }
    expect(sessionLifecycle(running, at(2026, 8, 12, 1, 0))).toBe('past')
  })

  it('keeps a session whose driver is still pressing Next after midnight', () => {
    // The marker is restamped on every activity change, so a coach genuinely
    // running into the small hours has evidence dated today and keeps the
    // session. This is what the calendar day rule buys that a bare column
    // read cannot: it tells the two apart.
    const stillGoing = {
      ...PRODUCTION_SESSION,
      liveActivityIndex: 3,
      liveActivityStartedAt: new Date(2026, 7, 12, 0, 40).toISOString(),
    }
    expect(sessionLifecycle(stillGoing, at(2026, 8, 12, 1, 0))).toBe('active')
  })

  it('treats a session completed today as ended today, not as gone', () => {
    // The live view's End is the one thing that writes `completed`. A coach
    // who ends the session at 19:30 has the same evening's work left.
    const ended = { ...PRODUCTION_SESSION, status: 'completed' as const }
    expect(sessionLifecycle(ended, at(2026, 8, 11, 22, 30))).toBe('endedToday')
    expect(sessionLifecycle(ended, at(2026, 8, 12, 0, 1))).toBe('past')
  })

  it('keeps a completed session dated in the future past until its own day', () => {
    // `completed` is believed, and a row marked finished days before it
    // happens is self-contradictory: the planner allows it because editing
    // a completed session keeps the status. It stays out of the operational
    // view for every day before its own.
    //
    // Sampled ON THE DAY BEFORE and at the boundary, because a rule that
    // read the FUTURE end as "today" took such a row out of Past at
    // midnight and put it in the default list all day. Sampling three weeks
    // early, which is all this test used to do, passes either way.
    const future = { date: '2026-09-01', time: '18:00', status: 'completed' as const, activities: [] }
    for (const now of [at(2026, 8, 11, 22, 30), at(2026, 8, 31, 12, 0), at(2026, 8, 31, 23, 59)]) {
      expect(sessionLifecycle(future, now)).toBe('past')
      expect(matchesLifecycleScope(future, 'upcoming', now)).toBe(false)
    }
  })

  it('lets a session the driver ended EARLY stay reachable for the rest of its own day', () => {
    // The reason the guard above compares CALENDAR DAYS and not instants.
    // A driver presses End at 18:45 on a session planned until 19:15. They
    // still have that evening's work, so it is endedToday from the moment
    // it is completed, not past until 19:15 and then back again.
    const endedEarly = { date: '2026-08-11', time: '18:00', status: 'completed' as const, activities: [{ duration: 75 }] }
    expect(sessionLifecycle(endedEarly, at(2026, 8, 11, 18, 45))).toBe('endedToday')
    expect(sessionLifecycle(endedEarly, at(2026, 8, 11, 19, 30))).toBe('endedToday')
    expect(sessionLifecycle(endedEarly, at(2026, 8, 11, 23, 59))).toBe('endedToday')
    // Never offered as the next session, and past the next day.
    expect(isSessionActive(endedEarly, at(2026, 8, 11, 18, 45))).toBe(false)
    expect(sessionLifecycle(endedEarly, at(2026, 8, 12, 0, 1))).toBe('past')
  })

  it('never returns to an operational list once it has left one', () => {
    // A sweep rather than a sample: for a spread of shapes, walk the clock
    // forward and assert the lifecycle never goes back from past to
    // active. endedToday after past is permitted exactly once, when a
    // session genuinely reaches its own end on its own day.
    const shapes = [
      { date: '2026-08-11', time: '18:00', status: 'upcoming' as const, activities: [] },
      { date: '2026-08-11', time: '23:00', status: 'upcoming' as const, activities: [] },
      { date: '2026-08-11', time: '', status: 'upcoming' as const, activities: [] },
      { date: '2026-09-01', time: '18:00', status: 'completed' as const, activities: [] },
      { date: '2026-08-11', time: '18:00', status: 'completed' as const, activities: [] },
      { date: '2026-03-29', time: '00:30', status: 'upcoming' as const, activities: [] },
      { date: '2026-10-25', time: '01:30', status: 'upcoming' as const, activities: [] },
    ]
    for (const shape of shapes) {
      let sawPast = false
      for (let day = 10; day <= 14; day++) {
        for (let hour = 0; hour < 24; hour++) {
          const state = sessionLifecycle(shape, at(2026, 8, day, hour, 0))
          if (state === 'past') sawPast = true
          else if (sawPast) {
            expect(state, `${JSON.stringify(shape)} went past -> ${state} on Aug ${day} ${hour}:00`).toBe('endedToday')
          }
        }
      }
    }
  })

  it('keeps an unreadable date active rather than hiding it', () => {
    expect(sessionLifecycle({ date: 'not a date' }, at(2026, 8, 11, 22, 30))).toBe('active')
    expect(sessionLifecycle({}, at(2026, 8, 11, 22, 30))).toBe('active')
  })
})

// REQUIREMENT 13. Europe/London midnight and DST.
describe('Europe/London midnight and the clock changes', () => {
  it('runs the tests in the club s own timezone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('Europe/London')
  })

  describe('the spring forward, 29 March 2026 at 01:00 GMT', () => {
    // 00:59:59 GMT is followed by 02:00:00 BST. There is no 01:30 that day.
    it('a session the evening before is past once the short night is over', () => {
      const saturday = { date: '2026-03-28', time: '18:00', status: 'upcoming' as const, activities: [] }
      expect(sessionLifecycle(saturday, at(2026, 3, 28, 23, 30))).toBe('endedToday')
      // 03:00 BST on the 29th is a real instant; the 28th is over.
      expect(sessionLifecycle(saturday, at(2026, 3, 29, 3, 0))).toBe('past')
    })

    it('a session on the morning of the change keeps its full local day', () => {
      const sunday = { date: '2026-03-29', time: '10:00', status: 'upcoming' as const, activities: [] }
      // The day is 23 hours long. It must still be "today" at 23:00.
      expect(sessionLifecycle(sunday, at(2026, 3, 29, 23, 0))).toBe('endedToday')
      expect(sessionLifecycle(sunday, at(2026, 3, 30, 0, 30))).toBe('past')
    })

    it('does not lose or gain an hour of session length across the change', () => {
      // Starts 00:30 GMT, planned 90 minutes. Real minutes off the start
      // instant, so it ends at 03:00 BST, not 02:00.
      const overnight = { date: '2026-03-29', time: '00:30', status: 'upcoming' as const, activities: [] }
      expect(sessionLifecycle(overnight, at(2026, 3, 29, 2, 30))).toBe('active')
      expect(sessionLifecycle(overnight, at(2026, 3, 29, 3, 1))).toBe('endedToday')
    })
  })

  describe('the fall back, 25 October 2026 at 02:00 BST', () => {
    // 01:59:59 BST is followed by 01:00:00 GMT. 01:30 happens twice.
    it('a session the evening before is past once the long night is over', () => {
      const saturday = { date: '2026-10-24', time: '18:00', status: 'upcoming' as const, activities: [] }
      expect(sessionLifecycle(saturday, at(2026, 10, 24, 23, 30))).toBe('endedToday')
      expect(sessionLifecycle(saturday, at(2026, 10, 25, 3, 0))).toBe('past')
    })

    it('a session on the day of the change keeps its full 25 hour local day', () => {
      const sunday = { date: '2026-10-25', time: '10:00', status: 'upcoming' as const, activities: [] }
      expect(sessionLifecycle(sunday, at(2026, 10, 25, 23, 59))).toBe('endedToday')
      expect(sessionLifecycle(sunday, at(2026, 10, 26, 0, 1))).toBe('past')
    })

    it('a session with a date but no time runs to the end of the long day', () => {
      const allDay = { date: '2026-10-25', status: 'upcoming' as const, activities: [] }
      // Still active at 23:59 because nothing said when it began.
      expect(sessionLifecycle(allDay, at(2026, 10, 25, 23, 59))).toBe('active')
      expect(sessionLifecycle(allDay, at(2026, 10, 26, 0, 1))).toBe('past')
    })
  })

  it('reads a British Summer Time evening as local, never as UTC', () => {
    // 18:00 BST is 17:00Z. A rule that parsed '2026-08-11T18:00' as UTC
    // would call this session over an hour before it was.
    const now = at(2026, 8, 11, 18, 30)
    expect(now.toISOString()).toBe('2026-08-11T17:30:00.000Z')
    expect(sessionLifecycle(PRODUCTION_SESSION, now)).toBe('active')
  })

  it('reads a Greenwich Mean Time evening the same way', () => {
    const winter = { date: '2026-01-14', time: '18:00', status: 'upcoming' as const, activities: [] }
    expect(sessionLifecycle(winter, at(2026, 1, 14, 18, 30))).toBe('active')
    expect(sessionLifecycle(winter, at(2026, 1, 14, 22, 30))).toBe('endedToday')
    expect(sessionLifecycle(winter, at(2026, 1, 15, 0, 1))).toBe('past')
  })
})

describe('a synced Spond event, which carries an absolute instant', () => {
  // 18:00 BST on 11 August 2026.
  const spondEvent = { startsAt: '2026-08-11T17:00:00.000Z' }

  it('follows exactly the same rule as a session', () => {
    expect(sessionLifecycle(spondEvent, at(2026, 8, 11, 18, 30))).toBe('active')
    expect(sessionLifecycle(spondEvent, at(2026, 8, 11, 22, 30))).toBe('endedToday')
    expect(sessionLifecycle(spondEvent, at(2026, 8, 12, 0, 1))).toBe('past')
  })
})
