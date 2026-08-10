import { describe, expect, it } from 'vitest'
import {
  bySpondEventCloseness,
  isTrainingEvent,
  mappingForTeam,
  parseSpondMappingInput,
  sessionFromSpondEvent,
  spondEventInTeam,
  spondEventLocalDateTime,
  spondPlanSuggestions,
  spondTeamLabel,
  syncedAgo,
} from './spond'
import { isTrainingEvent as canonicalIsTrainingEvent } from './eventKind'
import type { SpondEvent, SpondMapping } from './data'

// A synced event fixture: counts and event facts only, the shape the
// spond_events read returns. Overrides set the fields a case turns on.
function ev(over: Partial<SpondEvent> & Pick<SpondEvent, 'id' | 'startsAt'>): SpondEvent {
  return {
    title: 'Training',
    teamId: null,
    teamName: null,
    spondType: null,
    accepted: 0,
    declined: 0,
    unanswered: 0,
    waiting: 0,
    cancelled: false,
    syncedAt: '2026-06-13T12:00:00Z',
    ...over,
  }
}

// Real Spond ids are 32 character uppercase hex strings.
const GROUP = 'A1B2C3D4E5F60718293A4B5C6D7E8F90'
const SUB = '0F1E2D3C4B5A69788796A5B4C3D2E1F0'

describe('parseSpondMappingInput', () => {
  it('extracts group and subgroup from a full client URL with -S-', () => {
    expect(parseSpondMappingInput(`https://spond.com/client/groups/${GROUP}-S-${SUB}`)).toEqual({
      groupId: GROUP,
      subgroupId: SUB,
    })
  })

  it('extracts a whole group mapping from a full client URL without -S-', () => {
    expect(parseSpondMappingInput(`https://spond.com/client/groups/${GROUP}`)).toEqual({
      groupId: GROUP,
      subgroupId: null,
    })
  })

  it('accepts a raw group id', () => {
    expect(parseSpondMappingInput(GROUP)).toEqual({ groupId: GROUP, subgroupId: null })
  })

  it('accepts a raw group-S-subgroup pair', () => {
    expect(parseSpondMappingInput(`${GROUP}-S-${SUB}`)).toEqual({ groupId: GROUP, subgroupId: SUB })
  })

  it('rejects garbage input', () => {
    expect(parseSpondMappingInput('')).toBeNull()
    expect(parseSpondMappingInput('not a spond id')).toBeNull()
    expect(parseSpondMappingInput('DEADBEEF')).toBeNull() // hex, but far too short
    expect(parseSpondMappingInput(`${GROUP}-S-`)).toBeNull()
    expect(parseSpondMappingInput(`${GROUP}-S-${SUB}-S-${SUB}`)).toBeNull()
    expect(parseSpondMappingInput(`https://example.com/client/groups/${GROUP}`)).toBeNull()
    expect(parseSpondMappingInput('https://spond.com/client/groups/')).toBeNull()
    expect(parseSpondMappingInput(`https://spond.com/landing/${GROUP}`)).toBeNull()
  })

  it('normalises case and whitespace, and ignores a URL path after the id', () => {
    expect(parseSpondMappingInput(`  ${GROUP.toLowerCase()}  `)).toEqual({ groupId: GROUP, subgroupId: null })
    expect(parseSpondMappingInput(`https://www.spond.com/client/groups/${GROUP}-S-${SUB}/overview?x=1`)).toEqual({
      groupId: GROUP,
      subgroupId: SUB,
    })
  })
})

describe('bySpondEventCloseness', () => {
  const events = [
    { startsAt: '2026-06-01T17:30:00Z' },
    { startsAt: '2026-06-16T17:30:00Z' },
    { startsAt: '2026-07-20T10:00:00Z' },
  ]

  it('orders events nearest to the session date first', () => {
    const sorted = [...events].sort(bySpondEventCloseness('2026-06-15', '17:30'))
    expect(sorted.map((e) => e.startsAt)).toEqual([
      '2026-06-16T17:30:00Z',
      '2026-06-01T17:30:00Z',
      '2026-07-20T10:00:00Z',
    ])
  })

  it('falls back to start order when the session has no date', () => {
    const sorted = [...events].sort(bySpondEventCloseness('', ''))
    expect(sorted.map((e) => e.startsAt)).toEqual([
      '2026-06-01T17:30:00Z',
      '2026-06-16T17:30:00Z',
      '2026-07-20T10:00:00Z',
    ])
  })
})

