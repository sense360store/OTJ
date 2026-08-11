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
//   2. Lifecycle. Upcoming by default, Past when a coach asks. A finished
//      session is not operational work, and a list of what is happening
//      that leads with what already happened is not a schedule. The rule
//      itself lives in ./sessionLifecycle; this only composes it.
//   3. Team. A useful narrowing, never the primary split, and it never
//      changes the kind.
//   4. Ownership. Secondary and off by default, because a coach asks what
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
  type SpondEventLookup,
} from './eventKind'
import {
  DEFAULT_LIFECYCLE_SCOPE,
  isSessionActive,
  type LifecycleScope,
  matchesLifecycleScope,
  type TimedEvent,
} from './sessionLifecycle'

// Whatever the classifier can read, plus what places the row in time, plus
// the owner. Extending both shared shapes rather than restating their
// fields means the two event shapes (a Hub session's `name` and local
// `date`, a Spond event's `title` and `startsAt`) stay handled in exactly
// one place each, and a caller cannot pass something one of them would
// then silently read as untitled or as undated.
export interface FilterableEvent extends ClassifiableEvent, TimedEvent {
  coachId?: string | null
}

export interface EventFilterState {
  kind: EventKind
  // Upcoming or Past. Required rather than optional, so a screen composing
  // a list has to say which of the two it is showing; a list that never
  // decided is the bug this replaces.
  scope: LifecycleScope
  mine: boolean
}

// Training first, upcoming first, ownership off. Exported as a frozen
// constant so a screen resetting to it after navigating or refetching lands
// on the documented default rather than on whatever was last set.
export const DEFAULT_EVENT_FILTER: EventFilterState = Object.freeze({
  kind: DEFAULT_EVENT_KIND,
  scope: DEFAULT_LIFECYCLE_SCOPE,
  mine: false,
})

export interface EventFilterContext<T> {
  userId: string | null | undefined
  // Team scoping stays with the caller: it depends on the team model, the
  // parent scope and session coverage, none of which belong in here. Passing
  // it in keeps the composition testable without duplicating that logic.
  teamMatch?: (event: T) => boolean
  // Resolves a row's linked Spond event, so a session planned from a Spond
  // MATCH keeps Spond's classification instead of falling back to its
  // title. Required in practice on any screen that filters SESSIONS, since
  // a session row cannot carry spondType; a screen filtering synced events
  // never needs it. See eventKind for the rule and the degrade.
  spondEvents?: SpondEventLookup
  // The moment the list is being composed at. Defaults to the real clock in
  // the app and is supplied explicitly by tests, so no test depends on the
  // day it happens to run on.
  now?: Date
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
//
// A finished session is never any of them. The lifecycle filter runs here
// rather than only in the caller so a screen cannot lead with last
// Tuesday by forgetting to narrow its list first: yesterday's training
// sitting on the front page was the whole complaint.
export function pickNextEvent<T extends FilterableEvent>(
  upcoming: T[],
  userId: string | null | undefined,
  spondEvents?: SpondEventLookup,
  now?: Date,
): T | undefined {
  // "active", not "live": a session being driven live is one of the ways a
  // row is still active, and the other ways matter just as much here.
  const active = upcoming.filter((e) => isSessionActive(e, now))
  const mine = (e: T) => !!userId && e.coachId === userId
  const training = (e: T) => isTrainingEvent(e, spondEvents)
  return active.find((e) => training(e) && mine(e)) ?? active.find(training) ?? active.find(mine) ?? active[0]
}

export function applyEventFilter<T extends FilterableEvent>(
  items: T[],
  state: EventFilterState,
  ctx: EventFilterContext<T>,
): T[] {
  return items.filter((e) => {
    if (!matchesEventKind(e, state.kind, ctx.spondEvents)) return false
    if (!matchesLifecycleScope(e, state.scope, ctx.now)) return false
    if (ctx.teamMatch && !ctx.teamMatch(e)) return false
    // Fail closed on ownership: with no signed in user, "mine" is nobody's,
    // never everybody's.
    if (state.mine && (!ctx.userId || e.coachId !== ctx.userId)) return false
    return true
  })
}
