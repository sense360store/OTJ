// The shared session/event filter, pinned. Written before the module.
//
// This is the composition layer above the classifier: it decides what a list
// shows given the event kind, where the row sits in its own lifecycle, the
// optional team narrowing and the optional ownership narrowing. Sessions,
// Home and the Spond surfaces all call it, so they cannot drift into
// different defaults.
//
// The fixtures at the top carry no date, so they are never timed out and the
// kind, team and ownership cases below say exactly what they used to. The
// lifecycle cases further down bring their own dated rows and their own
// clock; nothing in this file reads the real one.
import { describe, expect, it } from 'vitest'
import { applyEventFilter, DEFAULT_EVENT_FILTER, pickNextEvent } from './eventFilter'
import { spondEventLookup } from './eventKind'

const training = { id: 't1', title: 'Titans training', coachId: 'me', teamIds: ['titans'] }
const otherTraining = { id: 't2', title: 'Trojans training', coachId: 'someone', teamIds: ['trojans'] }
const fixture = { id: 'f1', title: 'Friendly vs Horbury', coachId: 'me', teamIds: ['titans'] }
const gala = { id: 'g1', title: 'Summer gala', coachId: 'someone', teamIds: ['trojans'] }
const all = [training, otherTraining, fixture, gala]

const ids = (rows: { id: string }[]) => rows.map((r) => r.id)

describe('the default', () => {
  it('is Training, and shows nobody else out', () => {
    expect(DEFAULT_EVENT_FILTER).toEqual({ kind: 'training', scope: 'upcoming', mine: false })
  })

  it('shows every coach training by default, not only mine', () => {
    // The default must not depend on the current user owning the row.
    expect(ids(applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'me' }))).toEqual(['t1', 't2'])
  })

  it('gives the same default answer whoever is looking', () => {
    const asMe = ids(applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'me' }))
    const asOther = ids(applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'someone' }))
    const asNobody = ids(applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: null }))
    expect(asMe).toEqual(asOther)
    expect(asOther).toEqual(asNobody)
  })

  it('keeps a fixture and a gala out of Training', () => {
    const out = ids(applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'me' }))
    expect(out).not.toContain('f1')
    expect(out).not.toContain('g1')
  })
})

describe('All events', () => {
  it('deliberately shows both training and everything else', () => {
    expect(ids(applyEventFilter(all, { kind: 'all', scope: 'upcoming', mine: false }, { userId: 'me' }))).toEqual([
      't1', 't2', 'f1', 'g1',
    ])
  })
})

describe('the team filter composes, and never changes the event kind', () => {
  const teamMatch = (e: { teamIds: string[] }) => e.teamIds.includes('titans')

  it('composes with Training', () => {
    expect(ids(applyEventFilter(all, { kind: 'training', scope: 'upcoming', mine: false }, { userId: 'me', teamMatch }))).toEqual(['t1'])
  })

  it('composes with All events', () => {
    expect(ids(applyEventFilter(all, { kind: 'all', scope: 'upcoming', mine: false }, { userId: 'me', teamMatch }))).toEqual(['t1', 'f1'])
  })

  it('switching team does not silently switch event kind', () => {
    const titans = applyEventFilter(all, { kind: 'training', scope: 'upcoming', mine: false }, { userId: 'me', teamMatch })
    const trojans = applyEventFilter(all, { kind: 'training', scope: 'upcoming', mine: false }, {
      userId: 'me',
      teamMatch: (e: { teamIds: string[] }) => e.teamIds.includes('trojans'),
    })
    // Both stay training. Changing team changed the team, nothing else.
    expect(ids(titans)).toEqual(['t1'])
    expect(ids(trojans)).toEqual(['t2'])
  })
})

describe('ownership is a secondary narrowing, never the default', () => {
  it('narrows to mine only when explicitly asked', () => {
    expect(ids(applyEventFilter(all, { kind: 'training', scope: 'upcoming', mine: true }, { userId: 'me' }))).toEqual(['t1'])
  })

  it('composes with All events without changing the kind', () => {
    expect(ids(applyEventFilter(all, { kind: 'all', scope: 'upcoming', mine: true }, { userId: 'me' }))).toEqual(['t1', 'f1'])
  })

  it('with no signed in user, mine narrows to nothing rather than to everything', () => {
    // Fail closed: an unknown viewer must not silently see every row as "mine".
    expect(ids(applyEventFilter(all, { kind: 'training', scope: 'upcoming', mine: true }, { userId: null }))).toEqual([])
  })
})