describe('spondTeamLabel', () => {
  it('labels a club event, one with no team, as All teams', () => {
    expect(spondTeamLabel(null)).toBe('All teams')
  })

  it('labels a team event with its team name', () => {
    expect(spondTeamLabel('Titans')).toBe('Titans')
  })
})

describe('spondEventInTeam', () => {
  it('keeps a team event under its own team filter only', () => {
    expect(spondEventInTeam({ teamId: 'team-1' }, 'team-1')).toBe(true)
    expect(spondEventInTeam({ teamId: 'team-1' }, 'team-2')).toBe(false)
  })

  it('shows a club event under every team filter', () => {
    expect(spondEventInTeam({ teamId: null }, 'team-1')).toBe(true)
    expect(spondEventInTeam({ teamId: null }, 'team-2')).toBe(true)
  })
})

describe('isTrainingEvent, re-exported from the canonical classifier', () => {
  // The signature is now an event, not a bare title, because Spond's own
  // spond_type is a stronger fact than the title and the classifier must be
  // able to read it. The rules themselves are pinned in eventKind.test.ts.
  it('matches training titles, case insensitive', () => {
    expect(isTrainingEvent({ title: 'U8 Training' })).toBe(true)
    expect(isTrainingEvent({ title: 'Monday training night' })).toBe(true)
    expect(isTrainingEvent({ title: 'TRAINING' })).toBe(true)
  })

  it('keeps fixtures and galas out', () => {
    expect(isTrainingEvent({ title: 'Friendly vs Horbury' })).toBe(false)
    expect(isTrainingEvent({ title: 'End of season tournament' })).toBe(false)
  })

  it('lets Spond overrule a misleading title', () => {
    expect(isTrainingEvent({ title: 'Titans training', spondType: 'MATCH' })).toBe(false)
  })

  it('is the very same function, not a second one that agrees today', () => {
    // Identity, not behaviour. A shim that merely behaved the same would be
    // exactly the duplicate classifier this whole arrangement forbids.
    expect(isTrainingEvent).toBe(canonicalIsTrainingEvent)
  })
})

describe('spondEventLocalDateTime', () => {
  it('splits a local timestamp into the session date and time', () => {
    // A timestamp with no zone is read as local, so the wall clock round trips
    // in any timezone the test runs under.
    expect(spondEventLocalDateTime('2026-06-16T17:30:00')).toEqual({ date: '2026-06-16', time: '17:30' })
  })

  it('returns blanks for an unreadable timestamp', () => {
    expect(spondEventLocalDateTime('not a time')).toEqual({ date: '', time: '' })
  })
})

