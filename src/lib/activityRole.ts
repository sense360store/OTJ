// =====================================================================
// The COACH-2B authoring layer over COACH-2A's structural model.
//
// COACH-2A settled WHAT a plan can say (`slot`, `skipped`) and how a
// screen reads it (`./activityStructure`). This file settles how a coach
// SAYS it: the coach-facing vocabulary, the exact write each press
// performs, and the sentence a planner shows about the plan as a whole.
//
// PURE, AND NO REACT, for the same reason activityStructure is. Both
// authoring surfaces (the dated-session planner and the week-plan
// editor) call these, so the rules cannot drift between them, and every
// rule is testable without rendering a screen.
//
// NOTHING HERE INFERS FROM `phase`. That is the defect the whole
// programme exists to remove, and it would be reintroduced here more
// easily than anywhere else, because this is the file that decides what
// a press means. `phase` is not read by any function below, and no
// function below writes it.
// =====================================================================
import {
  ACTIVITY_STRUCTURE_WARNINGS,
  type ActivityStructureWarning,
  type StructuredActivity,
  deriveActivityStructure,
  isActivitySlot,
  isStoodDown,
  stationNumberAt,
} from './activityStructure'

// The coach-facing vocabulary. `slot` is the stored key and says
// 'station' | 'game' | absent; a coach reads three named choices, and
// 'standard' is the name for the absent case rather than a stored value.
// Keeping the two vocabularies distinct is what stops 'standard' ever
// being written to the row.
export type ActivityRole = 'standard' | 'station' | 'game'

export const ACTIVITY_ROLES: readonly ActivityRole[] = ['standard', 'station', 'game']

// Coach language, not model language. "Games phase" is deliberately
// singular and definite: ONE activity is the whole games phase, and its
// duration is that phase's duration. Two simultaneous games are one
// games phase with a game count, which is COACH-8, not two activities.
export const ACTIVITY_ROLE_LABELS: Record<ActivityRole, string> = {
  standard: 'Standard',
  station: 'Station',
  game: 'Games phase',
}

export const ACTIVITY_ROLE_GROUP_LABEL = 'Session role'

// The stand-down affordance's one label, used by the control, by the
// derived row badge and by the tests, so the wording cannot drift.
export const NOT_RUNNING_LABEL = 'Not running tonight'

// What role does this activity currently play?
//
// Reads through isActivitySlot rather than comparing the raw value, so a
// row carrying `slot: 'Station'`, `slot: 3` or anything else declares
// nothing and reads as Standard. `activities` is unconstrained jsonb;
// failing closed here means a malformed value can never present as a
// declaration the coach did not make.
export function roleOf(activity: StructuredActivity | null | undefined): ActivityRole {
  // Returns the VALIDATED slot itself rather than comparing it against a
  // literal. ActivityRole is ActivitySlot plus 'standard', so the mapping is
  // the identity and there is no second place naming 'station' or 'game' to
  // fall out of step with activityStructure. The invariant suite forbids a
  // slot literal comparison outside that seam, and this is why it can.
  const slot = activity?.slot
  return isActivitySlot(slot) ? slot : 'standard'
}

// Remove both structural keys, returning a new activity. `delete` on a copy
// rather than rest-destructuring: the keys must be ABSENT, not present and
// undefined, so a restored activity and one never touched are the same object
// and compare equal when the draft is judged dirty.
function withoutStructuralKeys<T extends StructuredActivity>(activity: T): T {
  const next = { ...activity }
  delete next.slot
  delete next.skipped
  return next
}

// Apply a role press, returning a new activity. THE WRITE RULES, in one
// place:
//
//   standard  remove `slot` and remove `skipped`
//   station   set `slot: 'station'`
//   game      set `slot: 'game'`, and never carry a stand-down into it
//
// `skipped` survives ONLY when the role is UNCHANGED, and every role
// CHANGE clears it. Those two halves are the whole rule.
//
// The change half covers what COACH-2B states explicitly: changing a
// stood-down station away from Station removes `skipped`, so stale
// session-local state cannot unexpectedly stand down a later Games
// assignment. It also closes the mirror case the brief does not state, a
// stood-down row becoming a station again by another route.
//
// The unchanged half is simply that a press which selects the role an
// activity already has must change nothing. This condition was once
// narrowed to 'station', which was wrong for a reason that only became
// visible once the badge started naming a stood-down games activity:
// pressing the already-selected Games phase chip silently restored its
// minutes, and this slice ships no games stand-down toggle to undo that.
// A no-op press is a no-op.
//
// The keys are DELETED by rest-destructuring, never set to undefined,
// null or false. Each state has exactly one representation, which is
// what lets a stored row be compared and a draft be judged dirty.
export function applyRole<T extends StructuredActivity>(activity: T, role: ActivityRole): T {
  const bare = withoutStructuralKeys(activity)
  if (role === 'standard') return bare
  const keepStandDown = roleOf(activity) === role && isStoodDown(activity)
  const next = { ...bare, slot: role } as T
  return keepStandDown ? ({ ...next, skipped: true } as T) : next
}

