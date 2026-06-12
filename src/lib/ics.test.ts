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

  it('writes the venue as LOCATION', () => {
    expect(buildSessionIcs(session({ venue: 'Ainley Top' }))).toContain('LOCATION:Ainley Top')
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
