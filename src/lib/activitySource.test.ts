// COACH-14B: where an activity comes from.
//
// SPEC. Two rules carry the weight. A source is withheld only on
// SETTLED evidence, so a read in flight never hides the library from a
// coach who came to add a drill. And an activity lifted out of a week
// plan is a field by field copy of the canonical Activity, keeping the
// coaching structure and dropping the one key that belongs to somebody
// else's evening.
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_SOURCES,
  availableSources,
  hasNoActivitySource,
  importedActivities,
  importedActivity,
  RECENT_DRILL_COUNT,
  recentDrills,
  sourceUnavailable,
} from './activitySource'
import type { ActivitySourceContext } from './activitySource'
import { sortLibraryDrills } from './contentOrder'
import type { Activity } from './data'

const ctx = (over: Partial<ActivitySourceContext> = {}): ActivitySourceContext => ({
  canCreateDrill: true,
  canDraw: true,
  libraryCount: 12,
  weekPlanCount: 3,
  programmeCount: 2,
  ...over,
})

const drill = (id: string, createdAt: string, title = id) => ({ id, title, duration: 10, createdAt })

describe('which sources are offered', () => {
  it('offers all six to a coach who may create, in a club with content', () => {
    expect(availableSources(ctx())).toEqual([...ACTIVITY_SOURCES])
  })

  it('leads with recent and search before the two that make something new', () => {
    const order = availableSources(ctx())
    expect(order.indexOf('recent')).toBeLessThan(order.indexOf('quick-drill'))
    expect(order.indexOf('library')).toBeLessThan(order.indexOf('quick-drill'))
  })

  it('withholds recent and search together when the library is settled empty', () => {
    const sources = availableSources(ctx({ libraryCount: 0 }))
    expect(sources).not.toContain('recent')
    expect(sources).not.toContain('library')
    // What is left is the answer for a club with no drills yet, which is
    // the instruction COACH-14 exists to remove: never "go to the Library
    // first".
    expect(sources).toContain('quick-drill')
  })

  it('withholds a week plan or a programme source only when that list is settled empty', () => {
    expect(availableSources(ctx({ weekPlanCount: 0 }))).not.toContain('week-plan')
    expect(availableSources(ctx({ programmeCount: 0 }))).not.toContain('programme')
    expect(availableSources(ctx({ weekPlanCount: 0 }))).toContain('programme')
  })

  it('OFFERS every source whose read has not answered, because null is not zero', () => {
    const unknown = ctx({ libraryCount: null, weekPlanCount: null, programmeCount: null })
    expect(availableSources(unknown)).toEqual([...ACTIVITY_SOURCES])
  })

  it('names why a source is missing rather than leaving a gap', () => {
    expect(sourceUnavailable('library', ctx({ libraryCount: 0 }))).toBe('empty')
    expect(sourceUnavailable('quick-drill', ctx({ canCreateDrill: false }))).toBe('not-permitted')
    expect(sourceUnavailable('library', ctx())).toBeNull()
  })
})

describe('what permission decides', () => {
  it('withholds both creating routes from a member who may not create a drill', () => {
    const sources = availableSources(ctx({ canCreateDrill: false }))
    expect(sources).not.toContain('quick-drill')
    expect(sources).not.toContain('draw')
    expect(sources).toContain('library')
  })

  it('withholds only drawing from a member who may create but cannot reach the Drill Maker', () => {
    // COACH-11 established that these are two capabilities and that
    // offering the trip to somebody the route guard will turn away
    // strands their draft.
    const sources = availableSources(ctx({ canDraw: false }))
    expect(sources).toContain('quick-drill')
    expect(sources).not.toContain('draw')
  })

  it('never offers drawing to somebody who cannot create the drill to draw', () => {
    // The Drill Maker opens on a drill id, so there is nothing to draw
    // until the drill exists.
    expect(sourceUnavailable('draw', ctx({ canCreateDrill: false, canDraw: true }))).toBe('not-permitted')
  })

  it('says so when a member has no way to add anything at all', () => {
    expect(hasNoActivitySource(ctx({ canCreateDrill: false, libraryCount: 0, weekPlanCount: 0, programmeCount: 0 }))).toBe(
      true,
    )
    expect(hasNoActivitySource(ctx({ libraryCount: 0, weekPlanCount: 0, programmeCount: 0 }))).toBe(false)
  })
})