describe('spondPlanSuggestions', () => {
  const now = new Date('2026-06-13T12:00:00Z')
  const opts = {
    plannedEventIds: new Set<string>(),
    scopeTeamIds: ['team-1'],
    showAllTeams: false,
    kind: 'all' as const,
    now,
  }

  it("shows the coach's team events and club events, not other teams'", () => {
    const events = [
      ev({ id: 'mine', startsAt: '2026-06-16T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'club', startsAt: '2026-06-17T17:30:00Z', teamId: null }),
      ev({ id: 'other', startsAt: '2026-06-18T17:30:00Z', teamId: 'team-2' }),
    ]
    expect(spondPlanSuggestions({ ...opts, events }).map((e) => e.id)).toEqual(['mine', 'club'])
  })

  it('widens to every team when the all teams toggle is on', () => {
    const events = [
      ev({ id: 'mine', startsAt: '2026-06-16T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'other', startsAt: '2026-06-18T17:30:00Z', teamId: 'team-2' }),
    ]
    expect(spondPlanSuggestions({ ...opts, events, showAllTeams: true }).map((e) => e.id)).toEqual(['mine', 'other'])
  })

  it('suggests training by default, and widens to every in scope event when asked', () => {
    // The Training-first correction. This used to be the other way round:
    // the surface opened on every synced event and a coach had to find a
    // Training only toggle, so the gala and the presentation evening sat in
    // the way of the night they came to plan.
    const events = [
      ev({ id: 'train', startsAt: '2026-06-16T17:30:00Z', teamId: 'team-1', title: 'U8 Training' }),
      ev({ id: 'match', startsAt: '2026-06-17T17:30:00Z', teamId: 'team-1', title: 'Friendly vs Horbury' }),
    ]
    const noKind = { ...opts, events }
    delete (noKind as { kind?: unknown }).kind
    expect(spondPlanSuggestions(noKind).map((e) => e.id)).toEqual(['train'])
    expect(spondPlanSuggestions({ ...opts, events, kind: 'training' }).map((e) => e.id)).toEqual(['train'])
    expect(spondPlanSuggestions({ ...opts, events, kind: 'all' }).map((e) => e.id)).toEqual(['train', 'match'])
  })

  it("drops an event the coach has already planned, and keeps the rest", () => {
    const events = [
      ev({ id: 'planned', startsAt: '2026-06-16T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'open', startsAt: '2026-06-17T17:30:00Z', teamId: 'team-1' }),
    ]
    const out = spondPlanSuggestions({ ...opts, events, plannedEventIds: new Set(['planned']) })
    expect(out.map((e) => e.id)).toEqual(['open'])
  })

  it('orders upcoming soonest first, then recent past most recent first', () => {
    const events = [
      ev({ id: 'past-old', startsAt: '2026-06-06T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'soon', startsAt: '2026-06-14T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'later', startsAt: '2026-06-20T17:30:00Z', teamId: 'team-1' }),
      ev({ id: 'past-recent', startsAt: '2026-06-10T17:30:00Z', teamId: 'team-1' }),
    ]
    expect(spondPlanSuggestions({ ...opts, events }).map((e) => e.id)).toEqual([
      'soon',
      'later',
      'past-recent',
      'past-old',
    ])
  })
})

describe('sessionFromSpondEvent', () => {
  it("carries the event's date, time, team and link, owned by the coach", () => {
    const event = ev({ id: 'e1', startsAt: '2026-06-16T17:30:00', teamId: 'team-1', title: 'U8 Training' })
    const s = sessionFromSpondEvent(event, 'coach-1', 'default-team')
    expect(s.coachId).toBe('coach-1')
    expect(s.teamId).toBe('team-1')
    expect(s.spondEventId).toBe('e1')
    expect(s.name).toBe('U8 Training')
    expect(s.date).toBe('2026-06-16')
    expect(s.time).toBe('17:30')
    // Nothing is auto added; the coach builds the drills in the planner.
    expect(s.activities).toEqual([])
  })

  it("falls back to the coach's default team for a club event with no team", () => {
    const event = ev({ id: 'e2', startsAt: '2026-06-16T17:30:00', teamId: null })
    expect(sessionFromSpondEvent(event, 'coach-1', 'default-team').teamId).toBe('default-team')
  })

  it("covers the event's team, and never lands unset", () => {
    // A session planned from Spond is SAVED before the coach sees it, so
    // leaving coverage unset would hand them a register listing nobody.
    const teamed = ev({ id: 'e3', startsAt: '2026-06-16T17:30:00', teamId: 'team-1' })
    expect(sessionFromSpondEvent(teamed, 'coach-1', null, ['t1', 't2']).teamIds).toEqual(['team-1'])

    const club = ev({ id: 'e4', startsAt: '2026-06-16T17:30:00', teamId: null })
    expect(sessionFromSpondEvent(club, 'coach-1', null, ['t1', 't2']).teamIds).toEqual(['t1', 't2'])
    expect(sessionFromSpondEvent(club, 'coach-1', 'default-team', ['t1', 't2']).teamIds).toEqual(['default-team'])
  })
})

// ---- The hotfix, from the coach's side -------------------------------------
//
// A training event that Spond had queued the invitations for was never
// synced, so it never reached this screen. Once the sync includes it, it
// must behave like any other event: it appears as a suggestion with no
// replies yet, and NOTHING is created until the coach presses Plan this.

describe('a scheduled training event, once synced', () => {
  const now = new Date('2026-06-13T12:00:00Z')
  const opts = {
    plannedEventIds: new Set<string>(),
    scopeTeamIds: ['team-1'],
    showAllTeams: false,
    kind: 'all' as const,
    now,
  }
  // No replies yet: exactly what the sync stores for an event whose
  // invitations Spond has not sent.
  const scheduledTraining = ev({
    id: 'scheduled-training',
    startsAt: '2026-06-19T17:30:00Z',
    teamId: 'team-1',
    title: 'Titans training',
    accepted: 0,
    declined: 0,
    unanswered: 0,
    waiting: 0,
  })

  it('appears in Plan from Spond alongside the fixtures that already worked', () => {
    const events = [ev({ id: 'gala', startsAt: '2026-06-20T09:00:00Z', teamId: 'team-1', title: 'Summer gala' }), scheduledTraining]
    expect(spondPlanSuggestions({ ...opts, events }).map((e) => e.id)).toEqual(['scheduled-training', 'gala'])
  })

  it('survives the Training filter, which is now the view a coach lands on', () => {
    const events = [ev({ id: 'gala', startsAt: '2026-06-20T09:00:00Z', teamId: 'team-1', title: 'Summer gala' }), scheduledTraining]
    expect(spondPlanSuggestions({ ...opts, events, kind: 'training' }).map((e) => e.id)).toEqual([
      'scheduled-training',
    ])
    expect(isTrainingEvent({ title: 'Titans training' })).toBe(true)
  })

  it('zero replies do not hide it: no reply is a normal state, not an absent event', () => {
    expect(spondPlanSuggestions({ ...opts, events: [scheduledTraining] }).map((e) => e.id)).toEqual([
      'scheduled-training',
    ])
  })

  it('a suggestion is only ever a suggestion: nothing is created by listing it', () => {
    // spondPlanSuggestions returns the events themselves, unchanged. It
    // builds no session, mutates nothing, and cannot: Plan this is the only
    // path to a session and it goes through sessionFromSpondEvent.
    const before = JSON.stringify(scheduledTraining)
    const out = spondPlanSuggestions({ ...opts, events: [scheduledTraining] })
    expect(out[0]).toBe(scheduledTraining)
    expect(JSON.stringify(scheduledTraining)).toBe(before)
  })

  it('Plan this, and only Plan this, produces the session', () => {
    const session = sessionFromSpondEvent(scheduledTraining, 'coach-1', null, ['team-1', 'team-2'])
    expect(session.spondEventId).toBe('scheduled-training')
    expect(session.name).toBe('Titans training')
    expect(session.teamIds).toEqual(['team-1'])
    expect(session.coachId).toBe('coach-1')
    expect(session.activities).toEqual([])
  })

  it('once a coach has planned it, it stops being suggested to them', () => {
    const out = spondPlanSuggestions({
      ...opts,
      events: [scheduledTraining],
      plannedEventIds: new Set(['scheduled-training']),
    })
    expect(out).toEqual([])
  })
})

describe('mappingForTeam', () => {
  const mapping = (over: Partial<SpondMapping>): SpondMapping => ({
    id: 'm1',
    groupId: 'GROUPID',
    subgroupId: null,
    name: 'U8 Tigers',
    teamId: 'team-1',
    teamName: 'Titans',
    createdAt: '2026-06-01T00:00:00Z',
    ...over,
  })

  it('offers import only when the team has a mapping', () => {
    const mappings = [mapping({ id: 'm1', teamId: 'team-1' })]
    // A mapped team gets a mapping back, so the import affordance shows.
    expect(mappingForTeam(mappings, 'team-1')?.id).toBe('m1')
    // An unmapped team gets null, so the import affordance is hidden.
    expect(mappingForTeam(mappings, 'team-2')).toBeNull()
    // No team selected, no import.
    expect(mappingForTeam(mappings, '')).toBeNull()
    // No mappings at all, no import.
    expect(mappingForTeam([], 'team-1')).toBeNull()
  })

  it('returns the first mapping when a team carries more than one', () => {
    const mappings = [
      mapping({ id: 'm1', teamId: 'team-1', subgroupId: 'SUBA' }),
      mapping({ id: 'm2', teamId: 'team-1', subgroupId: 'SUBB' }),
    ]
    expect(mappingForTeam(mappings, 'team-1')?.id).toBe('m1')
  })
})

describe('syncedAgo', () => {
  const now = new Date('2026-06-12T12:00:00Z')

  it('labels freshness coarsely', () => {
    expect(syncedAgo('2026-06-12T11:59:40Z', now)).toBe('synced just now')
    expect(syncedAgo('2026-06-12T11:40:00Z', now)).toBe('synced 20 minutes ago')
    expect(syncedAgo('2026-06-12T09:00:00Z', now)).toBe('synced 3 hours ago')
    expect(syncedAgo('2026-06-10T09:00:00Z', now)).toBe('synced 2 days ago')
  })

  it('returns nothing for an unreadable timestamp', () => {
    expect(syncedAgo('not a time', now)).toBe('')
  })
})
