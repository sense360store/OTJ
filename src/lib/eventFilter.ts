// =====================================================================
// The shared session and event filter.
//
// One composition layer above the classifier in ./eventKind, so every list
// answers "what belongs in this view?" the same way. Sessions, Home and the
// Spond surfaces call this rather than each assembling their own predicate
// chain, which is how their defaults previously disagreed.
//
// THE HIERARCHY, in the order the product states it:
//
//   1. Event kind. Training by default, All events when a coach asks.
//   2. Team. A useful narrowing, never the primary split, and it never
//      changes the kind.
//   3. Ownership. Secondary and off by default, because a coach asks what
//      training is happening rather than which rows they own. Ownership
//      still governs edit and delete, which is decided elsewhere and is a
//      different question entirely.
// =====================================================================
import {
  type ClassifiableEvent,
  DEFAULT_EVENT_KIND,
  type EventKind,
  isTrainingEvent,
  matchesEventKind,
} from './eventKind'

// Whatever the classifier can read, plus the owner. Extending
// ClassifiableEvent rather than restating its fields means the two shapes
// (a Hub session's `name`, a Spond event's `title`) stay handled in exactly
// one place, and a caller cannot pass something the classifier would then
// silently read as untitled.
export interface FilterableEvent extends ClassifiableEvent {
  coachId?: string | null
}

export interface EventFilterState {
  kind: EventKind
  mine: boolean
}

// Training first, ownership off. Exported as a frozen constant so a screen
// resetting to it after navigating or refetching lands on the documented
// default rather than on whatever was last set.
export const DEFAULT_EVENT_FILTER: EventFilterState = Object.freeze({
  kind: DEFAULT_EVENT_KIND,
  mine: false,
})

export interface EventFilterContext<T> {
  userId: string | null | undefined
  // Team scoping stays with the caller: it depends on the team model, the
  // parent scope and session coverage, none of which belong in here. Passing
  // it in keeps the composition testable without duplicating that logic.
  teamMatch?: (event: T) => boolean
}

// The one event a schedule leads with, from a list already ordered
// soonest first.
//
// The preference order, and why it is this way round:
//
//   1. Your own next training. The common case, and the most useful thing
//      a coach can be shown.
//   2. Anyone's next training. This is the correction. Leading with
//      ownership meant a coach who owns no session was told the calendar
//      was empty on a night the club was training, which was wrong on a
//      screen whose whole job is "what is happening next".
//   3. Your own next anything, then anyone's next anything. A week with
//      only a fixture in it still gets a hero; showing the fixture beats
//      claiming nothing is on.
export function pickNextEvent<T extends FilterableEvent>(
  upcoming: T[],
  userId: string | null | undefined,
): T | undefined {
  const mine = (e: T) => !!userId && e.coachId === userId
  return (
    upcoming.find((e) => isTrainingEvent(e) && mine(e)) ??
    upcoming.find((e) => isTrainingEvent(e)) ??
    upcoming.find(mine) ??
    upcoming[0]
  )
}

export function applyEventFilter<T extends FilterableEvent>(
  items: T[],
  state: EventFilterState,
  ctx: EventFilterContext<T>,
): T[] {
  return items.filter((e) => {
    if (!matchesEventKind(e, state.kind)) return false
    if (ctx.teamMatch && !ctx.teamMatch(e)) return false
    // Fail closed on ownership: with no signed in user, "mine" is nobody's,
    // never everybody's.
    if (state.mine && (!ctx.userId || e.coachId !== ctx.userId)) return false
    return true
  })
}