describe('the recent shortcut', () => {
  const drills = [
    drill('a', '2026-01-01T00:00:00Z'),
    drill('b', '2026-03-01T00:00:00Z'),
    drill('c', '2026-02-01T00:00:00Z'),
  ]

  it('is the product existing Recent order and not a new one', () => {
    expect(recentDrills(drills, 3).map((d) => d.id)).toEqual(sortLibraryDrills(drills, 'recent').map((d) => d.id))
  })

  it('is newest added first', () => {
    expect(recentDrills(drills, 3).map((d) => d.id)).toEqual(['b', 'c', 'a'])
  })

  it('caps at a shortcut length rather than becoming a second picker', () => {
    expect(recentDrills(drills).length).toBeLessThanOrEqual(RECENT_DRILL_COUNT)
    expect(recentDrills(drills, 2).map((d) => d.id)).toEqual(['b', 'c'])
  })

  it('copies rather than sorting the caller list in place', () => {
    const given = [...drills]
    recentDrills(given)
    expect(given.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('handles an empty library and a nonsense limit without throwing', () => {
    expect(recentDrills([])).toEqual([])
    expect(recentDrills(drills, -1)).toEqual([])
  })
})

describe('taking an activity out of a week plan', () => {
  it('carries the drill, the phase and the minutes', () => {
    const source: Activity = { phase: 'Skill', drillId: 'd1', duration: 15 }
    expect(importedActivity(source)).toEqual({ phase: 'Skill', drillId: 'd1', duration: 15 })
  })

  it('keeps a declared station or games phase, so the coaching structure survives', () => {
    expect(importedActivity({ phase: 'Skill', drillId: 'd1', duration: 12, slot: 'station' }).slot).toBe('station')
    expect(importedActivity({ phase: 'Game', drillId: 'd2', duration: 20, slot: 'game' }).slot).toBe('game')
  })

  it('drops a stood down marker, because that was a decision about another evening', () => {
    const source: Activity = { phase: 'Skill', drillId: 'd1', duration: 12, slot: 'station', skipped: true }
    // Asserted as the ABSENCE OF THE KEY rather than by reading it. The
    // stand-down key is read in exactly one module (activityStructure.ts)
    // and activityStructure.invariant.test.ts fails the build on a second
    // reader, this file included. Key presence is the stronger claim
    // anyway: the canonical representation has no `false`, so a key that
    // merely read as undefined would still be a key that should not exist.
    expect(Object.keys(importedActivity(source)).sort()).toEqual(['drillId', 'duration', 'phase', 'slot'])
  })

  it('drops a malformed slot rather than carrying a value nothing can read', () => {
    const source = { phase: 'Skill', drillId: 'd1', duration: 12, slot: 'Station' } as unknown as Activity
    expect(importedActivity(source).slot).toBeUndefined()
  })

  it('keeps a custom row title so an activity with no drill is still named', () => {
    expect(importedActivity({ phase: 'Skill', title: 'Rondo', duration: 10 }).title).toBe('Rondo')
  })

  it('carries no key the Activity type does not declare, even out of unconstrained jsonb', () => {
    const source = {
      phase: 'Skill',
      drillId: 'd1',
      duration: 12,
      // Whatever a stored row happens to hold beside the declared keys.
      notes: 'left over',
      sessionId: 's1',
    } as unknown as Activity
    expect(Object.keys(importedActivity(source)).sort()).toEqual(['drillId', 'duration', 'phase'])
  })

  it('omits absent keys rather than writing them as empty', () => {
    // An activity with no drill must not gain drillId: '' , which reads as
    // a drill that cannot be found.
    const copy = importedActivity({ phase: 'Warm-Up', duration: 8 })
    expect(Object.prototype.hasOwnProperty.call(copy, 'drillId')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(copy, 'title')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(copy, 'slot')).toBe(false)
  })

  it('does not alias the source, so editing the copy cannot edit the week plan', () => {
    const source: Activity = { phase: 'Skill', drillId: 'd1', duration: 12 }
    const copy = importedActivity(source)
    copy.duration = 30
    expect(source.duration).toBe(12)
  })

  it('takes a whole plan in order', () => {
    const plan: Activity[] = [
      { phase: 'Warm-Up', drillId: 'a', duration: 10 },
      { phase: 'Skill', drillId: 'b', duration: 20, skipped: true, slot: 'station' },
    ]
    const copied = importedActivities(plan)
    expect(copied.map((a) => a.drillId)).toEqual(['a', 'b'])
    expect(Object.keys(copied[1]).sort()).toEqual(['drillId', 'duration', 'phase', 'slot'])
    expect(copied[1].slot).toBe('station')
  })
})
