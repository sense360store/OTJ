// The structural rules a training night is organised by, and the one rule
// that decides what counts towards its length.
//
// TWO DEFECTS THIS FILE EXISTS TO PIN. The plan used to record nothing
// structural, and the nearest thing to it, `phase`, is set from the drill's
// four corners: a physical drill lands in Warm-Up and a social drill lands in
// Game, whatever part either plays on the night. Anything reading the phase as
// structure gets a physical station wrong in one direction and a social
// non-game wrong in the other, and both are asserted here directly.
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_SLOTS,
  ACTIVITY_STRUCTURE_WARNINGS,
  activeActivityMinutes,
  activeGamesActivity,
  activeStationCount,
  activeStations,
  countsTowardsSessionDuration,
  deriveActivityStructure,
  hasOperationalSlot,
  isActivitySlot,
  isStoodDown,
  MAX_STATIONS,
  MIN_STATIONS,
  stationNumberAt,
} from './activityStructure'
import type { Activity } from './data'

// A five station carousel plus a games phase, which is the shape training
// takes, with a warm-up and a cool-down that are neither.
function plan(): Activity[] {
  return [
    { phase: 'Warm-Up', title: 'Arrival', duration: 5 },
    { phase: 'Warm-Up', drillId: 'd1', duration: 10, slot: 'station' },
    { phase: 'Skill', drillId: 'd2', duration: 10, slot: 'station' },
    { phase: 'Skill', drillId: 'd3', duration: 10, slot: 'station' },
    { phase: 'Skill', drillId: 'd4', duration: 10, slot: 'station' },
    { phase: 'Skill', drillId: 'd5', duration: 10, slot: 'station' },
    { phase: 'Game', drillId: 'd6', duration: 20, slot: 'game' },
    { phase: 'Cool-Down', title: 'Stretch', duration: 5 },
  ]
}

// Removing a key, the way the product removes it: `restore` deletes `skipped`
// rather than writing false, and an undeclared plan simply has no `slot`.
function without(activities: Activity[], key: 'slot' | 'skipped'): Activity[] {
  return activities.map((a) => {
    const copy = { ...a }
    delete copy[key]
    return copy
  })
}

describe('the slot vocabulary', () => {
  it('is exactly two words, and nothing else declares anything', () => {
    expect([...ACTIVITY_SLOTS]).toEqual(['station', 'game'])
    expect(isActivitySlot('station')).toBe(true)
    expect(isActivitySlot('game')).toBe(true)
    // activities is unconstrained jsonb, so a row can carry anything. Every
    // one of these declares nothing, which fails towards running the drill.
    for (const value of ['Station', 'STATION', 'games', '', ' station', 3, true, null, undefined, {}]) {
      expect(isActivitySlot(value)).toBe(false)
    }
  })

  it('reads a carousel as four or five stations', () => {
    expect(MIN_STATIONS).toBe(4)
    expect(MAX_STATIONS).toBe(5)
  })
})

describe('what is operational, and what is stood down', () => {
  it('an operational slot is a station or the games phase, and nothing else', () => {
    expect(hasOperationalSlot({ slot: 'station' })).toBe(true)
    expect(hasOperationalSlot({ slot: 'game' })).toBe(true)
    expect(hasOperationalSlot({})).toBe(false)
    expect(hasOperationalSlot(null)).toBe(false)
    expect(hasOperationalSlot(undefined)).toBe(false)
  })

  it('stands an activity down only when BOTH halves hold', () => {
    expect(isStoodDown({ slot: 'station', skipped: true })).toBe(true)
    expect(isStoodDown({ slot: 'game', skipped: true })).toBe(true)
    // The qualifier: a stray skipped on an activity with no slot is inert.
    expect(isStoodDown({ skipped: true })).toBe(false)
    // And a slot with no skipped is simply running.
    expect(isStoodDown({ slot: 'station' })).toBe(false)
  })

  it('reads only literal true as stood down', () => {
    // `false` is never written. A row carrying one, or carrying a truthy
    // value of some other shape, is running.
    const dirty = [false, 0, 1, 'true', 'yes', null, undefined, {}]
    for (const value of dirty) {
      expect(isStoodDown({ slot: 'station', skipped: value as never })).toBe(false)
    }
  })

  it('counts everything a stood-down activity is not', () => {
    expect(countsTowardsSessionDuration({ slot: 'station', duration: 10 })).toBe(true)
    expect(countsTowardsSessionDuration({ slot: 'station', duration: 10, skipped: true })).toBe(false)
    expect(countsTowardsSessionDuration({ duration: 10, skipped: true })).toBe(true)
    expect(countsTowardsSessionDuration({ duration: 10 })).toBe(true)
  })
})

