// =====================================================================
// COACH-14B: where an activity comes from, when a plan is being built.
//
// THE PROBLEM. A coach mid plan needs the next activity, and OTJ holds
// candidates in four places: the club library, the week plans, the
// programmes, and the coach's own head. Today the add bar offers three
// of the six routes to one (Add from library, Custom activity, New
// drill, in src/components/ActivityListEditor.tsx) and the other three
// mean leaving the plan. This module decides WHICH routes to offer and
// what an activity taken from a week plan or a programme week becomes.
//
// WHAT IT DELIBERATELY DOES NOT DO. It builds no second library and no
// second filter. Searching the library is still AddDrillModal over
// ./drillFilter and ./drillPicker, unchanged, and this module's job is
// only to decide whether that route is worth offering and to sit in
// front of it. It also mints no ordering of its own: "recent" here is
// the product's existing Recent, ./contentOrder's newest first by
// created_at, and nothing about usage, favourites or a per coach
// history is introduced.
//
// WHAT "RECENT" HONESTLY MEANS, because the word invites a wrong
// reading. sortLibraryDrills(drills, 'recent') orders by `created_at`,
// newest first, club wide. So Recent is RECENTLY ADDED TO THE CLUB
// LIBRARY, by anyone, and it is not recently used, not recently used by
// this coach, and not most used. A screen may shorten the label but
// must not promise the other thing.
//
// PURE. Takes values, returns answers. No React, no reads, no writes.
// =====================================================================
import type { Activity } from './data'
import { isActivitySlot } from './activityStructure'
import { sortLibraryDrills } from './contentOrder'

// The routes into the composer, in the order a screen should offer them:
// the cheapest first (something that already exists and was added lately),
// then search, then the two plans a coach may be working from, then the
// two that make something new.
export type ActivitySource = 'recent' | 'library' | 'week-plan' | 'programme' | 'quick-drill' | 'draw'

export const ACTIVITY_SOURCES: readonly ActivitySource[] = [
  'recent',
  'library',
  'week-plan',
  'programme',
  'quick-drill',
  'draw',
]

// What the screen knows when it decides. The three counts are how many
// candidates each source could actually reach.
//
// NULL IS NOT ZERO, and that is the whole reason these are nullable. A
// read that has not answered yet reports nothing, and reading nothing as
// "the club has none" would hide the library from a coach for as long as
// the drills read is in flight, on the one screen where they came to add
// a drill. Null offers the source; only a SETTLED zero withholds it. The
// same asymmetry the rest of the product uses: a rule that can hide is
// narrow, a rule that can show is broad.
export interface ActivitySourceContext {
  // Whether this member may create a drill at all. The caller resolves it
  // from DRILL_CREATE_CAP (src/components/PlanDrillAuthoring.tsx), which
  // is the capability the drills insert policy enforces. Passed as a
  // boolean so this module stays free of React and of capability keys.
  canCreateDrill: boolean
  // Whether this member may reach the Drill Maker ROUTE, which is gated
  // separately from creating a drill (DRILL_MAKER_ROUTE_CAP). COACH-11
  // established that a member can hold one without the other, and that
  // offering the trip to somebody who cannot take it strands their draft.
  canDraw: boolean
  // Drills in the club library. Null while the read is in flight.
  libraryCount: number | null
  // Week plans (templates) the coach could lift an activity out of.
  weekPlanCount: number | null
  // Programmes with weeks behind them.
  programmeCount: number | null
}

// Why a source is not offered, as a closed set, so a screen can say
// something true instead of leaving a gap where a button was. 'empty'
// means the club genuinely has none of that thing; 'not-permitted' means
// this member may not.
export type ActivitySourceUnavailable = 'empty' | 'not-permitted'

// A count that has not answered is not evidence of absence.
function settledEmpty(count: number | null): boolean {
  return count !== null && count <= 0
}

