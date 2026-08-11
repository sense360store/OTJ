import { describe, expect, it } from 'vitest'
import type { Session } from './data'
import { buildSessionIcs } from './ics'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    name: 'Monday training',
    date: '2026-06-10',
    time: '17:30',
    ageGroup: 'U10',
    venue: 'Ainley Top',
    focus: 'Passing',
    status: 'upcoming',
    activities: [],
    coachId: 'coach1',
    teamId: null,
    intentions: [],
    space: '',
    sourceUrl: '',
    sourceLabel: '',
    programmeId: null,
    programmeWeek: null,
    liveActivityIndex: null,
    liveActivityStartedAt: null,
    spondEventId: null,
    boardId: null,
  venueId: null,
  teamIds: [],
    rights: 'internal_only',
    ...overrides,
  }
}

describe('buildSessionIcs', () => {
  // DTSTART is a floating local time built from the date and time. Parsing and
  // formatting both use the same local clock, so the result is the same wall
  // time regardless of the runner's timezone.
  it('writes DTSTART from the session date and time', () => {
    expect(buildSessionIcs(session())).toContain('DTSTART:20260610T173000')
  })

  it('books the session for as long as the rest of the product thinks it runs', () => {
    // Start and length both come from ./sessionLifecycle now. This file used
    // to fall back to 60 minutes for a session with no activities while the
    // app treated the same session as running for 90, so a coach's calendar
    // and their schedule disagreed about the same night.
    expect(buildSessionIcs(session())).toContain('DTEND:20260610T190000')
    expect(
      buildSessionIcs(
        session({
          activities: [
            { phase: 'Warm-Up', duration: 20 },
            { phase: 'Game', duration: 25 },
          ],
        }),
      ),
    ).toContain('DTEND:20260610T181500')
  })

  it('exports nothing rather than a midnight entry when the time cannot be read', () => {
    // An entry has to say when it begins. A session with a day and no
    // readable time is still a session, and the lifecycle keeps it active
    // all day, but there is no honest calendar event to build from it.
    expect(buildSessionIcs(session({ time: '' }))).toBeNull()
    expect(buildSessionIcs(session({ time: 'half six' }))).toBeNull()
    expect(buildSessionIcs(session({ date: '' }))).toBeNull()
  })

  it('writes the venue as LOCATION', () => {
    expect(buildSessionIcs(session({ venue: 'Ainley Top' }))).toContain('LOCATION:Ainley Top')
  })

  it('prefers the resolved venue over the frozen free text label', () => {
    expect(buildSessionIcs(session({ venue: 'Ainley Top' }), 'Springmill 3G')).toContain('LOCATION:Springmill 3G')
  })

  it('falls back to the frozen label for a session saved before venues existed', () => {
    expect(buildSessionIcs(session({ venue: 'Ainley Top' }), null)).toContain('LOCATION:Ainley Top')
  })

  it('writes no LOCATION when neither is set', () => {
    expect(buildSessionIcs(session({ venue: '' }), null)).not.toContain('LOCATION')
  })

  it('escapes commas and semicolons in the summary', () => {
    expect(buildSessionIcs(session({ name: 'U10, Reds; finishing' }))).toContain(
      'SUMMARY:U10\\, Reds\\; finishing',
    )
  })

  it('returns null when the session has no date or time', () => {
    expect(buildSessionIcs(session({ date: '' }))).toBeNull()
    expect(buildSessionIcs(session({ time: '' }))).toBeNull()
  })
})