describe('the active duration rule', () => {
  it('totals exactly what it totals today when no activity is stood down', () => {
    expect(activeActivityMinutes(plan())).toBe(80)
    // And declaring a slot changes nothing by itself: the same plan with
    // every declaration removed totals the same.
    const undeclared = without(plan(), 'slot')
    expect(activeActivityMinutes(undeclared)).toBe(80)
  })

  it('drops exactly the minutes of the stood-down station', () => {
    const four = plan()
    four[5] = { ...four[5], skipped: true }
    expect(activeActivityMinutes(four)).toBe(70)
  })

  it('drops the games phase when the coach stands it down', () => {
    const noGames = plan()
    noGames[6] = { ...noGames[6], skipped: true }
    expect(activeActivityMinutes(noGames)).toBe(60)
  })

  it('keeps the minutes of a stray skipped on an activity with no slot', () => {
    const stray = plan()
    stray[0] = { ...stray[0], skipped: true }
    stray[7] = { ...stray[7], skipped: true }
    expect(activeActivityMinutes(stray)).toBe(80)
  })

  it('totals zero when every operational activity is stood down', () => {
    const off = plan().map((a) => (a.slot ? { ...a, skipped: true as const } : a))
    // The warm-up and the cool-down still run, because neither is
    // operational and neither was stood down.
    expect(activeActivityMinutes(off)).toBe(10)
    const onlyStations = off.filter((a) => a.slot)
    expect(activeActivityMinutes(onlyStations)).toBe(0)
  })

  it('absorbs an unusable duration rather than poisoning the sum', () => {
    expect(activeActivityMinutes([{ duration: Number.NaN }, { duration: 25 }])).toBe(25)
    expect(activeActivityMinutes([{ duration: null }, { duration: undefined }, { duration: 5 }])).toBe(5)
    expect(activeActivityMinutes([])).toBe(0)
    expect(activeActivityMinutes(null)).toBe(0)
    expect(activeActivityMinutes(undefined)).toBe(0)
  })
})