export function sourceUnavailable(
  source: ActivitySource,
  ctx: ActivitySourceContext,
): ActivitySourceUnavailable | null {
  switch (source) {
    // Recent and Search read the same list, so they answer together: an
    // empty library has nothing recent in it either.
    case 'recent':
    case 'library':
      return settledEmpty(ctx.libraryCount) ? 'empty' : null
    case 'week-plan':
      return settledEmpty(ctx.weekPlanCount) ? 'empty' : null
    case 'programme':
      return settledEmpty(ctx.programmeCount) ? 'empty' : null
    case 'quick-drill':
      return ctx.canCreateDrill ? null : 'not-permitted'
    // Drawing needs BOTH: the Drill Maker opens on `/drill/:id/diagram`,
    // so the drill has to be created before there is an id to draw, and
    // the route is then gated on its own capability. A member holding
    // only one of the two is offered Quick drill and not this.
    case 'draw':
      return ctx.canCreateDrill && ctx.canDraw ? null : 'not-permitted'
  }
}

// What to offer, in ACTIVITY_SOURCES order.
//
// An empty library withholds Recent and Search rather than offering a
// dead end whose own empty state tells the coach to go to the Library
// first, which is the exact instruction COACH-14 exists to remove. What
// is left is Quick drill, which is the right answer for a club with no
// drills yet.
export function availableSources(ctx: ActivitySourceContext): ActivitySource[] {
  return ACTIVITY_SOURCES.filter((s) => sourceUnavailable(s, ctx) === null)
}

// A member with no way to add anything at all: nothing to search and no
// permission to create. Worth naming because the screen must then say so
// rather than render an empty row of buttons.
export function hasNoActivitySource(ctx: ActivitySourceContext): boolean {
  return availableSources(ctx).length === 0
}

// How many drills the Recent shortcut shows before a coach should use
// Search instead. Short on purpose: it is a shortcut past the picker,
// not a second picker.
export const RECENT_DRILL_COUNT = 6

// The Recent shortcut's list. Ordering is ./contentOrder's, unchanged
// and not reimplemented, so Recent here and Recent in the picker's sort
// control are the same order over the same rows.
export function recentDrills<T extends { id: string; title: string; duration: number; createdAt?: string }>(
  drills: readonly T[],
  limit: number = RECENT_DRILL_COUNT,
): T[] {
  return sortLibraryDrills(drills, 'recent').slice(0, Math.max(0, limit))
}

// =====================================================================
// TAKING AN ACTIVITY OUT OF A WEEK PLAN OR A PROGRAMME WEEK.
//
// No projection is needed and none is invented: `Template.activities`
// and `Session.activities` are the SAME declared type, `Activity`
// (src/lib/data.ts), stored in the same `activities jsonb` column shape.
// So this is a copy, and what it owns is exactly which keys a copy may
// carry across.
//
// It rebuilds field by field rather than spreading, the discipline the
// jsonb values in this product already use, because `activities` is
// unconstrained jsonb: a stored row can carry keys no type declares, and
// a spread would carry them into the destination plan silently.
//
// `skipped` is dropped. It is documented as SESSION LOCAL, a decision
// about one evening, and the template write paths already strip it; a
// value that reached a stored template anyway is somebody else's night
// and must not stand an activity down in this plan.
//
// `slot` is KEPT, and that is a real choice rather than an oversight. It
// declares that the activity is one of the carousel stations, or the
// games phase, and the station's NUMBER is derived from position among
// the stations running, never stored, so a station lifted out of a four
// station week plan is simply another station here. Carrying it forward
// preserves the coaching intent; dropping it would silently demote the
// activity to unstructured and take its minutes out of the phase sums.
// Where the destination plan then holds too many stations, the existing
// structure warnings say so, which is the product's own answer.
// =====================================================================
export function importedActivity(source: Activity): Activity {
  const copy: Activity = {
    phase: source.phase,
    duration: source.duration,
  }
  if (source.drillId) copy.drillId = source.drillId
  if (source.title) copy.title = source.title
  if (isActivitySlot(source.slot)) copy.slot = source.slot
  return copy
}

export function importedActivities(source: readonly Activity[]): Activity[] {
  return source.map(importedActivity)
}
