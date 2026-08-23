// =====================================================================
// The explicit coaching structure of a session plan, and the one rule
// that decides which activities count towards the night's length.
//
// WHY THIS EXISTS. A training night is a carousel of stations plus a
// games phase, and until now the plan recorded neither. `Phase`
// ('Warm-Up' | 'Skill' | 'Game' | 'Cool-Down') looks like it should
// answer, and it cannot: `phaseFor` (./drillPicker) sets it from the
// drill's four corners, so a physical drill lands in Warm-Up and a
// social drill lands in Game. The phase records what KIND of drill was
// added, never what part it plays on the night. A physical drill can
// perfectly well be one of the stations, and a social drill in the Game
// phase says nothing about whether it is the evening's games phase.
//
// So the structure is DECLARED on the activity, with `slot`, and it is
// never inferred at read time. A plan that declares nothing has no
// declared stations, which is a real answer and not a defaulted one.
//
// NOTHING HERE IS STORED BEYOND THE DECLARATION. A station's number is
// its position among the stations RUNNING tonight, derived on every
// read. Standing one down renumbers the rest; restoring it puts it back
// where the plan put it, because the plan order never moved.
//
// PURE, AND NO REACT. Every function here takes activities and returns
// an answer. That is what lets the four independent session duration
// sums share one predicate, and it is what makes the structural rules
// testable without a screen.
// =====================================================================

// The closed structural vocabulary. 'station' marks ONE OF SEVERAL
// carousel stations; 'game' marks THE ONE activity that is the whole
// games phase, whose duration is that phase's duration. Absent means
// neither, and absent is a real answer.
//
// Deliberately NOT `kind` or `role`: `kind` is already the discriminator
// for diagram elements and content shares, `role` is RBAC, and sitting
// either beside `phase` on one object invites exactly the confusion this
// key exists to remove.
export type ActivitySlot = 'station' | 'game'

export const ACTIVITY_SLOTS: readonly ActivitySlot[] = ['station', 'game']

// A carousel runs four or five stations, never three. Stated here and
// warned about, never enforced: `sessions.activities` is unconstrained
// jsonb and a coach who declares three is told, not blocked.
export const MIN_STATIONS = 4
export const MAX_STATIONS = 5

// The minimum shape every rule in this file needs. Structural rather
// than the `Activity` interface itself, so the stored row shape, the
// lifecycle's loose TimedEvent activity and the client Activity all
// satisfy it without this module depending on any of them.
export interface StructuredActivity {
  duration?: number | null
  slot?: ActivitySlot | null
  // Session local, and written ONLY as literal true. Restoring removes
  // the key; `false` is never stored, so each state has exactly one
  // representation.
  skipped?: true
}

// A runtime guard rather than a cast, because `activities` is
// unconstrained jsonb: a row carrying `slot: 'Station'`, `slot: 3` or
// anything else declares nothing, and failing closed here means a
// malformed value can never hide an activity or its duration.
export function isActivitySlot(value: unknown): value is ActivitySlot {
  return value === 'station' || value === 'game'
}

// Does this activity carry a valid operational slot? This is the
// qualifier the whole file turns on: only a declared station or the
// games phase is operational, so `skipped` is inert everywhere else.
export function hasOperationalSlot(a: StructuredActivity | null | undefined): boolean {
  return isActivitySlot(a?.slot)
}

// Is this activity stood down for tonight?
//
// BOTH HALVES ARE LOAD BEARING. A stray `skipped: true` on an activity
// with no slot must not hide the warm-up or take its minutes off the
// night: the key means "this station is not running tonight", and an
// activity that is not a station has nothing to stand down.
export function isStoodDown(a: StructuredActivity | null | undefined): boolean {
  return hasOperationalSlot(a) && a?.skipped === true
}

// THE ACTIVE DURATION RULE, in one place for the browser.
//
// An activity contributes its minutes UNLESS it carries an operational
// slot AND is stood down. So a plan carrying no `skipped` totals exactly
// what it totals today, which is what makes changing four independent
// duration sums at once a low risk change.
export function countsTowardsSessionDuration(a: StructuredActivity | null | undefined): boolean {
  return !isStoodDown(a)
}

// The sum of the minutes actually running. `|| 0` rather than a nullish
// default on purpose: it also absorbs a NaN duration, which is the
// behaviour the existing sums already have and the tests already pin.
export function activeActivityMinutes(
  activities: readonly (StructuredActivity | null | undefined)[] | null | undefined,
): number {
  return (activities ?? []).reduce((sum, a) => sum + (countsTowardsSessionDuration(a) ? a?.duration || 0 : 0), 0)
}

// An activity carrying its position in the plan, so a caller can map an
// answer back to the row a coach is looking at. The index is the plan
// order index, never the station number.
export interface PlacedActivity<T> {
  activity: T
  index: number
}

// An active station, with the number a coach reads on the night. Station
// N is the Nth ACTIVE station in plan order and is stored nowhere.
export interface NumberedStation<T> extends PlacedActivity<T> {
  station: number
}