describe('the next event a schedule leads with', () => {
  // Home's hero. The input is already ordered soonest first.
  it('prefers your own next training', () => {
    expect(pickNextEvent([otherTraining, training], 'me')?.id).toBe('t1')
  })

  it("falls back to the club's next training when you own nothing coming up", () => {
    // The bug this replaces: a coach who owns no session was told "Nothing
    // scheduled yet" on a night the club was training.
    expect(pickNextEvent([otherTraining, fixture], 'me')?.id).toBe('t2')
  })

  it('prefers training over a sooner fixture you own', () => {
    // Ownership is the tie-breaker within a kind, never a reason to lead
    // with a fixture on a training hub's front page.
    expect(pickNextEvent([fixture, otherTraining], 'me')?.id).toBe('t2')
  })

  it('still leads with something when the only thing coming up is a fixture', () => {
    // Showing the gala beats claiming an empty calendar. Nobody here owns
    // anything, so the soonest wins outright.
    expect(pickNextEvent([gala, fixture], 'nobody')?.id).toBe('g1')
    expect(pickNextEvent([fixture, gala], 'nobody')?.id).toBe('f1')
  })

  it('prefers your own among fixtures too, once no training is left', () => {
    expect(pickNextEvent([gala, fixture], 'me')?.id).toBe('f1')
  })

  it('gives the same answer to a signed out viewer as to a coach who owns nothing', () => {
    expect(pickNextEvent([otherTraining, gala], null)?.id).toBe('t2')
  })

  it('is undefined on an empty schedule', () => {
    expect(pickNextEvent([], 'me')).toBeUndefined()
  })
})

describe('a session linked to a Spond MATCH stays a fixture through the filter', () => {
  // The composition layer is where the screens meet the classifier, so the
  // linked event fact has to survive this far or it is not worth having.
  const lookup = spondEventLookup([
    { id: 'e-match', spondType: 'MATCH' },
    { id: 'e-event', spondType: 'EVENT' },
  ])
  // A neutral fixture title: nothing in the word list to catch it.
  const plannedMatch = { id: 'm1', title: 'U8 v Horbury', coachId: 'me', spondEventId: 'e-match', teamIds: ['titans'] }
  const plannedTraining = {
    id: 'p1',
    title: 'Titans Tuesday',
    coachId: 'someone',
    spondEventId: 'e-event',
    teamIds: ['titans'],
  }
  const rows = [training, plannedMatch, plannedTraining]

  it('keeps it out of Training', () => {
    expect(ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: 'me', spondEvents: lookup }))).toEqual([
      't1',
      'p1',
    ])
  })

  it('still shows it under All events', () => {
    expect(ids(applyEventFilter(rows, { kind: 'all', scope: 'upcoming', mine: false }, { userId: 'me', spondEvents: lookup }))).toEqual([
      't1',
      'm1',
      'p1',
    ])
  })

  it('is not rescued into Training by a team filter', () => {
    const teamMatch = (e: { teamIds?: string[] }) => (e.teamIds ?? []).includes('titans')
    expect(
      ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: 'me', teamMatch, spondEvents: lookup })),
    ).toEqual(['t1', 'p1'])
  })

  it('is not rescued into Training by the ownership narrowing', () => {
    // The coach owns the fixture. Mine narrows within the kind and cannot
    // widen it, so their Training list is still training only.
    expect(
      ids(applyEventFilter(rows, { kind: 'training', scope: 'upcoming', mine: true }, { userId: 'me', spondEvents: lookup })),
    ).toEqual(['t1'])
  })

  it('reverts to the title rules when no lookup is supplied', () => {
    // Documented degrade, and the reason the invariant test pins that the
    // session screens supply one.
    expect(ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: 'me' }))).toEqual(['t1', 'm1', 'p1'])
  })

  it('is never chosen as the schedule s next training', () => {
    expect(pickNextEvent([plannedMatch, training], 'me', lookup)?.id).toBe('t1')
  })

  it('can still lead a schedule that holds nothing else', () => {
    // Leading with the fixture beats claiming an empty calendar, which is
    // the same fallback an unlinked fixture gets.
    expect(pickNextEvent([plannedMatch], 'me', lookup)?.id).toBe('m1')
  })
})

