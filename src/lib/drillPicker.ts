// The Add from library selection model. The modal's selection is a set of
// drill ids, independent of what the current filter shows: narrowing the
// list never unselects a drill, the Add count is the whole set, and confirm
// draws from the FULL library list. AddDrillModal.tsx is a thin shell over
// this and ./drillFilter.

import type { Activity, CornerKey } from './data'
import { sortLibraryDrills } from './contentOrder'
import type { LibrarySort } from './contentOrder'
import type { FilterableDrill } from './drillFilter'

// Which planner phase a drill lands in, by corner. Unchanged since the
// planner gained the modal: physical work opens the session, social play
// closes it, and everything else (technical, psychological, unclassified)
// is the skill block in the middle.
export function phaseFor(corner: CornerKey | null): Activity['phase'] {
  return corner === 'physical' ? 'Warm-Up' : corner === 'social' ? 'Game' : 'Skill'
}

// The whole selected set the library still holds. A drill the current
// filter hides is still selected; only an explicit untick (stored as false)
// removes one. An id the library no longer holds (a drill deleted while the
// modal was open, surfaced by a background refetch) is not counted, so the
// Add button never promises more than confirm adds.
export function selectedCount(drills: readonly { id: string }[], picked: Record<string, boolean>): number {
  return drills.filter((d) => picked[d.id]).length
}

// How many selected drills the current filter is hiding, so the screen can
// say so beside the count instead of leaving the arithmetic to surprise.
// Counted over the library list, not the picked map, for the same reason as
// selectedCount: a deleted drill is not "hidden by filters", because
// clearing the filters could not reveal it.
export function hiddenSelectedCount(
  drills: readonly { id: string }[],
  results: readonly { id: string }[],
  picked: Record<string, boolean>,
): number {
  const visible = new Set(results.map((d) => d.id))
  return drills.filter((d) => picked[d.id] && !visible.has(d.id)).length
}

// What confirm adds: every selected drill exactly once, from the full
// library list, in the modal's current sort applied over the selected set.
//
// THE ORDERING RULE, stated because it used to be an accident. The
// historical confirm was `drills.filter(picked)` over the useDrills read,
// which is newest first, so activities always landed in Recent order. Under
// the default Recent sort this is identical to that; under A to Z or
// Shortest it follows the order the coach is looking at. It is never the
// order the drills were ticked.
export function selectedActivities<T extends FilterableDrill>(
  drills: readonly T[],
  picked: Record<string, boolean>,
  sort: LibrarySort,
): Activity[] {
  return sortLibraryDrills(
    drills.filter((d) => picked[d.id]),
    sort,
  ).map((d) => ({ phase: phaseFor(d.corner), drillId: d.id, duration: d.duration }))
}

// The two ways the list can be empty are different problems with different
// ways out: a library with nothing in it needs drills created, filters that
// match nothing need clearing. Never show one as the other.
export type PickerEmptyState = 'empty-library' | 'no-match' | null

export function pickerEmptyState(libraryCount: number, resultCount: number): PickerEmptyState {
  if (libraryCount === 0) return 'empty-library'
  if (resultCount === 0) return 'no-match'
  return null
}