// Stand one down for tonight, or restore it.
//
// ON writes the literal `true`. OFF REMOVES the key; `false` is never
// written, so "restored" and "never stood down" are the same row rather
// than two rows that compare unequal.
export function setNotRunning<T extends StructuredActivity>(activity: T, on: boolean): T {
  if (on) return { ...activity, skipped: true } as T
  const next = { ...activity }
  delete next.skipped
  return next
}

// May this activity be stood down on this surface?
//
// Stations only, and dated sessions only.
//
// A week plan is reusable content and `skipped` is session local, so the
// affordance is absent there rather than present and stripped later.
//
// THE GAMES PHASE IS A DELIBERATE SCOPE DECISION, NOT AN OVERSIGHT, and
// it is worth recording because the model and the design document both
// go further than this control does.
// 02-target-product-model.md is explicit: "It applies to any activity
// carrying a `slot`. A station stood down is the ordinary case; a coach
// who decides there are no games tonight stands the games activity down
// the same way." COACH-2A implemented exactly that: isStoodDown accepts
// any operational activity, deriveActivityStructure drops a stood-down
// games activity from `games`, and activeActivityMinutes takes its
// minutes off the night. All of that works today.
// What COACH-2B settled is narrower: the authoring affordance is
// specifically standing down a STATION. So the state remains
// representable and every reader honours it; this slice simply does not
// ship the press that creates it. Widening the control is a product
// decision, not a bug fix, and it needs nothing from the model when it
// is taken.
//
// A stood-down games activity is therefore NOT hidden if one reaches a
// plan by another route: activityRoleBadge names it and the structure
// summary says the games phase is not running. Unreachable to author is
// not the same as invisible to read.
export function canStandDown(
  activity: StructuredActivity | null | undefined,
  options: { dated: boolean },
): boolean {
  return options.dated && roleOf(activity) === 'station'
}

// The derived label for one activity row, or null when there is nothing
// to say. Station numbers come from stationNumberAt and are NEVER
// stored: a station's number is its position among the stations running
// tonight, so standing one down renumbers the rest.
//
// A station with no number can only be a stood-down one, because
// stationNumberAt numbers every active station.
export function activityRoleBadge(
  activities: readonly StructuredActivity[] | null | undefined,
  index: number,
): string | null {
  const list = activities ?? []
  const activity = list[index]
  const role = roleOf(activity)
  if (role === 'standard') return null
  // A games activity that is stood down says so. This slice offers no
  // control that creates that state, but the model permits it and every
  // reader already honours it, so a plan carrying one must not present as
  // a games phase that is running while its minutes are missing from the
  // total.
  if (role === 'game') {
    return isStoodDown(activity)
      ? `${ACTIVITY_ROLE_LABELS.game} · ${NOT_RUNNING_LABEL}`
      : ACTIVITY_ROLE_LABELS.game
  }
  const number = stationNumberAt(list, index)
  return number === null ? `${ACTIVITY_ROLE_LABELS.station} · ${NOT_RUNNING_LABEL}` : `Station ${number}`
}

export interface StructureSummary {
  // One line naming what the plan declares. Always a real answer: a plan
  // that declares nothing says so rather than reading as zero stations
  // by accident.
  headline: string
  // The warnings, already worded by activityStructure. Never blocking,
  // and never recreated here: one sentence per rule, in one place.
  notes: string[]
  warnings: ActivityStructureWarning[]
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

// The planner and week-plan summary line.
//
// Composed from deriveActivityStructure rather than by counting
// activities here, so the screens and this sentence cannot disagree
// about what a station is. The four-or-five rule is a WARNING and never
// a refusal: a coach who declares three is told, not blocked, and Save
// is never gated on this.
export function structureSummary(
  activities: readonly StructuredActivity[] | null | undefined,
): StructureSummary {
  const structure = deriveActivityStructure(activities ?? [])
  const declared = structure.declaredStations.length
  const active = structure.stationCount
  const standingDown = declared - active

  let stations: string
  if (declared === 0) stations = 'No stations declared'
  else if (active === 0) stations = `${plural(declared, 'station', 'stations')} · none running`
  else {
    stations = plural(active, 'station', 'stations')
    if (standingDown > 0) stations += ` · ${standingDown} not running`
  }

  // The games half names all three states rather than collapsing "more
  // than one" into "set". An ambiguous plan must stay visibly ambiguous
  // so the coach resolves it deliberately; nothing here unmarks an
  // earlier games activity when another is marked.
  const gamesCount = structure.games.length
  let games: string
  if (gamesCount === 1) games = 'Games phase set'
  else if (gamesCount > 1) games = `Games phase marked ${gamesCount} times`
  // Marked and stood down is a different answer from never marked, and
  // reading the first as the second would tell a coach to mark a games
  // phase they already have.
  else games = structure.declaredGames.length > 0 ? 'Games phase not running' : 'Games phase not set'

  return {
    headline: `${stations} · ${games}`,
    notes: structure.warnings.map((w) => ACTIVITY_STRUCTURE_WARNINGS[w]),
    warnings: structure.warnings,
  }
}