// The structural states worth naming. None of them blocks a save.
//
//   no-stations-declared    nothing carries slot: 'station'. Not a
//                           defect: it is every plan written before the
//                           declaration existed. The answer is "none
//                           declared", never a guess.
//   all-stations-stood-down stations are declared and every one of them
//                           is stood down, so the carousel runs nothing.
//   too-few-stations        one to three active stations. Four or five
//                           is the shape training takes.
//   too-many-stations       more than five active stations.
//   multiple-active-games   more than one active slot: 'game'. v1 has
//                           one games phase; two would double it in the
//                           session total, the lifecycle and the
//                           calendar. Named, never silently resolved by
//                           picking one.
export type ActivityStructureWarning =
  | 'no-stations-declared'
  | 'all-stations-stood-down'
  | 'too-few-stations'
  | 'too-many-stations'
  | 'multiple-active-games'

export const ACTIVITY_STRUCTURE_WARNINGS: Record<ActivityStructureWarning, string> = {
  'no-stations-declared': 'No stations declared in this plan.',
  'all-stations-stood-down': 'Every station is stood down, so the carousel runs nothing.',
  'too-few-stations': 'A carousel runs four or five stations.',
  'too-many-stations': 'A carousel runs four or five stations.',
  'multiple-active-games': 'More than one activity is marked as the games phase.',
}

export interface ActivityStructure<T> {
  // Every activity marked as a station, running or not, in plan order.
  declaredStations: PlacedActivity<T>[]
  // The stations running tonight, numbered 1..n in plan order.
  stations: NumberedStation<T>[]
  stationCount: number
  // Every activity marked as the games phase, running or not.
  declaredGames: PlacedActivity<T>[]
  // The games activities running tonight. More than one is a named
  // warning, and both are carried rather than one being chosen.
  games: PlacedActivity<T>[]
  // The ONE games activity, or null when none is declared, the declared
  // one is stood down, or the plan carries more than one active. An
  // ambiguous plan answers null and says which ambiguity it is.
  gamesActivity: PlacedActivity<T> | null
  // Does this plan declare any structure at all? False means nothing was
  // marked, which the screens read as "not set up yet" rather than as
  // "zero stations".
  declared: boolean
  warnings: ActivityStructureWarning[]
}

// Derive everything structural from a plan, in one pass, in plan order.
//
// NOTHING IS INFERRED FROM `phase`. A Warm-Up activity somebody marked
// as a station is a station; a Game phase activity nobody marked is not
// the games phase. Those are the two defects this module exists to fix
// and they are pinned as tests.
export function deriveActivityStructure<T extends StructuredActivity>(
  activities: readonly T[] | null | undefined,
): ActivityStructure<T> {
  const declaredStations: PlacedActivity<T>[] = []
  const stations: NumberedStation<T>[] = []
  const declaredGames: PlacedActivity<T>[] = []
  const games: PlacedActivity<T>[] = []

  ;(activities ?? []).forEach((activity, index) => {
    if (!isActivitySlot(activity?.slot)) return
    const placed: PlacedActivity<T> = { activity, index }
    if (activity.slot === 'station') {
      declaredStations.push(placed)
      if (!isStoodDown(activity)) stations.push({ ...placed, station: stations.length + 1 })
      return
    }
    declaredGames.push(placed)
    if (!isStoodDown(activity)) games.push(placed)
  })

  const warnings: ActivityStructureWarning[] = []
  if (declaredStations.length === 0) warnings.push('no-stations-declared')
  else if (stations.length === 0) warnings.push('all-stations-stood-down')
  else if (stations.length < MIN_STATIONS) warnings.push('too-few-stations')
  else if (stations.length > MAX_STATIONS) warnings.push('too-many-stations')
  if (games.length > 1) warnings.push('multiple-active-games')

  return {
    declaredStations,
    stations,
    stationCount: stations.length,
    declaredGames,
    games,
    gamesActivity: games.length === 1 ? games[0] : null,
    declared: declaredStations.length > 0 || declaredGames.length > 0,
    warnings,
  }
}

// The stations running tonight, numbered. The common read, kept as its
// own name so a caller asking one question does not have to know the
// whole structure exists.
export function activeStations<T extends StructuredActivity>(
  activities: readonly T[] | null | undefined,
): NumberedStation<T>[] {
  return deriveActivityStructure(activities).stations
}

// How many stations run tonight. Zero when none is declared and zero
// when every declared station is stood down: two different facts, told
// apart by the warnings rather than by this number.
export function activeStationCount(activities: readonly StructuredActivity[] | null | undefined): number {
  return deriveActivityStructure(activities).stationCount
}

// The station number of the activity at this plan position, or null when
// that activity is not a station running tonight.
export function stationNumberAt(
  activities: readonly StructuredActivity[] | null | undefined,
  index: number,
): number | null {
  return activeStations(activities).find((s) => s.index === index)?.station ?? null
}

// The one games activity running tonight, or null when the plan does not
// name exactly one. Never a best guess: a plan with two active games
// activities answers null and carries 'multiple-active-games'.
export function activeGamesActivity<T extends StructuredActivity>(
  activities: readonly T[] | null | undefined,
): PlacedActivity<T> | null {
  return deriveActivityStructure(activities).gamesActivity
}