describe('remounting gives the documented default', () => {
  it('returns the Training default from a fresh state object every time', () => {
    // The default is a constant, so a screen that resets to it after
    // navigating or refetching lands on Training, not on whatever was last set.
    const first = applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'me' })
    const afterRemount = applyEventFilter(all, DEFAULT_EVENT_FILTER, { userId: 'me' })
    expect(ids(first)).toEqual(ids(afterRemount))
    expect(ids(afterRemount)).toEqual(['t1', 't2'])
  })
})

// ---- The lifecycle, composed with everything above --------------------
//
// Dated rows and an explicit clock, so these say the same thing whenever
// and wherever they run. 19:15 on the 11th is after the 18:00 training
// finished and before the 19:30 one starts.

const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)
const DURING = at(2026, 8, 11, 18, 30)
const AFTER = at(2026, 8, 11, 22, 0)

const dated = (over: {
  id: string
  title: string
  coachId?: string
  date: string
  time: string
  teamIds?: string[]
}) => ({ activities: [{ duration: 60 }], teamIds: ['titans'], coachId: 'me', ...over })

const lastNight = dated({ id: 'was', title: 'Titans training', date: '2026-08-10', time: '18:00' })
const tonight = dated({ id: 'now', title: 'Titans training', date: '2026-08-11', time: '18:00' })
const nextWeek = dated({ id: 'next', title: 'Titans training', date: '2026-08-18', time: '18:00' })
const lastNightFixture = dated({
  id: 'was-fixture',
  title: 'Friendly vs Horbury',
  date: '2026-08-10',
  time: '10:00',
})
const schedule = [lastNight, lastNightFixture, tonight, nextWeek]

describe('19. Training and All events compose with Upcoming and Past', () => {
  it('leads with tonight and next week, and leaves last night out', () => {
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: DURING }))).toEqual([
      'now',
      'next',
    ])
  })

  it('shows last night, and only last night, under Past', () => {
    expect(
      ids(applyEventFilter(schedule, { kind: 'training', scope: 'past', mine: false }, { userId: 'me', now: DURING })),
    ).toEqual(['was'])
  })

  it('keeps the kind while the lifecycle changes, and the lifecycle while the kind changes', () => {
    // Four cells, four different answers, and no cell borrows a row from
    // another. This is what "composes" has to mean to be worth claiming.
    const cell = (kind: 'training' | 'all', scope: 'upcoming' | 'past') =>
      ids(applyEventFilter(schedule, { kind, scope, mine: false }, { userId: 'me', now: DURING }))
    expect(cell('training', 'upcoming')).toEqual(['now', 'next'])
    expect(cell('training', 'past')).toEqual(['was'])
    expect(cell('all', 'upcoming')).toEqual(['now', 'next'])
    expect(cell('all', 'past')).toEqual(['was', 'was-fixture'])
  })

  it('keeps tonight in the operational view after it has finished, until the day turns over', () => {
    // CORRECTED. This used to assert that 22:00 on the night of the session
    // filed it under Past, which is the reported regression: at 22:30 on
    // 2026-08-11 a coach could not reach that evening's own session from
    // any list. It has ended, so it is not the next thing; it is still
    // tonight, so it stays in the view a coach lands on.
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: AFTER }))).toEqual(['now', 'next'])
    expect(
      ids(applyEventFilter(schedule, { kind: 'training', scope: 'past', mine: false }, { userId: 'me', now: AFTER })),
    ).toEqual(['was'])
  })

  it('moves tonight into Past once the local day is over', () => {
    // The half of the original rule that was right, kept and proved.
    const tomorrow = at(2026, 8, 12, 9, 0)
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: tomorrow }))).toEqual(['next'])
    expect(
      ids(applyEventFilter(schedule, { kind: 'training', scope: 'past', mine: false }, { userId: 'me', now: tomorrow })),
    ).toEqual(['was', 'now'])
  })

  it('keeps tonight in the operational view while it is still running', () => {
    // 18:05 on the night. The rule that hid it here is the one this whole
    // change exists to remove.
    const started = at(2026, 8, 11, 18, 5)
    expect(ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: started }))).toContain('now')
  })
})