describe('station numbering follows the plan order of the stations running', () => {
  it('numbers the active stations 1..n in plan order', () => {
    const stations = activeStations(plan())
    expect(stations.map((s) => s.station)).toEqual([1, 2, 3, 4, 5])
    expect(stations.map((s) => s.activity.drillId)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'])
    expect(activeStationCount(plan())).toBe(5)
  })

  it('carries the position in the whole plan, which is not the station number', () => {
    // A fixture whose two values differ, because in plan() the stations
    // happen to sit at indices 1 to 5 and carry numbers 1 to 5, so asserting
    // on both there separates nothing. Interleaving a non-station pulls them
    // apart, which is what makes an implementation that stored the number in
    // `index` fail.
    const interleaved: Activity[] = [
      { phase: 'Skill', drillId: 'd1', duration: 10, slot: 'station' },
      { phase: 'Warm-Up', title: 'Water', duration: 2 },
      { phase: 'Skill', drillId: 'd2', duration: 10, slot: 'station' },
      { phase: 'Warm-Up', title: 'Water', duration: 2 },
      { phase: 'Skill', drillId: 'd3', duration: 10, slot: 'station' },
    ]
    const stations = activeStations(interleaved)
    expect(stations.map((s) => s.station)).toEqual([1, 2, 3])
    expect(stations.map((s) => s.index)).toEqual([0, 2, 4])
    expect(stationNumberAt(interleaved, 4)).toBe(3)
    expect(stationNumberAt(interleaved, 1)).toBeNull()
  })

  it('omits a stood-down station and renumbers the rest', () => {
    const four = plan()
    four[3] = { ...four[3], skipped: true }
    const stations = activeStations(four)
    expect(stations.map((s) => s.activity.drillId)).toEqual(['d1', 'd2', 'd4', 'd5'])
    expect(stations.map((s) => s.station)).toEqual([1, 2, 3, 4])
    expect(activeStationCount(four)).toBe(4)
    // The stood-down one is still declared, still in the plan, and has no
    // number: nothing was deleted.
    expect(deriveActivityStructure(four).declaredStations).toHaveLength(5)
    expect(stationNumberAt(four, 3)).toBeNull()
  })

  it('returns a restored station to its original place in the plan order', () => {
    const before = activeStations(plan()).map((s) => [s.index, s.station])
    const four = plan()
    four[3] = { ...four[3], skipped: true }
    expect(stationNumberAt(four, 4)).toBe(3)
    // Restoring REMOVES the key rather than writing false, and the plan
    // order was never touched, so the numbering comes straight back.
    const restored = without(four, 'skipped')
    expect(activeStations(restored).map((s) => [s.index, s.station])).toEqual(before)
    expect(stationNumberAt(restored, 3)).toBe(3)
    expect(stationNumberAt(restored, 4)).toBe(4)
  })

  it('gives no station number to an activity that is not a running station', () => {
    // The warm-up, the cool-down and the games phase.
    expect(stationNumberAt(plan(), 0)).toBeNull()
    expect(stationNumberAt(plan(), 6)).toBeNull()
    expect(stationNumberAt(plan(), 7)).toBeNull()
    // And a position nothing occupies.
    expect(stationNumberAt(plan(), 99)).toBeNull()
  })
})

describe('nothing is inferred from the coaching phase', () => {
  it('a Warm-Up physical drill somebody marked as a station IS a station', () => {
    // phaseFor puts a physical drill in Warm-Up. It can perfectly well be
    // one of the carousel stations, and here it is declared as one.
    const structure = deriveActivityStructure([{ phase: 'Warm-Up', drillId: 'd1', duration: 10, slot: 'station' }])
    expect(structure.stationCount).toBe(1)
    expect(structure.stations[0].activity.phase).toBe('Warm-Up')
  })

  it('a Game phase social drill nobody marked is NOT the games phase', () => {
    // phaseFor puts a social drill in Game, and that proves nothing.
    const structure = deriveActivityStructure([{ phase: 'Game', drillId: 'd6', duration: 20 }])
    expect(structure.gamesActivity).toBeNull()
    expect(structure.games).toEqual([])
    expect(structure.declaredGames).toEqual([])
  })

  it('a plan that declares nothing declares nothing, and does not guess', () => {
    const undeclared: Activity[] = [
      { phase: 'Warm-Up', drillId: 'd1', duration: 10 },
      { phase: 'Skill', drillId: 'd2', duration: 20 },
      { phase: 'Game', drillId: 'd3', duration: 15 },
      { phase: 'Cool-Down', title: 'Stretch', duration: 5 },
    ]
    const structure = deriveActivityStructure(undeclared)
    expect(structure.declared).toBe(false)
    expect(structure.stations).toEqual([])
    expect(structure.stationCount).toBe(0)
    expect(structure.gamesActivity).toBeNull()
    expect(structure.warnings).toEqual(['no-stations-declared'])
  })

  it('reads a plan that declares only the games phase as declared', () => {
    // `declared` is the field the screens read as "not set up yet" rather
    // than as "zero stations", so the true case matters as much as the false
    // one, and a plan carrying only the games phase HAS declared structure.
    const gamesOnly = deriveActivityStructure([{ phase: 'Game', drillId: 'd6', duration: 20, slot: 'game' }])
    expect(gamesOnly.declared).toBe(true)
    expect(gamesOnly.stationCount).toBe(0)
    expect(gamesOnly.warnings).toEqual(['no-stations-declared'])
    // And a plan with stations, whether they run or not.
    expect(deriveActivityStructure(plan()).declared).toBe(true)
    const allOff = plan().map((a) => (a.slot ? { ...a, skipped: true as const } : a))
    expect(deriveActivityStructure(allOff).declared).toBe(true)
  })

  it('reads an empty or absent plan the same way', () => {
    for (const empty of [[], null, undefined]) {
      const structure = deriveActivityStructure(empty)
      expect(structure.declared).toBe(false)
      expect(structure.stations).toEqual([])
      expect(structure.warnings).toEqual(['no-stations-declared'])
    }
  })
})

describe('the games phase is one activity', () => {
  it('finds the one declared games activity', () => {
    const games = activeGamesActivity(plan())
    expect(games?.index).toBe(6)
    expect(games?.activity.drillId).toBe('d6')
  })

  it('names two active games activities rather than choosing one', () => {
    const two = plan()
    two.splice(7, 0, { phase: 'Game', drillId: 'd7', duration: 20, slot: 'game' })
    const structure = deriveActivityStructure(two)
    expect(structure.games).toHaveLength(2)
    // No best guess: an ambiguous plan answers null and says which
    // ambiguity it is.
    expect(structure.gamesActivity).toBeNull()
    expect(structure.warnings).toContain('multiple-active-games')
  })

  it('reads a stood-down games phase as no games tonight, without an ambiguity', () => {
    const two = plan()
    two.splice(7, 0, { phase: 'Game', drillId: 'd7', duration: 20, slot: 'game', skipped: true })
    const structure = deriveActivityStructure(two)
    expect(structure.declaredGames).toHaveLength(2)
    expect(structure.games).toHaveLength(1)
    expect(structure.gamesActivity?.activity.drillId).toBe('d6')
    expect(structure.warnings).not.toContain('multiple-active-games')
  })

  it('answers null when the only declared games activity is stood down', () => {
    const noGames = plan()
    noGames[6] = { ...noGames[6], skipped: true }
    expect(activeGamesActivity(noGames)).toBeNull()
    expect(deriveActivityStructure(noGames).declaredGames).toHaveLength(1)
  })

  it('counts no activities to learn how many games run', () => {
    // gameCount belongs to COACH-8 and is deliberately not here. The one
    // games activity is the whole games phase, and its duration is that
    // phase's duration.
    const structure = deriveActivityStructure(plan())
    expect(Object.keys(structure)).not.toContain('gameCount')
    expect(structure.gamesActivity?.activity.duration).toBe(20)
  })
})

describe('the counts worth naming', () => {
  const stations = (n: number, over: Partial<Activity> = {}): Activity[] =>
    Array.from({ length: n }, (_, i) => ({
      phase: 'Skill' as const,
      drillId: `d${i + 1}`,
      duration: 10,
      slot: 'station' as const,
      ...over,
    }))

  it('says nothing about a count nobody declared', () => {
    expect(deriveActivityStructure([]).warnings).toEqual(['no-stations-declared'])
  })

  it('names too few and too many, and blocks neither', () => {
    expect(deriveActivityStructure(stations(3)).warnings).toEqual(['too-few-stations'])
    expect(deriveActivityStructure(stations(1)).warnings).toEqual(['too-few-stations'])
    expect(deriveActivityStructure(stations(6)).warnings).toEqual(['too-many-stations'])
    // Four and five are the shape training takes, and say nothing.
    expect(deriveActivityStructure(stations(4)).warnings).toEqual([])
    expect(deriveActivityStructure(stations(5)).warnings).toEqual([])
  })

  it('tells a plan with no stations apart from a plan whose stations are all stood down', () => {
    // Opposite facts. One is a plan nobody declared, and the fix is to
    // declare it; the other is a declared carousel a coach turned off.
    expect(deriveActivityStructure(stations(0)).warnings).toEqual(['no-stations-declared'])
    expect(deriveActivityStructure(stations(5, { skipped: true })).warnings).toEqual(['all-stations-stood-down'])
  })

  it('counts the stations RUNNING, not the stations declared', () => {
    const five = stations(5)
    five[0] = { ...five[0], skipped: true }
    expect(deriveActivityStructure(five).warnings).toEqual([])
    five[1] = { ...five[1], skipped: true }
    expect(deriveActivityStructure(five).warnings).toEqual(['too-few-stations'])
  })

  it('gives every warning a sentence, so a screen never renders a code', () => {
    const codes: (keyof typeof ACTIVITY_STRUCTURE_WARNINGS)[] = [
      'no-stations-declared',
      'all-stations-stood-down',
      'too-few-stations',
      'too-many-stations',
      'multiple-active-games',
    ]
    expect(Object.keys(ACTIVITY_STRUCTURE_WARNINGS).sort()).toEqual([...codes].sort())
    for (const code of codes) expect(ACTIVITY_STRUCTURE_WARNINGS[code].length).toBeGreaterThan(0)
  })
})
