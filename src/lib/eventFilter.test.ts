// The shared session/event filter, pinned. Written before the module.
//
// This is the composition layer above the classifier: it decides what a list
// shows given the event kind, the optional team narrowing and the optional
// ownership narrowing. Sessions, Home and the Spond surfaces all call it, so
// they cannot drift into different defaults.
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
    expect(DEFAULT_EVENT_FILTER).toEqual({ kind: 'training', mine: false })
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
    expect(ids(applyEventFilter(all, { kind: 'all', mine: false }, { userId: 'me' }))).toEqual([
      't1', 't2', 'f1', 'g1',
    ])
  })
})

describe('the team filter composes, and never changes the event kind', () => {
  const teamMatch = (e: { teamIds: string[] }) => e.teamIds.includes('titans')

  it('composes with Training', () => {
    expect(ids(applyEventFilter(all, { kind: 'training', mine: false }, { userId: 'me', teamMatch }))).toEqual(['t1'])
  })

  it('composes with All events', () => {
    expect(ids(applyEventFilter(all, { kind: 'all', mine: false }, { userId: 'me', teamMatch }))).toEqual(['t1', 'f1'])
  })

  it('switching team does not silently switch event kind', () => {
    const titans = applyEventFilter(all, { kind: 'training', mine: false }, { userId: 'me', teamMatch })
    const trojans = applyEventFilter(all, { kind: 'training', mine: false }, {
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
    expect(ids(applyEventFilter(all, { kind: 'training', mine: true }, { userId: 'me' }))).toEqual(['t1'])
  })

  it('composes with All events without changing the kind', () => {
    expect(ids(applyEventFilter(all, { kind: 'all', mine: true }, { userId: 'me' }))).toEqual(['t1', 'f1'])
  })

  it('with no signed in user, mine narrows to nothing rather than to everything', () => {
    // Fail closed: an unknown viewer must not silently see every row as "mine".
    expect(ids(applyEventFilter(all, { kind: 'training', mine: true }, { userId: null }))).toEqual([])
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
    expect(ids(applyEventFilter(rows, { kind: 'all', mine: false }, { userId: 'me', spondEvents: lookup }))).toEqual([
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
      ids(applyEventFilter(rows, { kind: 'training', mine: true }, { userId: 'me', spondEvents: lookup })),
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