describe('20. team narrowing composes with the lifecycle', () => {
  const trojansTonight = dated({
    id: 'trojans-now',
    title: 'Trojans training',
    date: '2026-08-11',
    time: '18:00',
    teamIds: ['trojans'],
  })
  const trojansLastNight = dated({
    id: 'trojans-was',
    title: 'Trojans training',
    date: '2026-08-10',
    time: '18:00',
    teamIds: ['trojans'],
  })
  const rows = [...schedule, trojansTonight, trojansLastNight]
  const teamMatch = (e: { teamIds?: string[] }) => (e.teamIds ?? []).includes('trojans')

  it('narrows within Upcoming without pulling a past row back in', () => {
    expect(
      ids(applyEventFilter(rows, DEFAULT_EVENT_FILTER, { userId: 'me', teamMatch, now: DURING })),
    ).toEqual(['trojans-now'])
  })

  it('narrows within Past without pulling an upcoming row back in', () => {
    expect(
      ids(
        applyEventFilter(rows, { kind: 'training', scope: 'past', mine: false }, { userId: 'me', teamMatch, now: DURING }),
      ),
    ).toEqual(['trojans-was'])
  })

  it('composes with ownership too, and ownership still cannot widen either', () => {
    const theirs = { ...trojansTonight, coachId: 'someone' }
    const out = ids(
      applyEventFilter([...schedule, theirs], { kind: 'training', scope: 'upcoming', mine: true }, {
        userId: 'me',
        now: DURING,
      }),
    )
    expect(out).toEqual(['now', 'next'])
  })
})

describe('13 and 14. a finished session is never what a schedule leads with', () => {
  it('skips last night and leads with tonight', () => {
    expect(pickNextEvent([lastNight, tonight, nextWeek], 'me', undefined, DURING)?.id).toBe('now')
  })

  it('hands the lead to the next valid training the moment tonight ends', () => {
    expect(pickNextEvent([lastNight, tonight, nextWeek], 'me', undefined, AFTER)?.id).toBe('next')
  })

  it('leads with nothing rather than with a session that has already happened', () => {
    // The honest empty state. Yesterday's training is not "next".
    expect(pickNextEvent([lastNight, lastNightFixture], 'me', undefined, DURING)).toBeUndefined()
  })

  it('keeps leading with a session that is being driven live past its expected end', () => {
    const running = { ...tonight, liveActivityIndex: 1, liveActivityStartedAt: '2026-08-11T18:40:00Z' }
    expect(pickNextEvent([running, nextWeek], 'me', undefined, AFTER)?.id).toBe('now')
  })

  it('never leads with a session whose status says completed', () => {
    const done = { ...tonight, status: 'completed' as const }
    expect(pickNextEvent([done, nextWeek], 'me', undefined, DURING)?.id).toBe('next')
  })
})

describe('16 and 17. narrowing a list is a view, not a write', () => {
  it('leaves every input row exactly as it found it', () => {
    const before = JSON.stringify(schedule)
    applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: AFTER })
    pickNextEvent(schedule, 'me', undefined, AFTER)
    expect(JSON.stringify(schedule)).toBe(before)
  })

  it('still holds the finished session in the data it was given', () => {
    // Filtered out of the view, present in the array. Nothing here removes
    // a row from anywhere but a screen.
    const view = applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: AFTER })
    expect(ids(view)).not.toContain('was')
    expect(ids(schedule)).toContain('was')
    expect(schedule).toHaveLength(4)
  })
})

describe('18. a screen mounted again after the session ended agrees with itself', () => {
  it('classifies the same row the same way on every mount', () => {
    const first = ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: AFTER }))
    const second = ids(applyEventFilter(schedule, DEFAULT_EVENT_FILTER, { userId: 'me', now: AFTER }))
    expect(first).toEqual(second)
    expect(first).toEqual(['now', 'next'])
  })
})
